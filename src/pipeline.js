// pipeline.js — production-path orchestrator: YAML spec → patched bundle.
//
// Composes the brain's parser/patcher/graph (CJS, in avni-skills) with the
// SDK's rules-brain compiler (ESM, in this repo) to deliver the full
// "edit-an-existing-bundle" flow that the avni-ai team's /patch-bundle
// describes:
//
//   1. Parse the YAML spec into entities.
//   2. Walk entities for any *DeclarativeRule fields → compile to JS via
//      rules-brain → set the corresponding *Rule field. Hand-authored JS
//      rules pass through untouched.
//   3. Merge entities into the existing bundle's file map (patcher).
//   4. Run the dependency-graph integrity check on the patched state.
//   5. Return diff + materialization audit + integrity report.
//
// Public API:
//   applySpec({ existingBundleFiles, specYaml, materialize?, integrityCheck? })
//     → { patchedFiles, diff, filesChanged, ruleCompilation, integrity }
//
//   materializeRules(entities, { ruleCompiler? }) → { entities, compiled, errors }
//     (exported standalone so the agent loop or tests can run it without
//      patching a bundle.)

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Resolve brain path the same way other SDK code does (env or sibling clone).
function resolveBrainPath() {
  if (process.env.AVNI_SKILLS_PATH) return process.env.AVNI_SKILLS_PATH;
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "avni-skills");
}

const brainPath = resolveBrainPath();
const { specToEntities }                                    = require(path.join(brainPath, "srs-bundle-generator/spec/parser.js"));
const { patchBundle, summarizeDiff }                        = require(path.join(brainPath, "srs-bundle-generator/spec/patcher.js"));
const { buildBundleGraph, integrityCheck }                  = require(path.join(brainPath, "srs-bundle-generator/spec/graph.js"));
const { bundleFromZip, bundleToZip }                        = require(path.join(brainPath, "srs-bundle-generator/spec/bundle-io.js"));

import { compileByField, ruleTypeForField } from "./rules-brain/compile.js";

// ─── Declarative-IR → JS rule materialization ────────────────────────

// Map from "entity-shape declarative-field" → { fieldOnEntity to read IR from,
// jsField to write the compiled JS into, ruleType to invoke }.
//
// The keys here are NOT bundle JSON paths — they're traversal hints. The
// patcher's job is to land these on the right bundle file; here we transform
// the entities object before it reaches the patcher.
const ENTITY_DECL_RULE_MAP = [
  { kind: "program",       declField: "enrolmentEligibilityCheckDeclarativeRule",
    jsField: "enrolmentEligibilityCheckRule", bundleField: "program.enrolmentEligibilityCheckRule" },
  { kind: "program",       declField: "manualEnrolmentEligibilityCheckDeclarativeRule",
    jsField: "manualEnrolmentEligibilityCheckRule", bundleField: "program.manualEnrolmentEligibilityCheckRule" },
  { kind: "encounterType", declField: "entityEligibilityCheckDeclarativeRule",
    jsField: "encounterEligibilityCheckRule", bundleField: "encounterType.encounterEligibilityCheckRule" },
];

// Form-level + form-element-level rules. These live inside forms[*] entries
// produced by the parser (formElementGroups → formElements → declarativeRule).
const FORM_DECL_RULE_MAP = [
  // top-level form rules
  { declField: "decisionDeclarativeRule",       jsField: "decisionRule",       bundleField: "form.decisionRule" },
  { declField: "validationDeclarativeRule",     jsField: "validationRule",     bundleField: "form.validationRule" },
  { declField: "visitScheduleDeclarativeRule",  jsField: "visitScheduleRule",  bundleField: "form.visitScheduleRule" },
];

// per-form-element
const FORM_ELEMENT_DECL_FIELD = "declarativeRule";          // → "rule" (viewFilter)
const FORM_ELEMENT_JS_FIELD   = "rule";
const FORM_ELEMENT_BUNDLE_FIELD = "form.formElement.rule";

