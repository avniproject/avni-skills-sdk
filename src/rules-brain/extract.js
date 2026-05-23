// Layer 1 — deterministic SRS → IR extractor.
//
// Given parsed SRS rows (from srs-bundle-generator/parsers/srs_parser.js, which
// already produces {skipLogic, validation, ...} objects) plus a concepts table
// (so we can resolve field names → concept UUIDs), emit DeclarativeRule IR
// JSON ready to feed into Layer-3 compile().
//
// Structured extractors (caller already parsed the SRS into shape):
//   - extractFormElementRuleFromSkipLogic(skipLogic, conceptLookup) → IR | null
//   - extractFormValidationRuleFromRange(validation, conceptLookup) → IR | null
//
// Text-driven extractors (caller has raw cell text from a Modelling sheet):
//   - parseConditionText(text)                            → structured | null
//   - extractFormElementRuleFromText(text, conceptLookup) → IR | null   (skip-logic)
//   - extractEligibilityRuleFromText(text, conceptLookup) → IR | null   (program/encounter)
//   - extractFormValidationRuleFromText(text, conceptName, lookup) → IR | null
//
// `conceptLookup` is a function:  (conceptName) => { uuid, dataType, answers: [{name, uuid}] } | null

// Map skipLogic.condition (from srs_parser) → declarative operator + RHS type
const SKIPLOGIC_OPERATOR_MAP = {
  equals:                "equals",
  notEquals:             "equals", // wrap as { Equals + not } at action level — for now emit as-is
  defined:               "defined",
  notDefined:            "notDefined",
  greaterThan:           "greaterThan",
  greaterThanOrEquals:   "greaterThanOrEqualTo",
  lessThan:              "lessThan",
  lessThanOrEquals:      "lessThanOrEqualTo",
  contains:              "containsAnyAnswerConceptName",
  containsAny:           "containsAnyAnswerConceptName",
  notContains:           "containsAnswerConceptNameOtherThan",
};

function buildRule(parsed, conceptLookup, scope) {
  if (!parsed || parsed.raw) return null; // unparseable — bail to agent
  if (parsed.compound) {
    const ruleParts = parsed.parts.map((p) => buildRule(p, conceptLookup, scope)).filter(Boolean);
    if (ruleParts.length < 2) return null;
    return {
      compound: true,
      conjunction: parsed.conjunction === "OR" ? "or" : "and",
      rules: ruleParts,
    };
  }
  const concept = conceptLookup(parsed.dependsOn);
  if (!concept) return null; // can't resolve, bail to agent
  const op = SKIPLOGIC_OPERATOR_MAP[parsed.condition];
  if (!op) return null;

  const lhs = {
    type: "concept",
    conceptName: parsed.dependsOn,
    conceptUuid: concept.uuid,
    conceptDataType: concept.dataType || "Text",
    scope: scope || "encounter",
  };

  if (op === "defined" || op === "notDefined") {
    // RHS.fromResource expects an object even for noRHS operators —
    // empty {} round-trips cleanly through validate + emit.
    return { lhs, operator: op, rhs: {} };
  }

  // Coded with answer-name value(s)
  if (concept.dataType === "Coded" && (concept.answers || []).length > 0) {
    const wantValues = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    const resolved = wantValues.map((v) => {
      const ans = concept.answers.find((a) => a.name === v || a.name?.toLowerCase() === String(v).toLowerCase());
      return ans ? { name: ans.name, uuid: ans.uuid } : null;
    });
    if (resolved.some((r) => !r)) return null; // unknown answer, bail
    return {
      lhs,
      operator: op,
      rhs: {
        type: "answerConcept",
        answerConceptNames: resolved.map((r) => r.name),
        answerConceptUuids: resolved.map((r) => r.uuid),
      },
    };
  }

  // Numeric or text — value RHS
  const value = parsed.value;
  if (value == null) return null;
  const coercedNum = Number(value);
  const isNumeric = !Number.isNaN(coercedNum) && /^-?\d+(\.\d+)?$/.test(String(value).trim());
  return {
    lhs,
    operator: op,
    rhs: { type: "value", value: isNumeric ? coercedNum : String(value) },
  };
}

function intoCompoundRule(rule) {
  if (!rule) return null;
  if (rule.compound) {
    return {
      conjunction: rule.conjunction,
      // Webapp visual builder accepts up to 2 levels; we only emit 1.
      rules: rule.rules.filter((r) => !r.compound),
    };
  }
  return { conjunction: "and", rules: [rule] };
}

/**
 * Build a viewFilter IR (single DeclarativeRule wrapped in an array) for a
 * formElement.rule field, from a parsed skipLogic object.
 *
 * @param {object} skipLogic        output of srs_parser.parseSkipLogic
 * @param {function} conceptLookup  (name) => {uuid, dataType, answers[]} | null
 * @param {string=} scope           "registration" | "enrolment" | "encounter"
 * @returns {Array|null} DeclarativeRule[] or null if SRS signal can't be turned into IR
 */
