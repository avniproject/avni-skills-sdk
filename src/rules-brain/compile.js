// Thin wrapper around the vendored rules-config declarative compiler.
//
// Public API:
//   compile(ir, ruleType, entityName) → { js, error? }
//   validateIr(ir) → { valid, errors[] }
//   listRuleTypes() → [ruleType]
//   entityNameForRuleField(field, formType) → string
//
// `ruleType` is one of:
//   viewFilter | formElementGroup | eligibility | formValidation | decision | visitSchedule
//
// `ir` is an array of DeclarativeRule JSON objects (the IR shape rules-config
// and the Avni webapp's visual builder both round-trip).
//
// We DO NOT reimplement the IR→JS path; we vendor the canonical compiler from
// rules-config-master/src/rules/declarative/ and call DeclarativeRuleHolder.
// See ../../docs/rules-brain/04-emitter-templates.md.

import { DeclarativeRuleHolder } from "./vendor/declarative/index.js";

// Whitelist of rule types and their underlying emitter method on the holder.
const EMITTERS = {
  viewFilter: "generateViewFilterRule",
  formElementGroup: "generateFormElementGroupRule",
  eligibility: "generateEligibilityRule",
  formValidation: "generateFormValidationRule",
  decision: "generateDecisionRule",
  visitSchedule: "generateVisitScheduleRule",
};

// Bundle JSON field → ruleType + default entityName (per docs 04).
// Caller may override entityName when the form's formType disambiguates.
const FIELD_MAP = {
  "form.decisionRule":                   { ruleType: "decision",       entityName: "programEncounter" },
  "form.validationRule":                 { ruleType: "formValidation", entityName: "programEncounter" },
  "form.visitScheduleRule":              { ruleType: "visitSchedule",  entityName: "programEncounter" },
  "form.formElement.rule":               { ruleType: "viewFilter",     entityName: "programEncounter" },
  "form.formElementGroup.rule":          { ruleType: "formElementGroup", entityName: "programEncounter" },
  "encounterType.encounterEligibilityCheckRule": { ruleType: "eligibility", entityName: "individual" },
  "program.enrolmentEligibilityCheckRule":       { ruleType: "eligibility", entityName: "individual" },
  "program.manualEnrolmentEligibilityCheckRule": { ruleType: "eligibility", entityName: "individual" },
};

// formType (from forms/*.json) → default entity binding when generating rules.
const FORM_TYPE_ENTITY = {
  IndividualProfile: "individual",
  Encounter: "encounter",
  ProgramEnrolment: "programEnrolment",
  ProgramEncounter: "programEncounter",
  ProgramExit: "programEnrolment",
  IndividualEncounterCancellation: "encounter",
  ProgramEncounterCancellation: "programEncounter",
};

export function listRuleTypes() {
  return Object.keys(EMITTERS);
}

export function entityNameForRuleField(field, formType) {
  const base = FIELD_MAP[field];
  if (!base) return null;
  if (base.ruleType === "eligibility") return "individual";
  if (formType && FORM_TYPE_ENTITY[formType]) return FORM_TYPE_ENTITY[formType];
  return base.entityName;
}

export function ruleTypeForField(field) {
  return FIELD_MAP[field]?.ruleType || null;
}

/**
 * Validate an IR before compilation. Returns { valid, errors[] }.
 * Wraps DeclarativeRuleHolder.validateAndGetError() — the same path the
 * webapp uses before saving a rule.
 */
export function validateIr(ir) {
  if (!Array.isArray(ir)) return { valid: false, errors: ["ir must be an array of DeclarativeRule objects"] };
  if (ir.length === 0)   return { valid: true,  errors: [] };
  try {
    const holder = DeclarativeRuleHolder.fromResource(ir);
    if (holder.isEmpty()) return { valid: true, errors: [] };
    const err = holder.validateAndGetError();
    if (err) return { valid: false, errors: [err] };
    return { valid: true, errors: [] };
  } catch (e) {
    return { valid: false, errors: [e.message] };
  }
}

/**
 * Compile an IR to a JS rule body string.
 * @param {Array} ir          DeclarativeRule[] (the IR shape)
 * @param {string} ruleType   one of EMITTERS keys
 * @param {string} entityName one of {individual, encounter, programEnrolment, programEncounter}
 * @returns {{js: string|null, error?: string}}
 */
export function compile(ir, ruleType, entityName) {
  if (!EMITTERS[ruleType]) {
    return { js: null, error: `unknown ruleType: ${ruleType}. Expected one of ${Object.keys(EMITTERS).join("/")}` };
  }
  if (!Array.isArray(ir)) {
    return { js: null, error: "ir must be an array of DeclarativeRule objects" };
  }
  if (ir.length === 0) return { js: null };

  const holder = DeclarativeRuleHolder.fromResource(ir);
  if (holder.isEmpty()) return { js: null };

  const err = holder.validateAndGetError();
  if (err) return { js: null, error: err };

  const method = EMITTERS[ruleType];
  // eligibility generator hardcodes 'individual', ignores entityName
  const args = ruleType === "eligibility" ? [] : [entityName || "programEncounter"];
  const js = holder[method](...args);
  return { js };
}

/**
 * Compile a single rule by bundle-JSON field path.
 *   compileByField([...ir], "form.decisionRule", { formType: "ProgramEncounter" })
 */
export function compileByField(ir, field, { formType } = {}) {
  const ruleType = ruleTypeForField(field);
  if (!ruleType) return { js: null, error: `unknown bundle field: ${field}` };
  const entityName = entityNameForRuleField(field, formType);
  return compile(ir, ruleType, entityName);
}
