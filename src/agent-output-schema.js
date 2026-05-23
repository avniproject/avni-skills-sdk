// agent-output-schema.js — structured output contract for the three
// bundle-authoring agents (Spec / Bundle Config / Review).
//
// Matches the schema in avniproject/avni-ai prompts/spec-agent.txt verbatim
// for interop. Every agent response is markdown narrative followed by a
// fenced ```json``` block; the workflow routes on the JSON.
//
// Public API:
//   AGENT_OUTPUT_SCHEMA      — the JSON Schema constant (drives Anthropic
//                              Strict Tool Use + this validator)
//   parseAgentOutput(text)   — extract the JSON block from a markdown
//                              response, return { json, raw, errors }
//   validateAgentOutput(obj) — { ok, errors[] }

// ── Schema enums (kept aligned with avni-ai/prompts/*.txt) ──────────────

export const INTENTS = Object.freeze([
  "ask_user",        // presenting ambiguities, waiting on the user
  "applied_fix",     // mutated entities + regenerated spec/bundle
  "phase_complete",  // this agent's phase is done, route forward
  "error",           // unrecoverable
]);

export const TARGET_PHASES = Object.freeze([
  "spec_awaiting_user",
  "spec_correcting",
  "bundle_generating",
  "bundle_correcting",
  "bundle_awaiting_user",
  "rules_generating",
  "reports_generating",
  "ready_to_upload",
  "uploaded",
  "failed",
]);

export const APPLIED_CHANGE_OPERATIONS = Object.freeze([
  "add", "update", "remove",
]);

export const TARGET_SECTIONS = Object.freeze([
  "subject_types", "programs", "encounter_types", "forms",
  "groups", "address_levels", "concepts", "settings",
  "report_cards", "report_dashboards",
]);

export const TARGET_STORES = Object.freeze([
  "entities",  // canonical model (spec is regenerated from entities)
  "spec",      // spec-only fields (settings, reportDashboards metadata)
]);

// ── JSON Schema (suitable for Anthropic Strict Tool Use input_schema) ──

export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  required: ["intent", "target_phase", "reason"],
  additionalProperties: false,
  properties: {
    intent:       { type: "string", enum: [...INTENTS] },
    target_phase: { type: "string", enum: [...TARGET_PHASES] },
    reason:       { type: "string", minLength: 1, maxLength: 500 },
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "question"],
        additionalProperties: false,
        properties: {
          id:             { type: "string", minLength: 1 },
          question:       { type: "string", minLength: 1 },
          options:        { type: "array", items: { type: "string" } },
          target_section: { type: "string", enum: [...TARGET_SECTIONS] },
          target_store:   { type: "string", enum: [...TARGET_STORES] },
        },
      },
    },
    applied_changes: {
      type: "array",
      items: {
        type: "object",
        required: ["section", "operation"],
        additionalProperties: false,
        properties: {
          section:    { type: "string", enum: [...TARGET_SECTIONS] },
          operation:  { type: "string", enum: [...APPLIED_CHANGE_OPERATIONS] },
          item_names: { type: "array", items: { type: "string" } },
          reason:     { type: "string" },
        },
      },
    },
  },
};

// ── Parser ──────────────────────────────────────────────────────────────

const JSON_BLOCK_RX = /```json\s*\n([\s\S]*?)\n```/g;

/**
 * Extract the LAST fenced ```json``` block from an agent response. The last
 * one is the contract block (earlier ones may be illustrative). If no block
 * is found, returns { errors: [...] }.
 */
export function parseAgentOutput(text) {
  if (typeof text !== "string") {
    return { json: null, raw: null, errors: ["agent output must be a string"] };
  }
  const matches = [...text.matchAll(JSON_BLOCK_RX)];
  if (matches.length === 0) {
    return { json: null, raw: null, errors: ["no ```json``` block found in agent output"] };
  }
  const raw = matches[matches.length - 1][1].trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { json: null, raw, errors: [`malformed JSON: ${e.message}`] };
  }
  return { json: parsed, raw, errors: [] };
}

// ── Validator ───────────────────────────────────────────────────────────

/**
 * Validate a parsed agent output object against AGENT_OUTPUT_SCHEMA.
 * Lightweight: covers the constraints that drive workflow routing
 * (enums, requireds, shape). NOT a general-purpose JSON Schema validator.
 *
 * @param {Object} obj
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAgentOutput(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["output must be a JSON object"] };
  }
  if (!obj.intent) errors.push("intent: required");
  else if (!INTENTS.includes(obj.intent)) errors.push(`intent: must be one of ${INTENTS.join("/")}; got "${obj.intent}"`);

  if (!obj.target_phase) errors.push("target_phase: required");
  else if (!TARGET_PHASES.includes(obj.target_phase)) errors.push(`target_phase: invalid value "${obj.target_phase}"`);

  if (typeof obj.reason !== "string" || obj.reason.length === 0) errors.push("reason: required (non-empty string)");
  else if (obj.reason.length > 500) errors.push("reason: must be ≤500 characters");

  if (obj.ambiguities !== undefined) {
    if (!Array.isArray(obj.ambiguities)) errors.push("ambiguities: must be an array");
    else obj.ambiguities.forEach((a, i) => {
      if (!a || typeof a !== "object") return errors.push(`ambiguities[${i}]: must be an object`);
      if (!a.id) errors.push(`ambiguities[${i}].id: required`);
      if (!a.question) errors.push(`ambiguities[${i}].question: required`);
      if (a.target_section && !TARGET_SECTIONS.includes(a.target_section)) {
        errors.push(`ambiguities[${i}].target_section: invalid value "${a.target_section}"`);
      }
      if (a.target_store && !TARGET_STORES.includes(a.target_store)) {
        errors.push(`ambiguities[${i}].target_store: invalid value "${a.target_store}"`);
      }
    });
  }

  if (obj.applied_changes !== undefined) {
    if (!Array.isArray(obj.applied_changes)) errors.push("applied_changes: must be an array");
    else obj.applied_changes.forEach((c, i) => {
      if (!c || typeof c !== "object") return errors.push(`applied_changes[${i}]: must be an object`);
      if (!c.section) errors.push(`applied_changes[${i}].section: required`);
      else if (!TARGET_SECTIONS.includes(c.section)) errors.push(`applied_changes[${i}].section: invalid value "${c.section}"`);
      if (!c.operation) errors.push(`applied_changes[${i}].operation: required`);
      else if (!APPLIED_CHANGE_OPERATIONS.includes(c.operation)) errors.push(`applied_changes[${i}].operation: invalid value "${c.operation}"`);
    });
  }

  // Semantic guard: when intent=ask_user, ambiguities should be populated.
  if (obj.intent === "ask_user" && (!obj.ambiguities || obj.ambiguities.length === 0)) {
    errors.push('intent="ask_user" requires non-empty ambiguities array');
  }
  // When intent=applied_fix, applied_changes should be populated.
  if (obj.intent === "applied_fix" && (!obj.applied_changes || obj.applied_changes.length === 0)) {
    errors.push('intent="applied_fix" requires non-empty applied_changes array');
  }

  return { ok: errors.length === 0, errors };
}
