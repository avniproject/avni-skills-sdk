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

// Judge model tiers — env-overridable so the CRL judge can be pointed at any
// model for A/B routing experiments and regression testing (production defaults
// unchanged when the env vars are unset). SDK_JUDGE_MODEL overrides the base
// (per-change delta) tier; SDK_JUDGE_ESCALATION_MODEL the low-confidence
// re-judge tier. Set both to the same model to run "the whole judge on model M".
export const HAIKU_MODEL = process.env.SDK_JUDGE_MODEL || "claude-haiku-4-5-20251001";
export const SONNET_MODEL = process.env.SDK_JUDGE_ESCALATION_MODEL || "claude-sonnet-4-6";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
const MAX_PROJECTED_CONCEPTS = 120;
const MAX_PROJECTED_FORMS = 20;

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
export function buildBundleProjection(bundleDir) {
  const safe = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(bundleDir, rel), "utf8")); } catch { return null; }
  };
  const arrOf = (val, key) => Array.isArray(val) ? val : (val && Array.isArray(val[key]) ? val[key] : []);

  const conceptsRaw = safe("concepts.json");
  const concepts = (Array.isArray(conceptsRaw) ? conceptsRaw : (conceptsRaw?.concepts || []))
    .slice(0, MAX_PROJECTED_CONCEPTS)
    .map((c) => ({
      name: c?.name, uuid: c?.uuid, dataType: c?.dataType,
      answers: (c?.answers || []).map((a) => ({ uuid: a?.uuid, name: a?.name })).slice(0, 40),
    }));

  const formsDir = path.join(bundleDir, "forms");
  const forms = fs.existsSync(formsDir)
    ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json")).slice(0, MAX_PROJECTED_FORMS)
        .map((fn) => { try { return JSON.parse(fs.readFileSync(path.join(formsDir, fn), "utf8")); } catch { return null; } })
        .filter(Boolean)
        .map((f) => ({
          name: f.name, uuid: f.uuid, formType: f.formType,
          elements: (f.formElementGroups || []).flatMap((g) => (g.formElements || []).map((fe) => ({
            name: fe?.name,
            concept: fe?.concept && typeof fe.concept === "object"
              ? { name: fe.concept.name, uuid: fe.concept.uuid, dataType: fe.concept.dataType }
              : fe?.concept,
          }))),
        }))
    : [];

  return {
    concepts,
    forms,
    subjectTypes: (safe("subjectTypes.json") || []).map((s) => ({ name: s?.name, uuid: s?.uuid })),
    programs: (safe("programs.json") || []).map((p) => ({ name: p?.name, uuid: p?.uuid })),
    encounterTypes: (safe("encounterTypes.json") || []).map((e) => ({ name: e?.name, uuid: e?.uuid })),
    formMappings: arrOf(safe("formMappings.json"), "formMappings").map((m) => ({ formUUID: m?.formUUID, subjectTypeUUID: m?.subjectTypeUUID, formType: m?.formType })),
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
