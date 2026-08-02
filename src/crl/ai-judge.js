// src/crl/ai-judge.js — the CRL's ai-judged pass (Phase 2). Reviews ONLY the
// `tier: "ai-judged"` rules of a ComplianceDoc against an artifact's real
// content and returns normalized AiFindings.
//
// Model policy (contract §2.4, reconciled MAJ-9/O-2):
//   • whole-artifact inspection (delta===null) → Sonnet (the more capable
//     judge for a from-scratch pass).
//   • a per-change delta → Haiku (cheap, scoped), THEN any Haiku finding whose
//     confidence < threshold is RE-JUDGED on Sonnet and the Sonnet verdict
//     wins on merge (low-confidence escalation — the #1 false-prune guard).
//
// CRIT-1: aiJudge THROWS when it is handed a non-empty ai-rule set with no
//   ANTHROPIC_API_KEY. That throw is a guard for DIRECT callers only —
//   reviewBundle/reviewSpec key-guard BEFORE ever reaching it (they clean-skip
//   to {findings:[],confidence:1,costUsd:0}). An empty rule set is a free no-op.
// CRIT-2: the artifact MUST carry content. For a bundle review the caller
//   passes `files` (a bounded projection); if absent, aiJudge self-loads the
//   projection from `bundleDir` so the model never receives only {kind,bundleDir}.
// MAJ-7: aiJudge captures the result event's total_cost_usd and returns costUsd.

import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { BLOCKED_ACCOUNT_MCP_SERVERS, blockAccountMcpPreToolUseHook } from "../agent.js";

// Judge model tiers. Both default to Haiku 4.5 per the 2026-07-13 model-matrix
// run: across the stray/orphan class (CRL2a/2b), every tier (Haiku → Opus)
// scored identical precision/recall (1.000/1.000, zero false-prunes) with cost
// converging to ~$0.08 — a stronger judge bought NOTHING, so the whole judge
// runs on Haiku 4.5 (cheapest, and the deterministic never-prune-referenced
// guardrail is what actually protects precision). Env-overridable for future
// A/B: SDK_JUDGE_MODEL = base (per-change delta) tier; SDK_JUDGE_ESCALATION_MODEL
// = the low-confidence re-judge / whole-artifact tier. The SONNET_MODEL name is
// retained (it is still the "escalation tier" slot) though it now defaults to
// Haiku; point it at a stronger model via the env var to restore cross-model
// escalation.
export const HAIKU_MODEL = process.env.SDK_JUDGE_MODEL || "claude-haiku-4-5-20251001";
export const SONNET_MODEL = process.env.SDK_JUDGE_ESCALATION_MODEL || "claude-haiku-4-5-20251001";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
const MAX_PROJECTED_CONCEPTS = 120;
const MAX_PROJECTED_FORMS = 20;
const MAX_PROJECTED_RULE_CHARS = 800;

const SYSTEM_PROMPT = `You are a compliance JUDGE for AVNI bundle/spec artifacts.

You are given a small set of COMPLIANCE RULES and the ARTIFACT content (concepts, forms, rules, mappings — or a spec). Judge the artifact against ONLY the rules you are given. Do not invent rules. Do not repeat structural/FK issues (those are handled deterministically elsewhere).

For EACH violation you are confident about, emit one finding. Do NOT emit findings for compliant entities.

Your output MUST be a single JSON code block of exactly this shape:
\`\`\`json
{
  "findings": [
    {
      "ruleId": "<the id of the rule this violates>",
      "target": { "file": "concepts.json | forms/<name>.json", "entityKind": "concept | form", "name": "<entity name>", "uuid": "<entity uuid if known>" },
      "verdict": "stray | orphan | contradicts-intent | incoherent-name",
      "confidence": 0.0,
      "rationale": "one specific sentence naming the entity and why it violates the rule",
      "replacement": null,
      "fixConfidence": null
    }
  ]
}
\`\`\`

Rules for the output:
  • confidence is YOUR calibrated probability (0..1) that this really is a violation. Be honest — a false prune removes a real entity.
  • If (and only if) the rule's action is a fix and you can name the exact corrected value, set "replacement" to the full corrected entity object and "fixConfidence" to your probability the fix is right; otherwise leave both null.
  • Quote entity names/uuids verbatim from the ARTIFACT. Never invent a UUID.
  • If there are zero violations, return {"findings": []}.

Keep the response under 700 words.`;

