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
const { entitiesToSpec }                                    = require(path.join(brainPath, "srs-bundle-generator/spec/emitter.js"));
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

  // 4. Integrity check — drive FK / dangling-reference integrity off the
  // brain's yaml-driven dependency graph (buildBundleGraph + integrityCheck),
  // the single source of truth for every edge kind (spec/fk-matrix.yaml). This
  // is the SAME brain-resolution + file-map pattern bundle_integrity_check uses
  // in src/agents/bundle-mcp-server.js — it is a proven strict superset of the
  // deleted local checkIntegrityOnFileMap (9/9 fields + the 5 graph-only kinds),
  // corpus:parity-gated at Σ LOST=0 (#10). We map each graph issue back into the
  // { ok, issues:[{severity,code,message,from,field,to}] } shape applySpec has
  // always returned, so this consumer's contract is preserved exactly.
  let integrity = { ok: true, issues: [] };
  if (runIntegrityCheck) {
    integrity = integrityOnFileMap(patched.newFiles);
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

// FK / dangling-reference integrity over an in-memory bundle file map.
//
// As of #10 the local checkIntegrityOnFileMap is DELETED — its coverage is a
// proven subset of the brain's yaml-driven dependency graph (buildBundleGraph +
// integrityCheck), which is the single source of truth for every edge kind in
// spec/fk-matrix.yaml (incl. the 5 graph-only kinds the old local checker never
// saw: encounterType.conceptUuid, form.decisionConcepts[],
// addressLevelType.parentUuid, groupRole FKs, formMapping.taskTypeUUID). The
// superset relationship is corpus:parity-gated at Σ LOST=0 (avni-skills-sdk#16).
//
// buildBundleGraph accepts the file map directly (no disk I/O). integrityCheck
// walks every emitted edge and flags ones whose target uuid is absent, returning
// issues shaped { severity, code, message, edge:{from,field,to,required} }.
// We translate each into the { severity, code, message, from, field, to } shape
// applySpec's `integrity.issues` has always exposed — preserving this consumer's
// contract exactly (a dangling REQUIRED edge → severity "error", optional →
// "warning"; `ok` is false iff any error). This mirrors the brain-resolution +
// graph-issue mapping that runBundleIntegrityCheck uses in bundle-mcp-server.js.
function integrityOnFileMap(files) {
  const graph = buildBundleGraph(files);
  const { ok, issues } = integrityCheck(graph);
  const mapped = issues.map((i) => {
    const e = i.edge || {};
    return {
      severity: i.severity,   // "error" | "warning"
      code:     i.code,       // "MISSING_REQUIRED_REF" | "DANGLING_REF"
      message:  i.message,
      from:     e.from,
      field:    e.field,
      to:       e.to,
    };
  });
  return { ok, issues: mapped };
}

// ─── Reverse direction: bundle file map → canonical spec ─────────────
//
// applySpec goes  specYaml → entities → patch(bundle).  emitSpec closes the
// loop the other way:  bundle file map → entities → entitiesToSpec → specYaml.
// It exists so an agent (or the user) can round-trip the current bundle back
// into the human-readable canonical spec and DIFF INTENT vs ARTIFACT — the same
// spec_generator round-trip avni-ai relies on.
//
// The brain's emitter (`entitiesToSpec`) consumes the ENTITIES dict shape the
// parser produces (snake_case scope keys, forms carrying formType/subjectType/
// program/encounterType). The bundle on disk is a different shape (per-file JSON
// arrays keyed by camelCase, relationships via UUID/formMappings). This adapter
// reconstructs the entities dict from the bundle so the emitter can consume it.
//
// It is deliberately a LOSSY, human-readable "intent view", NOT a byte-lossless
// serializer: the spec format identifies concepts by name+dataType, so concept
// UUIDs embedded inside form elements are resolved by name (not preserved) — the
// SAME lossiness the forward parser has. What round-trips faithfully is the set
// of top-level entities (subjectTypes / programs / encounterTypes / concepts) by
// name, which is what makes re-applying an emitted spec a no-op ADD (it updates
// in place, never duplicates) — the property the round-trip test pins down.
export function bundleToEntities(fileMap) {
  if (!fileMap || typeof fileMap !== "object") {
    throw new Error("bundleToEntities: fileMap object required");
  }
  const arr = (k) => (Array.isArray(fileMap[k]) ? fileMap[k] : []);
  const subjectTypes   = arr("subjectTypes.json");
  const programs       = arr("programs.json");
  const encounterTypes = arr("encounterTypes.json");
  const concepts       = arr("concepts.json");
  const groups         = arr("groups.json");

  // Collect form objects. Forms produced by the patcher carry their scope
  // (formType/subjectType/program/encounterType) directly on the object; we
  // rely on that so the emitter's findForm() can nest each form under the right
  // subjectType / program / encounterType.
  const forms = [];
  for (const [p, f] of Object.entries(fileMap)) {
    if (!p.startsWith("forms/") || !p.endsWith(".json")) continue;
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    forms.push(f);
  }

  // Derive relationships the bundle JSON stores implicitly (via forms) so the
  // emitted spec names them explicitly: a program's target subject type comes
  // from its enrolment form; an encounter's program/subject/kind from its form.
  const enrolSubjectByProgram = {};
  const encScopeByName = {};
  for (const f of forms) {
    if (f.formType === "ProgramEnrolment" && f.program) {
      enrolSubjectByProgram[f.program] = f.subjectType || "";
    }
    if ((f.formType === "ProgramEncounter" || f.formType === "Encounter") && f.encounterType) {
      encScopeByName[f.encounterType] = {
        subjectType: f.subjectType || "",
        program: f.program || "",
        isProgram: f.formType === "ProgramEncounter",
      };
    }
  }

  return {
    org_name: "",
    settings: {},
    subject_types: subjectTypes.map((s) => ({ ...s })),
    programs: programs.map((p) => ({
      ...p,
      name: p.name,
      target_subject_type: p.target_subject_type || enrolSubjectByProgram[p.name] || "",
    })),
    encounter_types: encounterTypes.map((e) => {
      const sc = encScopeByName[e.name] || {};
      const programName = e.program_name || sc.program || "";
      return {
        ...e,
        name: e.name,
        program_name: programName,
        subject_type: e.subject_type || sc.subjectType || "",
        is_program_encounter: e.is_program_encounter != null
          ? !!e.is_program_encounter
          : (programName ? true : !!sc.isProgram),
        is_scheduled: e.is_scheduled == null ? true : !!e.is_scheduled,
      };
    }),
    groups: groups.map((g) => ({ name: g.name, has_all_privileges: !!g.hasAllPrivileges })),
    forms,
    concepts_detail: concepts,
  };
}

/**
 * Emit the current bundle as the canonical YAML spec.
 *
 * @param {Object} args
 * @param {Object} [args.existingBundleFiles] - bundle file map (mutually exclusive with existingBundleZip)
 * @param {Buffer} [args.existingBundleZip]   - bundle as a ZIP buffer
 * @param {string} [args.org]                 - organisation name to stamp on the spec
 * @returns {string} the spec, YAML-encoded
 */
export function emitSpec({ existingBundleFiles, existingBundleZip, org = "" } = {}) {
  let bundleFiles;
  if (existingBundleZip) {
    if (!Buffer.isBuffer(existingBundleZip)) {
      throw new Error("emitSpec: existingBundleZip must be a Buffer");
    }
    bundleFiles = bundleFromZip(existingBundleZip);
  } else if (existingBundleFiles && typeof existingBundleFiles === "object") {
    bundleFiles = existingBundleFiles;
  } else {
    throw new Error("emitSpec: either existingBundleFiles or existingBundleZip required");
  }
  const entities = bundleToEntities(bundleFiles);
  return entitiesToSpec(entities, org || entities.org_name || "");
}