export function extractFormElementRuleFromSkipLogic(skipLogic, conceptLookup, scope = "encounter") {
  const rule = buildRule(skipLogic, conceptLookup, scope);
  if (!rule) return null;
  const compoundRule = intoCompoundRule(rule);
  if (!compoundRule || compoundRule.rules.length === 0) return null;
  return [{
    conditions: [{
      conjunction: "and",
      compoundRule,
    }],
    actions: [{ actionType: "showFormElement", details: {} }],
  }];
}

/**
 * Build a formValidation IR from a {min, max} validation object.
 * The IR encodes: "the entity's referenced concept must be within [min, max]".
 * For v1 we emit ONE compound check per (conceptName, min, max) tuple.
 *
 * @param {object} validation       { min?, max? }
 * @param {string} conceptName      the form-element's concept name (must be Numeric)
 * @param {function} conceptLookup
 * @param {string=} scope
 * @returns {Array|null}
 */
export function extractFormValidationRuleFromRange(validation, conceptName, conceptLookup, scope = "encounter") {
  if (!validation || (validation.min == null && validation.max == null)) return null;
  const concept = conceptLookup(conceptName);
  if (!concept || concept.dataType !== "Numeric") return null;

  const lhs = {
    type: "concept",
    conceptName,
    conceptUuid: concept.uuid,
    conceptDataType: "Numeric",
    scope,
  };

  const rules = [];
  if (validation.min != null) {
    rules.push({
      lhs, operator: "lessThan",
      rhs: { type: "value", value: validation.min },
    });
  }
  if (validation.max != null) {
    rules.push({
      lhs, operator: "greaterThan",
      rhs: { type: "value", value: validation.max },
    });
  }

  // OR the two — if value out of range either side → trigger error.
  return [{
    conditions: [{
      conjunction: "and",
      compoundRule: { conjunction: rules.length > 1 ? "or" : "and", rules },
    }],
    actions: [{
      actionType: "formValidationError",
      details: { validationError: `${conceptName} must be within ${validation.min ?? "-∞"} and ${validation.max ?? "+∞"}` },
    }],
  }];
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT → STRUCTURED parsers (Phase 7 — close the SRS-prose → IR loop)
//
// The brain's existing parsers (avni-skills/srs-bundle-generator/scripts/
// generate_bundle_v2.js) only parse SKIP-LOGIC text columns. These helpers
// extend the coverage to validation + eligibility text, all going through
// the same `buildRule` / Layer-3 compile path. Decision + visit-schedule
// rule IRs have structurally different shapes (decisionResults vs. visit
// schedules, not concept conditions) — those stay agent-authored for now.
// ═══════════════════════════════════════════════════════════════════════════

// Grammar — small + explicit. Each row maps a textual operator (case-
// insensitive, whitespace-tolerant) to the internal SKIPLOGIC_OPERATOR_MAP
// keys. Two-word operators MUST come before their one-word prefixes so the
// matcher doesn't shortcut "is" before seeing "is not defined".
const TEXT_OPERATORS = [
  { re: /\s+is\s+not\s+defined\b/i,                 op: "notDefined",          needsValue: false },
  { re: /\s+is\s+defined\b/i,                       op: "defined",             needsValue: false },
  { re: /\s+is\s+not\s+empty\b/i,                   op: "defined",             needsValue: false },
  { re: /\s+is\s+empty\b/i,                         op: "notDefined",          needsValue: false },
  { re: /\s+not\s+in\s+/i,                          op: "notContains",         needsValue: true, list: true },
  { re: /\s+in\s+/i,                                op: "containsAny",         needsValue: true, list: true },
  { re: /\s+contains\s+/i,                          op: "contains",            needsValue: true },
  { re: /\s*(!=|<>|≠)\s*/,                          op: "notEquals",           needsValue: true },
  { re: /\s*(>=|≥)\s*/,                             op: "greaterThanOrEquals", needsValue: true },
  { re: /\s*(<=|≤)\s*/,                             op: "lessThanOrEquals",    needsValue: true },
  { re: /\s*=\s*|\s+equals\s+|\s+is\s+/i,           op: "equals",              needsValue: true },
  { re: /\s*>\s*/,                                  op: "greaterThan",         needsValue: true },
  { re: /\s*<\s*/,                                  op: "lessThan",            needsValue: true },
];

const CONJUNCTION_RE = /\s+(AND|OR)\s+/i;
const LIST_RE = /^\s*\(\s*([^)]+)\s*\)\s*$/;     // "(a, b, c)" → "a, b, c"

