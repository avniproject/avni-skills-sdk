// src/comprehension/comprehend.js — the single-Opus-pass scoping comprehension.
//
// The AI front-end of the noise-tolerant bundle pipeline (design.md). A
// deterministic generator emits a DRAFT bundle from messy org scoping/modelling
// xlsx docs, dropping/mangling noisy input (options-in-prose, sheet-name
// truncation, duplicate sheets, registration drift). This module makes ONE Opus
// call that reads the RAW docs — INCLUDING prose/narrative cells — alongside the
// draft-bundle projection and returns a PROVENANCED correction patch that the
// deterministic patcher (apply-patch.js) applies.
//
// Opus EXTRACTS corrections that are stated-in-noise; it must NEVER invent. Every
// op requires provenance (sheet + cell/row) — patch-schema.validatePatch drops
// any op that lacks it. This module NEVER throws and clean-skips without a key,
// mirroring ai-judge.js's callModel + parseJsonBlock mechanism (query + JSON
// block parse — NOT a structured-output tool).

import fs from "node:fs";
import XLSX from "xlsx"; // SheetJS is CJS — default import gives module.exports (readFile/utils)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { BLOCKED_ACCOUNT_MCP_SERVERS, blockAccountMcpPreToolUseHook } from "../agent.js";
import { buildBundleProjection } from "../crl/ai-judge.js";
import { validatePatch } from "./patch-schema.js";

// Size guards — keep the whole raw-doc rendering present (prose is the point) but
// bounded so the single request stays budget-sane. A very long prose cell is
// truncated (kept present, flagged), and the total rendering is capped.
const MAX_CELL_CHARS = 800;
const MAX_TOTAL_CHARS = 140000;
// The single Opus call is non-deterministic; a run can occasionally return prose
// with no parseable JSON block (observed once on Doorstep). Retry a bounded number
// of times before surfacing the failure — a silent empty patch would masquerade as
// "nothing to correct" and skip real fixes.
const DEFAULT_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You are a SCOPING-COMPREHENSION pass for AVNI bundle generation.

A deterministic generator produced a DRAFT bundle from messy org scoping/modelling spreadsheets. The generator is faithful to CLEAN input but brittle to noise: it drops options that live only in a prose narrative, mangles names truncated at 31 chars, misclassifies a subject's registration form as an Encounter, keeps a subject on the wrong type, leaks test-data / rubric sheets as entities, and duplicates entities from duplicate donor sheets.

Your job: compare the RAW DOCS against the DRAFT BUNDLE PROJECTION and emit a CORRECTION PATCH of grounded ops that fix ONLY distortions the RAW DOCS actually state.

ANTI-FABRICATION — this is the whole point:
  • You EXTRACT corrections stated-in-noise. You NEVER invent. Extracting options that a prose cell states is legitimate; inventing options the docs never mention is fabrication and is forbidden.
  • Do NOT add answer options, entities, subjects, or fields that are not present somewhere in the RAW DOCS.
  • EVERY op MUST carry provenance: the exact sheet plus the cell (A1 form, e.g. "B14") or row number where the correction is grounded. An op without provenance will be DROPPED — so omitting provenance loses the fix.
  • If you are not sure a correction is stated in the docs, DO NOT emit it. A precise empty patch is correct; a fabricated op is a defect.
  • Quote concept / form / subject-type names VERBATIM from the DRAFT BUNDLE PROJECTION (that is what the patcher matches on).

Keep the response focused. Output MUST be a single JSON code block and nothing else.`;

function truncCell(v) {
  const s = v == null ? "" : String(v);
  if (s.length <= MAX_CELL_CHARS) return s;
  return s.slice(0, MAX_CELL_CHARS) + `…[+${s.length - MAX_CELL_CHARS} chars]`;
}

// Compact, prose-PRESERVING rendering of one workbook. Row-oriented with A1 cell
// coords so the model can ground provenance as {sheet,cell:"B14"} or {sheet,row:n}.
// Returns { text, truncated }.
function renderWorkbook(label, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { text: `## ${label}: (not provided)\n`, truncated: false };
  }
  let wb;
  try { wb = XLSX.readFile(filePath); }
  catch (e) { return { text: `## ${label}: (could not parse: ${e.message})\n`, truncated: false }; }

  const parts = [`## ${label} — sheets: ${(wb.SheetNames || []).join(", ") || "(none)"}`];
  let used = parts[0].length;
  let truncated = false;

  for (const name of wb.SheetNames || []) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
    const cols = aoa.reduce((m, r) => Math.max(m, r.length), 0);
    const header = `\n### Sheet: ${name}  (${aoa.length} rows × ${cols} cols)`;
    parts.push(header); used += header.length;

    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const cells = [];
      for (let c = 0; c < row.length; c++) {
        const val = truncCell(row[c]);
        if (val === "" || val == null) continue;
        cells.push(`${XLSX.utils.encode_col(c)}=${JSON.stringify(val)}`);
      }
      if (!cells.length) continue;
      const line = `\nR${r + 1}: ${cells.join(" | ")}`;
      if (used + line.length > MAX_TOTAL_CHARS) {
        parts.push(`\n…[rendering truncated at ${MAX_TOTAL_CHARS} chars — later rows/sheets omitted]`);
        truncated = true;
        return { text: parts.join(""), truncated };
      }
      parts.push(line); used += line.length;
    }
  }
  return { text: parts.join(""), truncated };
}