// A bounded projection of the bundle so the judge sees REAL content (CRIT-2),
// mirroring src/agents/evaluator.js buildSample but retaining the fields the
// judge needs to reason about strays/orphans/naming: concept {name,uuid,dataType,
// answers}, form {name,uuid,formType, element names+concept refs}, plus the
// master entities and mappings that establish what is "referenced".
//
// SCOPE (widened for the SRS-conformance rules, design gap#4). The projection
// used to carry six keys — concepts, forms, subjectTypes, programs,
// encounterTypes, formMappings — and forms were reduced to name/uuid/formType/
// elements. Everything else in the bundle was invisible to the judge: user
// groups, group privileges, dashboards + report cards, address-level types, and
// the per-form visitScheduleRule / decisionRule / validationRule bodies. That
// made whole categories of "the org asked for it and we didn't build it"
// unjudgeable — and worse, made them look like false positives waiting to
// happen, because to a judge an absent KEY is indistinguishable from absent
// CONFIG. (It also silently defeated `rule-contradicts-intent`, which asks about
// rule bodies the projection dropped.) Those categories are now carried.
//
// TWO CONVENTIONS THE RULE PROSE DEPENDS ON — do not break them:
//   • null vs []  — a key is `null` when its file is absent or unparseable, and
//     an array (possibly empty) when the file was read. "I could not look" and
//     "I looked and there is nothing" are different claims and the judge must
//     be able to tell them apart before reporting a gap.
//   • counts{}    — concepts and forms are still capped (MAX_PROJECTED_*). The
//     counts block reports total vs projected so a truncated tail is never
//     mistaken for missing configuration.
export function buildBundleProjection(bundleDir) {
  const safe = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(bundleDir, rel), "utf8")); } catch { return null; }
  };
  const arrOf = (val, key) => Array.isArray(val) ? val : (val && Array.isArray(val[key]) ? val[key] : []);
  // Absent/unparseable file → null (see convention above); otherwise map it.
  const listOf = (rel, fn) => { const v = safe(rel); return v == null ? null : (Array.isArray(v) ? v : []).map(fn); };
  // Rule bodies can run to hundreds of lines. Carry enough to judge intent, and
  // say so when clipped rather than presenting a fragment as the whole rule.
  const ruleText = (v) => {
    if (v == null || v === "") return null;
    const s = String(v);
    return s.length > MAX_PROJECTED_RULE_CHARS
      ? `${s.slice(0, MAX_PROJECTED_RULE_CHARS)}… [truncated, ${s.length} chars total]`
      : s;
  };

  const conceptsRaw = safe("concepts.json");
  const conceptsAll = Array.isArray(conceptsRaw) ? conceptsRaw : (conceptsRaw?.concepts || []);
  const concepts = conceptsAll
    .slice(0, MAX_PROJECTED_CONCEPTS)
    .map((c) => ({
      name: c?.name, uuid: c?.uuid, dataType: c?.dataType,
      answers: (c?.answers || []).map((a) => ({ uuid: a?.uuid, name: a?.name })).slice(0, 40),
    }));

  const formsDir = path.join(bundleDir, "forms");
  const formFiles = fs.existsSync(formsDir) ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json")) : [];
  const forms = formFiles.slice(0, MAX_PROJECTED_FORMS)
    .map((fn) => { try { return JSON.parse(fs.readFileSync(path.join(formsDir, fn), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .map((f) => ({
      name: f.name, uuid: f.uuid, formType: f.formType,
      // Presence of automation is the whole question for "the SRS said (auto)"
      // and "the SRS specified a visit schedule" — null means the form carries
      // no such rule, which is a fact about the bundle, not about the sample.
      visitScheduleRule: ruleText(f.visitScheduleRule),
      decisionRule: ruleText(f.decisionRule),
      validationRule: ruleText(f.validationRule),
      elements: (f.formElementGroups || []).flatMap((g) => (g.formElements || []).map((fe) => ({
        name: fe?.name,
        concept: fe?.concept && typeof fe.concept === "object"
          ? { name: fe.concept.name, uuid: fe.concept.uuid, dataType: fe.concept.dataType }
          : fe?.concept,
      }))),
    }));

  // Privileges are ~150 near-identical rows on a small bundle and scale with
  // subjectTypes × programs × privilegeType. Nobody needs the rows — the judge
  // needs to know which groups are covered and how broadly, so summarise.
  const privRaw = safe("groupPrivilege.json");
  const groupPrivileges = privRaw == null ? null : (() => {
    const rows = (Array.isArray(privRaw) ? privRaw : []).filter((p) => p && !p.voided);
    const byGroupUUID = {};
    for (const p of rows) {
      const k = p.groupUUID || "(no group)";
      byGroupUUID[k] = (byGroupUUID[k] || 0) + 1;
    }
    return { total: rows.length, allowed: rows.filter((p) => p.allow).length, byGroupUUID };
  })();

  return {
    concepts,
    forms,
    subjectTypes: (safe("subjectTypes.json") || []).map((s) => ({ name: s?.name, uuid: s?.uuid })),
    programs: (safe("programs.json") || []).map((p) => ({ name: p?.name, uuid: p?.uuid })),
    encounterTypes: (safe("encounterTypes.json") || []).map((e) => ({ name: e?.name, uuid: e?.uuid })),
    formMappings: arrOf(safe("formMappings.json"), "formMappings").map((m) => ({ formUUID: m?.formUUID, subjectTypeUUID: m?.subjectTypeUUID, formType: m?.formType })),
    groups: listOf("groups.json", (g) => ({ name: g?.name, uuid: g?.uuid, hasAllPrivileges: g?.hasAllPrivileges ?? null })),
    groupPrivileges,
    addressLevelTypes: listOf("addressLevelTypes.json", (a) => ({ name: a?.name, level: a?.level, isRegistrationLocation: a?.isRegistrationLocation ?? null })),
    reportCards: listOf("reportCard.json", (c) => ({ name: c?.name, standardReportCardType: c?.standardReportCardType ?? null })),
    reportDashboards: listOf("reportDashboard.json", (d) => ({
      name: d?.name,
      sections: (d?.sections || []).map((s) => ({ name: s?.name, cardCount: (s?.cards || []).length })),
    })),
    groupDashboards: listOf("groupDashboards.json", (g) => ({ groupName: g?.groupName, dashboardName: g?.dashboardName })),
    counts: {
      concepts: { total: conceptsAll.length, projected: concepts.length, truncated: conceptsAll.length > concepts.length },
      forms: { total: formFiles.length, projected: forms.length, truncated: formFiles.length > forms.length },
    },
  };
}

// Whole-artifact pass → Sonnet ; a per-change delta → Haiku (then low-confidence
// Haiku findings are re-judged on Sonnet by aiJudge itself, O-2).
export function selectJudgeModel(delta) {
  return delta == null ? SONNET_MODEL : HAIKU_MODEL;
}

function ruleThreshold(rule, scopingCtx) {
  return rule?.confidenceThreshold
    ?? rule?.judge?.confidenceThreshold
    ?? scopingCtx?.confidenceThreshold
    ?? DEFAULT_CONFIDENCE_THRESHOLD;
}

// Stamp each raw model finding with the rule's authoritative class/severity/
// action (the model never invents an action) and drop anything that doesn't
// map to one of the rules we asked about or that the model marked compliant.
function stampFindings(raw, rules) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out = [];
  for (const f of raw || []) {
    if (!f || typeof f !== "object") continue;
    let rule = f.ruleId ? byId.get(f.ruleId) : null;
    if (!rule && rules.length === 1) rule = rules[0];
    if (!rule) continue;
    if (f.verdict === "compliant") continue;
    const action = rule.action ?? rule.judge?.action ?? "flag-only";
    out.push({
      ruleId: rule.id,
      class: rule.class,
      severity: rule.severity || "warning",
      target: f.target || null,
      verdict: f.verdict || rule.class,
      action,
      confidence: typeof f.confidence === "number" ? f.confidence : 0,
      rationale: f.rationale || "",
      ...(f.replacement != null ? { replacement: f.replacement } : {}),
      ...(typeof f.fixConfidence === "number" ? { fixConfidence: f.fixConfidence } : {}),
    });
  }
  return out;
}

// Sonnet re-judged rules win: drop every Haiku finding whose ruleId was
// re-judged, then append the Sonnet findings for those rules.
export function mergeSonnetOverHaiku(haikuFindings, sonnetFindings, rejudgedRuleIds) {
  const rejudged = new Set(rejudgedRuleIds);
  return [...haikuFindings.filter((f) => !rejudged.has(f.ruleId)), ...sonnetFindings];
}

function parseJsonBlock(text) {
  const fenced = String(text).match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); }
  catch {
    const m = String(candidate).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

function buildUserMessage(artifact, rules, delta, scopingCtx) {
  const rulesForModel = rules.map((r) => ({
    id: r.id, class: r.class, action: r.action ?? r.judge?.action ?? "flag-only",
    description: r.description || r.provenance || "",
  }));
  const parts = [
    "COMPLIANCE_RULES (judge ONLY these):",
    JSON.stringify(rulesForModel, null, 2),
    "",
    "ARTIFACT:",
    artifact.spec != null ? artifact.spec : JSON.stringify(artifact.files ?? {}, null, 2),
  ];
  if (scopingCtx && (scopingCtx.orgAsk || scopingCtx.scopingText || scopingCtx.srs)) {
    parts.push("", "SCOPING_INTENT (what the org actually asked for):",
      String(scopingCtx.orgAsk || scopingCtx.scopingText || scopingCtx.srs));
  }
  if (scopingCtx && Array.isArray(scopingCtx.deterministicFindings) && scopingCtx.deterministicFindings.length) {
    parts.push("", "DETERMINISTIC_FINDINGS (already handled — do NOT repeat):",
      JSON.stringify(scopingCtx.deterministicFindings.map((f) => ({ code: f.code, message: f.message })).slice(0, 30), null, 2));
  }
  if (delta) {
    parts.push("", "DELTA (only these changed — focus here + their dependents):",
      JSON.stringify({ changedFiles: delta.changedFiles, diff: delta.diff ? String(delta.diff).slice(0, 4000) : undefined }, null, 2));
  }
  parts.push("", "Judge the artifact against the rules. Return the JSON shape specified.");
  return parts.join("\n");
}

async function callModel(model, userMsg) {
  let text = "";
  let usage = null;
  let costUsd = 0;
  const result = query({
    prompt: userMsg,
    options: {
      model,
      systemPrompt: SYSTEM_PROMPT,
      allowedTools: [],
      disallowedTools: [...BLOCKED_ACCOUNT_MCP_SERVERS],
      hooks: { PreToolUse: [blockAccountMcpPreToolUseHook()] },
      settingSources: [],
      permissionMode: "bypassPermissions",
    },
  });
  for await (const ev of result) {
    if (ev?.type === "assistant" && ev.message?.content) {
      for (const b of ev.message.content) if (b.type === "text" && b.text) text += b.text;
      if (ev.message?.usage) usage = ev.message.usage;
    }
    if (ev?.type === "result" && typeof ev.total_cost_usd === "number") {
      costUsd = ev.total_cost_usd;
      if (ev.usage) usage = ev.usage;
    }
  }
  return { text, usage, costUsd };
}

/**
 * @param {{kind:"bundle"|"spec", bundleDir?:string, files?:object, spec?:string}} artifact
 * @param {object[]} aiRules  the tier==="ai-judged" subset of a ComplianceDoc
 * @param {null|{changedFiles?:string[],diff?:string}} delta  null ⇒ whole-artifact
 * @param {{orgAsk?:string,confidenceThreshold?:number,deterministicFindings?:object[]}} scopingCtx
 * @returns {Promise<{findings:object[], confidence:number, costUsd:number, usage?:object}>}
 */
export async function aiJudge(artifact, aiRules, delta = null, scopingCtx = {}) {
  if (!Array.isArray(aiRules) || aiRules.length === 0) {
    return { findings: [], confidence: 1, costUsd: 0 };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "aiJudge: ANTHROPIC_API_KEY is required for a non-empty ai-judged rule set. " +
      "Callers (reviewBundle/reviewSpec) MUST key-guard and clean-skip before reaching this — CRIT-1.",
    );
  }

  // CRIT-2: guarantee content. Self-load the projection when the caller didn't
  // inline `files` (and it's a bundle artifact with a dir).
  let art = artifact;
  if (art && !art.files && art.spec == null && art.bundleDir) {
    art = { ...art, files: buildBundleProjection(art.bundleDir) };
  }

  const primary = selectJudgeModel(delta);
  const first = await callModel(primary, buildUserMessage(art, aiRules, delta, scopingCtx));
  let findings = stampFindings(parseJsonBlock(first.text)?.findings, aiRules).map((f) => ({ ...f, judgedBy: primary }));
  let costUsd = first.costUsd;
  let usage = first.usage;

  // O-2 / MAJ-9: re-judge low-confidence Haiku findings on Sonnet, merge (Sonnet wins).
  if (primary === HAIKU_MODEL) {
    const lowRuleIds = [...new Set(
      findings.filter((f) => f.confidence < ruleThreshold(aiRules.find((r) => r.id === f.ruleId), scopingCtx)).map((f) => f.ruleId),
    )];
    if (lowRuleIds.length) {
      const reRules = aiRules.filter((r) => lowRuleIds.includes(r.id));
      const second = await callModel(SONNET_MODEL, buildUserMessage(art, reRules, delta, scopingCtx));
      const sonnetFindings = stampFindings(parseJsonBlock(second.text)?.findings, reRules).map((f) => ({ ...f, judgedBy: SONNET_MODEL }));
      findings = mergeSonnetOverHaiku(findings, sonnetFindings, lowRuleIds);
      costUsd += second.costUsd;
      if (second.usage) usage = second.usage;
    }
  }

  const confidence = findings.length ? Math.min(...findings.map((f) => (typeof f.confidence === "number" ? f.confidence : 1))) : 1;
  return { findings, confidence, costUsd, usage };
}