function parseAtom(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  for (const { re, op, needsValue, list } of TEXT_OPERATORS) {
    const m = trimmed.match(re);
    if (!m) continue;
    const idx = m.index;
    const lhs = trimmed.slice(0, idx).trim();
    if (!lhs) continue;
    if (!needsValue) {
      return { dependsOn: lhs, condition: op };
    }
    const rhs = trimmed.slice(idx + m[0].length).trim();
    if (!rhs) return null;
    if (list) {
      const listMatch = rhs.match(LIST_RE);
      const items = listMatch
        ? listMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
        : rhs.split(",").map((s) => s.trim()).filter(Boolean);
      if (items.length === 0) return null;
      return { dependsOn: lhs, condition: op, value: items.length === 1 ? items[0] : items };
    }
    // Strip surrounding quotes
    const value = rhs.replace(/^['"`](.*)['"`]$/, "$1");
    return { dependsOn: lhs, condition: op, value };
  }
  return null;
}

/**
 * Parse a text condition into the structured shape buildRule consumes.
 * Supports atomic conditions + AND/OR composition (single level — webapp
 * visual builder accepts up to 2 levels but we keep it flat for now).
 *
 * @param {string} text
 * @returns {object|null}  { dependsOn, condition, value? } | { compound:true, conjunction, parts:[...] } | null
 */
export function parseConditionText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  // Split on top-level AND/OR. We don't honour parentheses for grouping;
  // a single conjunction in the whole expression is the supported shape.
  const parts = [];
  let conjunction = null;
  const splits = trimmed.split(CONJUNCTION_RE);
  if (splits.length === 1) {
    return parseAtom(trimmed);
  }
  for (let i = 0; i < splits.length; i++) {
    if (i % 2 === 0) {
      const atom = parseAtom(splits[i]);
      if (!atom) return null;
      parts.push(atom);
    } else {
      const conj = splits[i].toUpperCase();
      if (conjunction && conjunction !== conj) return null;   // mixed AND+OR — bail
      conjunction = conj;
    }
  }
  if (parts.length < 2) return null;
  return { compound: true, conjunction, parts };
}

/**
 * Text → viewFilter IR (skip-logic / formElement.rule).
 * Wraps parseConditionText + the existing buildRule pipeline.
 */
export function extractFormElementRuleFromText(text, conceptLookup, scope = "encounter") {
  const parsed = parseConditionText(text);
  if (!parsed) return null;
  return extractFormElementRuleFromSkipLogic(parsed, conceptLookup, scope);
}

/**
 * Text → eligibility IR (program/encounter eligibility check).
 * Eligibility uses the same condition shape as viewFilter; only the action
 * differs ("eligible" boolean vs "showFormElement"). Caller picks
 * ruleType="eligibility" + entityName="individual" when compiling.
 */
export function extractEligibilityRuleFromText(text, conceptLookup, scope = "registration") {
  const parsed = parseConditionText(text);
  if (!parsed) return null;
  const rule = buildRule(parsed, conceptLookup, scope);
  if (!rule) return null;
  const compoundRule = intoCompoundRule(rule);
  if (!compoundRule || compoundRule.rules.length === 0) return null;
  return [{
    conditions: [{
      conjunction: "and",
      compoundRule,
    }],
    actions: [{ actionType: "setEligibility", details: {} }],
  }];
}

/**
 * Text → formValidation IR.
 * Supports two text shapes:
 *   "<concept> must be between <min> and <max>"   (parses the numbers)
 *   "<concept> must be >= <min>"                  (single bound)
 * Falls back to the structured `extractFormValidationRuleFromRange` once
 * the bounds are extracted.
 */
export function extractFormValidationRuleFromText(text, conceptName, conceptLookup, scope = "encounter") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  // "between X and Y" — accept "must be between", "should be between",
  // "in range", etc.
  const betweenMatch = trimmed.match(/(?:between|range\s*[:\-]?\s*)\s*(-?\d+(?:\.\d+)?)\s+(?:and|to|-)\s+(-?\d+(?:\.\d+)?)/i);
  if (betweenMatch) {
    return extractFormValidationRuleFromRange(
      { min: Number(betweenMatch[1]), max: Number(betweenMatch[2]) },
      conceptName, conceptLookup, scope,
    );
  }
  // Single-bound: "must be >= 18", "should be < 200"
  const singleMatch = trimmed.match(/(>=|<=|>|<|≥|≤)\s*(-?\d+(?:\.\d+)?)/);
  if (singleMatch) {
    const opSym = singleMatch[1];
    const n = Number(singleMatch[2]);
    if (opSym === ">=" || opSym === "≥") return extractFormValidationRuleFromRange({ min: n }, conceptName, conceptLookup, scope);
    if (opSym === "<=" || opSym === "≤") return extractFormValidationRuleFromRange({ max: n }, conceptName, conceptLookup, scope);
    if (opSym === ">")                    return extractFormValidationRuleFromRange({ min: n + 0.0001 }, conceptName, conceptLookup, scope);
    if (opSym === "<")                    return extractFormValidationRuleFromRange({ max: n - 0.0001 }, conceptName, conceptLookup, scope);
  }
  return null;
}
