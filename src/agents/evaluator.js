// On-demand LLM evaluator.
//
// Takes the deterministic summary plus a sample of bundle contents and runs
// a tight Claude call to surface SEMANTIC gaps the deterministic checks miss.
// Costs $0.05–0.20 per call depending on bundle size. Always BYO key.
//
// Returns: { findings: [{title, severity, evidence, recommendation}], usage }.

import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { summarizeBundle } from "./summarizer.js";

const SYSTEM_PROMPT = `You are a senior AVNI implementation reviewer.

Your job: review a generated AVNI bundle and surface SEMANTIC gaps that a structural validator would miss — issues a human reviewer would flag during an upload-readiness audit.

Examples of semantic gaps:
  • Forms with formType ProgramEncounter exist, but Programs declared in programs.json don't logically cover them.
  • Concepts like "Pregnancy outcome", "ANC visit number" exist, but no Pregnancy program / encounter type is defined.
  • Subject types defined but no registration form for one of them.
  • formMappings link to subjectTypes that don't exist (also catches a structural issue).
  • Operational entities (operationalSubjectTypes etc.) are missing entries for declared master entities.
  • Encounter types missing eligibility rules where the SRS prose implied conditional access.

You will receive:
  - DETERMINISTIC_SUMMARY (entity counts, anomalies already flagged) — DO NOT repeat these
  - SAMPLE entities (a slice of concepts.json, forms metadata, etc.)

Your output MUST be a single JSON code block of this exact shape:
\`\`\`json
{
  "findings": [
    {
      "title": "Short headline",
      "severity": "error" | "warning" | "info",
      "evidence": "specific file paths or entity names that demonstrate this",
      "recommendation": "one sentence: what the user should do"
    }
  ],
  "summary": "one-paragraph executive summary"
}
\`\`\`

If there are zero semantic gaps, return findings: [] and say so in the summary.

Be precise. Quote entity names verbatim. Do NOT invent UUIDs. Do NOT repeat issues already in DETERMINISTIC_SUMMARY.anomalies.

Keep the response under 800 words.`;

const MAX_SAMPLE_CONCEPTS = 40;
const MAX_SAMPLE_FORMS = 6;

/**
 * @param {Object} opts
 * @param {string} opts.bundleDir
 * @param {string} opts.apiKey — Anthropic API key
 * @param {string} [opts.model] — default haiku
 * @returns {Promise<{findings, summary, usage, costUsd}>}
 */
export async function evaluateBundle({ bundleDir, apiKey, model = "claude-haiku-4-5-20251001" }) {
  if (!apiKey) throw new Error("apiKey is required");

  const det = summarizeBundle(bundleDir);
  const sample = buildSample(bundleDir);

  const userMsg = [
    "DETERMINISTIC_SUMMARY:",
    JSON.stringify({
      entityCounts: det.entityCounts,
      formTypes: det.formTypes,
      dataTypes: det.dataTypes,
      codedAnswerStats: det.codedAnswerStats,
      ruleStats: det.ruleStats,
      anomalies: det.anomalies,
    }, null, 2),
    "",
    "SAMPLE entities (for context — concepts truncated):",
    JSON.stringify(sample, null, 2),
    "",
    "Evaluate semantic gaps. Return the JSON shape specified.",
  ].join("\n");

  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = apiKey;

  let text = "";
  let usage = null;
  let costUsd = 0;
  try {
    const result = query({
      prompt: userMsg,
      options: {
        model,
        systemPrompt: SYSTEM_PROMPT,
        allowedTools: [], // no tools — single-pass reasoning
        settingSources: [],
        permissionMode: "bypassPermissions",
      },
    });
    for await (const ev of result) {
      if (ev?.type === "assistant" && ev.message?.content) {
        for (const b of ev.message.content) {
          if (b.type === "text" && b.text) text += b.text;
        }
        if (ev.message?.usage) usage = ev.message.usage;
      }
      if (ev?.type === "result" && typeof ev.total_cost_usd === "number") {
        costUsd = ev.total_cost_usd;
        if (ev.usage) usage = ev.usage;
      }
    }
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }

  // Parse the JSON block out of the agent's response
  const parsed = parseJsonBlock(text);

  return {
    findings: parsed?.findings || [],
    summary: parsed?.summary || "(parser failed — see rawText)",
    rawText: text,
    usage,
    costUsd,
    model,
  };
}

function parseJsonBlock(text) {
  // Try fenced ```json block first
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); }
  catch {
    // Fallback: extract the largest {...} block
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

// Truncated sample: enough context for semantic eval, not so much that we
// blow $1 on a single call.
function buildSample(bundleDir) {
  const safe = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

  const conceptsRaw = safe(path.join(bundleDir, "concepts.json")) || [];
  const concepts = Array.isArray(conceptsRaw) ? conceptsRaw : (conceptsRaw.concepts || []);
  const formsDir = path.join(bundleDir, "forms");
  const forms = fs.existsSync(formsDir)
    ? fs.readdirSync(formsDir).filter((f) => f.endsWith(".json"))
        .slice(0, MAX_SAMPLE_FORMS)
        .map((f) => safe(path.join(formsDir, f)))
        .filter(Boolean)
        .map((f) => ({ name: f.name, formType: f.formType, uuid: f.uuid,
                       elementCount: (f.formElementGroups || []).reduce((n, g) => n + (g.formElements || []).length, 0) }))
    : [];

  return {
    conceptsSample: concepts.slice(0, MAX_SAMPLE_CONCEPTS).map((c) => ({
      name: c.name, uuid: c.uuid, dataType: c.dataType,
      answerCount: (c.answers || []).length,
    })),
    formsMetadata: forms,
    subjectTypes: (safe(path.join(bundleDir, "subjectTypes.json")) || []).map((s) => ({ name: s.name, uuid: s.uuid })),
    programs: (safe(path.join(bundleDir, "programs.json")) || []).map((p) => ({ name: p.name, uuid: p.uuid })),
    encounterTypes: (safe(path.join(bundleDir, "encounterTypes.json")) || []).map((e) => ({ name: e.name, uuid: e.uuid })),
  };
}
