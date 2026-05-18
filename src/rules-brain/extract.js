// Layer 1 — deterministic SRS → IR extractor.
//
// Given parsed SRS rows (from srs-bundle-generator/parsers/srs_parser.js, which
// already produces {skipLogic, validation, ...} objects) plus a concepts table
// (so we can resolve field names → concept UUIDs), emit DeclarativeRule IR
// JSON ready to feed into Layer-3 compile().
//
// Scope of Layer 1: SRS signals that map cleanly. Free-text prose stays in
// the SRS column and is handled by Layer 2 (agent).
//
// Two extractors supported in v1:
//   - extractFormElementRuleFromSkipLogic(skipLogic, conceptLookup) → IR | null
//   - extractFormValidationRuleFromRange(validation, conceptLookup) → IR | null
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