export function materializeRules(entities, opts = {}) {
  const compiled = [];
  const errors = [];
  const ruleCompiler = opts.ruleCompiler || compileByField;

  function tryCompile(ir, bundleField, formType, locator) {
    const ruleType = ruleTypeForField(bundleField);
    if (!ruleType) return null;     // unknown — leave alone
    const result = ruleCompiler(ir, bundleField, { formType });
    if (result.error) {
      errors.push({ locator, bundleField, ruleType, error: result.error });
      return null;
    }
    if (!result.js) return null;
    compiled.push({ locator, bundleField, ruleType, jsBytes: result.js.length });
    return result.js;
  }

  // Entity-level (program, encounterType)
  for (const { kind, declField, jsField, bundleField } of ENTITY_DECL_RULE_MAP) {
    const coll = kind === "program" ? entities.programs : entities.encounter_types;
    for (const e of (coll || [])) {
      const ir = e[declField];
      if (!Array.isArray(ir) || ir.length === 0) continue;
      const js = tryCompile(ir, bundleField, null, `${kind}["${e.name}"]`);
      if (js) e[jsField] = js;
    }
  }

  // Form-level + form-element-level
  for (const form of (entities.forms || [])) {
    const formType = form.formType;
    // top-level form rules
    for (const { declField, jsField, bundleField } of FORM_DECL_RULE_MAP) {
      const ir = form[declField];
      if (!Array.isArray(ir) || ir.length === 0) continue;
      const js = tryCompile(ir, bundleField, formType, `form["${form.name || form.uuid}"].${declField}`);
      if (js) form[jsField] = js;
    }
    // per-form-element
    for (const grp of (form.formElementGroups || [])) {
      for (const fe of (grp.formElements || [])) {
        const ir = fe[FORM_ELEMENT_DECL_FIELD];
        if (!Array.isArray(ir) || ir.length === 0) continue;
        const js = tryCompile(
          ir, FORM_ELEMENT_BUNDLE_FIELD, formType,
          `form["${form.name || form.uuid}"].formElement["${fe.name}"]`,
        );
        if (js) fe[FORM_ELEMENT_JS_FIELD] = js;
      }
    }
  }

  return { entities, compiled, errors };
}

// ─── End-to-end orchestrator ─────────────────────────────────────────

/**
 * Apply a YAML spec onto an existing bundle.
 *
 * Accepts the existing bundle as either a fileMap or a ZIP Buffer. When a
 * ZIP is supplied, output also includes a `patchedZip` Buffer ready to upload.
 *
 * @param {Object} args
 * @param {Object} [args.existingBundleFiles]  - { 'concepts.json': [...], 'forms/X_uuid.json': {...}, ... }
 * @param {Buffer} [args.existingBundleZip]    - the bundle as a ZIP buffer (alternative to existingBundleFiles)
 * @param {string} args.specYaml               - the new desired state, YAML-encoded
 * @param {boolean} [args.materialize=true]    - compile declarative rules → JS before patching
 * @param {boolean} [args.runIntegrityCheck=true] - run graph integrity on the patched state
 * @param {boolean} [args.outputZip=false]     - emit patched bundle as a ZIP buffer in the result
 */
export function applySpec({
  existingBundleFiles,
  existingBundleZip,
  specYaml,
  materialize = true,
  runIntegrityCheck = true,
  outputZip = false,
}) {
  if (typeof specYaml !== "string" || specYaml.length === 0) {
    throw new Error("applySpec: specYaml string required");
  }
  let bundleFiles;
  if (existingBundleZip) {
    if (!Buffer.isBuffer(existingBundleZip)) {
      throw new Error("applySpec: existingBundleZip must be a Buffer");
    }
    bundleFiles = bundleFromZip(existingBundleZip);
  } else if (existingBundleFiles && typeof existingBundleFiles === "object") {
    bundleFiles = existingBundleFiles;
  } else {
    throw new Error("applySpec: either existingBundleFiles or existingBundleZip required");
  }

  // 1. Parse
  const entities = specToEntities(specYaml);

  // 2. Materialize declarative rules → JS
  let ruleCompilation = { compiled: [], errors: [] };
  if (materialize) {
    const r = materializeRules(entities);
    ruleCompilation = { compiled: r.compiled, errors: r.errors };
  }

  // 3. Patch
  const patched = patchBundle({ bundleFiles, entities });

  // 4. Integrity check
  let integrity = { ok: true, issues: [] };
  if (runIntegrityCheck) {
    integrity = checkIntegrityOnFileMap(patched.newFiles);
  }

  const result = {
    patchedFiles: patched.newFiles,
    diff:         patched.diff,
    filesChanged: patched.filesChanged,
    diffSummary:  summarizeDiff(patched.diff),
    ruleCompilation,
    integrity,
  };
  if (outputZip) {
    result.patchedZip = bundleToZip(patched.newFiles);
  }
  return result;
}