function buildUserMessage(scopingRender, modellingRender, projection) {
  return [
    "RAW DOCS (verbatim, prose/narrative cells preserved — cite these for provenance):",
    scopingRender.text,
    "",
    modellingRender.text,
    (scopingRender.truncated || modellingRender.truncated)
      ? "\n(NOTE: a doc rendering was truncated for size; ground ops only in cells you can actually see.)"
      : "",
    "",
    "DRAFT BUNDLE PROJECTION (the deterministic draft to CORRECT — match names verbatim from here):",
    JSON.stringify(projection, null, 2),
    "",
    "CORRECTION-PATCH OP VOCABULARY (use ONLY these ops; each also needs `provenance`):",
    [
      '  • add-answers     — attach stated options to an existing Coded concept. Fields: concept (existing concept name), answers (non-empty string[]).',
      '  • reclassify-form — change a form\'s formType (e.g. Encounter → IndividualProfile). Fields: form (form name), formType (string).',
      '  • set-subject     — point a form\'s mapping at a different subject type. Fields: form (form name), subjectType (existing subject-type name).',
      '  • drop-entity     — remove a stray/leaked entity + dependents. Fields: entityKind ("concept"|"form"|"encounterType"), name OR uuid.',
      '  • merge-entities  — fold a duplicate into its canonical twin. Fields: duplicate, canonical, entityKind.',
      '  • set-field       — set a scalar on an entity when the doc states it. Fields: entityKind, name OR uuid, field (string), value.',
    ].join("\n"),
    "",
    "PROVENANCE (REQUIRED on every op): { \"sheet\": \"<sheet name>\", \"cell\": \"<A1>\" }  OR  { \"sheet\": \"<sheet name>\", \"row\": <number> }.",
    "",
    "EXAMPLES (shape only — emit these ONLY if the docs actually state them):",
    "  Gender's options appear only in a prose narrative cell:",
    '    { "op": "add-answers", "concept": "Gender", "answers": ["Male", "Female"], "provenance": { "sheet": "Notes", "cell": "B14" } }',
    "  The doc names \"Student Register\" as the Student subject's registration form, but the draft made it an Encounter:",
    '    { "op": "reclassify-form", "form": "Student Register", "formType": "IndividualProfile", "provenance": { "sheet": "Forms", "row": 3 } }',
    "  A test-data / rubric sheet leaked in as an entity:",
    '    { "op": "drop-entity", "entityKind": "encounterType", "name": "FLN Perf Sample data", "provenance": { "sheet": "Scoring Rubric", "row": 1 } }',
    "",
    "Return EXACTLY this JSON code block (an empty corrections array is valid and correct when nothing is grounded):",
    "```json",
    '{ "corrections": [ /* grounded ops only, each with provenance */ ] }',
    "```",
  ].join("\n");
}

// Extract the JSON patch object from the model's text. Mirrors ai-judge.js
// parseJsonBlock: prefer a ```json fence, else the first {...} span. Never throws.
export function parseJsonBlock(text) {
  const fenced = String(text).match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); }
  catch {
    const m = String(candidate).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

// Single model call via the SDK query stream — copies ai-judge.js's callModel
// mechanism (query + text accumulation), account-MCP blocked, no tools.
async function callModel(model, userMsg) {
  let text = "";
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
    }
  }
  return { text };
}

/**
 * ONE Opus comprehension pass over the raw scoping/modelling docs + the draft
 * bundle → a provenanced correction patch (validated, never applied here).
 *
 * @param {string} bundleDir  the deterministic DRAFT bundle to correct.
 * @param {{scopingXlsx?:string, modellingXlsx?:string, model?:string, attempts?:number}} [opts]
 * @returns {Promise<{patch:object|null, valid:object[], dropped:object[], skipped?:string, error?:string}>}
 *   NEVER throws. { patch: null, valid: [], dropped: [], skipped } with no key;
 *   { patch: null, valid: [], dropped: [], error } when every attempt returns an
 *   unparseable response or on any failure. An empty { corrections: [] } is a
 *   SUCCESS (patch present, no valid ops) — distinct from an unparseable failure.
 */
export async function comprehendBundle(bundleDir, { scopingXlsx, modellingXlsx, model = "claude-opus-4-8", attempts = DEFAULT_ATTEMPTS } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { patch: null, valid: [], dropped: [], skipped: "no ANTHROPIC_API_KEY" };
  }
  try {
    const scopingRender = renderWorkbook("SCOPING DOC", scopingXlsx);
    const modellingRender = renderWorkbook("MODELLING DOC", modellingXlsx);
    const projection = buildBundleProjection(bundleDir);
    const userMsg = buildUserMessage(scopingRender, modellingRender, projection);

    const tries = Math.max(1, attempts | 0);
    let patch = null;
    let lastLen = 0;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const { text } = await callModel(model, userMsg);
      lastLen = text ? text.length : 0;
      if (process.env.COMPREHEND_DEBUG) { try { fs.writeFileSync(process.env.COMPREHEND_DEBUG, text); } catch {} }
      const parsed = parseJsonBlock(text);
      // A usable response has a corrections array (possibly empty = nothing to
      // correct, a valid terminal result). Null/malformed → retry, don't mask.
      if (parsed && Array.isArray(parsed.corrections)) { patch = parsed; break; }
    }

    if (!patch) {
      return { patch: null, valid: [], dropped: [], error: `unparseable model response after ${tries} attempt(s) (last length ${lastLen})` };
    }
    const { valid, dropped } = validatePatch(patch);
    return { patch, valid, dropped };
  } catch (e) {
    return { patch: null, valid: [], dropped: [], error: e.message };
  }
}