// Adapter: graph builder expects a directory path; here we have a file map.
// We replicate the bare minimum traversal — building uuid → kind index +
// walking the same FK fields the graph builder does. Handles BOTH bare-array
// and {wrappedKey: [...]} shapes (the deterministic generator emits the
// wrapped form for operational entities; synthetic tests use bare arrays).
function asArray(value, wrappedKey) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (wrappedKey && Array.isArray(value[wrappedKey])) return value[wrappedKey];
  return [];
}

function checkIntegrityOnFileMap(files) {
  const issues = [];
  const uuidIndex = new Map();    // uuid → kind

  function index(kind, arr) {
    for (const e of arr) {
      if (e && typeof e.uuid === "string") uuidIndex.set(e.uuid, kind);
    }
  }

  index("concept",                  asArray(files["concepts.json"]));
  index("subjectType",              asArray(files["subjectTypes.json"]));
  index("program",                  asArray(files["programs.json"]));
  index("encounterType",            asArray(files["encounterTypes.json"]));
  index("formMapping",              asArray(files["formMappings.json"]));
  index("operationalSubjectType",   asArray(files["operationalSubjectTypes.json"],   "operationalSubjectTypes"));
  index("operationalProgram",       asArray(files["operationalPrograms.json"],       "operationalPrograms"));
  index("operationalEncounterType", asArray(files["operationalEncounterTypes.json"], "operationalEncounterTypes"));
  index("addressLevelType",         asArray(files["addressLevelTypes.json"]));
  for (const [pathStr, content] of Object.entries(files)) {
    if (pathStr.startsWith("forms/") && pathStr.endsWith(".json")) {
      if (content && typeof content === "object" && content.uuid) {
        uuidIndex.set(content.uuid, "form");
      }
    }
  }

  function check(fromUuid, toUuid, field, required) {
    if (!toUuid) return;
    if (uuidIndex.has(toUuid)) return;
    issues.push({
      severity: required ? "error" : "warning",
      code: "DANGLING_REF",
      message: `${field} → ${toUuid} (not found in bundle)`,
      from: fromUuid,
      to: toUuid,
      field,
    });
  }

  for (const m of asArray(files["formMappings.json"])) {
    check(m.uuid, m.formUUID,         "formMapping.formUUID",         true);
    check(m.uuid, m.subjectTypeUUID,  "formMapping.subjectTypeUUID",  true);
    if (m.programUUID)        check(m.uuid, m.programUUID,        "formMapping.programUUID",        false);
    if (m.encounterTypeUUID)  check(m.uuid, m.encounterTypeUUID,  "formMapping.encounterTypeUUID",  false);
  }
  for (const c of asArray(files["concepts.json"])) {
    for (const a of (c.answers || [])) {
      if (a && a.uuid) check(c.uuid, a.uuid, "concept.answers[].uuid", false);
    }
  }
  // operational entities reference base entities via `{kind}.uuid` (nested),
  // not `{kind}UUID` (flat) — matches the generator's actual output shape.
  for (const op of asArray(files["operationalSubjectTypes.json"], "operationalSubjectTypes")) {
    const refUuid = op.subjectType?.uuid || op.subjectTypeUUID;
    if (refUuid) check(op.uuid, refUuid, "operationalSubjectType.subjectType.uuid", true);
  }
  for (const op of asArray(files["operationalPrograms.json"], "operationalPrograms")) {
    const refUuid = op.program?.uuid || op.programUUID;
    if (refUuid) check(op.uuid, refUuid, "operationalProgram.program.uuid", true);
  }
  for (const op of asArray(files["operationalEncounterTypes.json"], "operationalEncounterTypes")) {
    const refUuid = op.encounterType?.uuid || op.encounterTypeUUID;
    if (refUuid) check(op.uuid, refUuid, "operationalEncounterType.encounterType.uuid", true);
  }
  for (const [pathStr, form] of Object.entries(files)) {
    if (!pathStr.startsWith("forms/") || !pathStr.endsWith(".json")) continue;
    if (!form || typeof form !== "object") continue;
    for (const grp of (form.formElementGroups || [])) {
      for (const fe of (grp.formElements || [])) {
        if (fe && fe.concept && fe.concept.uuid) {
          check(form.uuid, fe.concept.uuid, `form.formElementGroups[].formElements["${fe.name}"].concept.uuid`, true);
        }
      }
    }
  }

  const hasError = issues.some((i) => i.severity === "error");
  return { ok: !hasError, issues };
}
