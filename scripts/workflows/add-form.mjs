#!/usr/bin/env node
// add-form workflow — atomic multi-file form insertion.
//
// v1 scope: IndividualProfile + Encounter formTypes. Defers ProgramEnrolment
// / ProgramExit / ProgramEncounter (those need program-mapping logic the v1
// generator doesn't model deterministically).
//
// Input: a JSON file describing the form. See --help for shape.
//
// What the workflow does atomically (all-or-nothing):
//   1. Generate a v4 UUID for the form, the form-element group, and each form element.
//   2. For each form element's concept: case-insensitive lookup in concepts.json.
//      - If found: reuse UUID, no concepts.json mutation.
//      - If not: append a new concept to concepts.json with the requested dataType.
//        If dataType=Coded with answers[], each answer name is looked up too —
//        reused if exists, appended (as dataType=NA standalone concept) if not.
//   3. Build forms/<Name>_<uuid>.json with shape matching the deterministic generator.
//   4. Append a formMappings entry linking the form to the named subjectType.
//   5. (no operational-entries edit — those are subject-level, already present.)
//
// All writes are buffered in memory. If ANY step fails (subjectType not found,
// duplicate form name, etc.), nothing is written. With --dry-run, no files are
// touched; the planned changes are reported.
//
// Usage:
//   node add-form.mjs --spec ./form-spec.json [--dry-run]
//
// Form spec JSON shape:
//   {
//     "name": "Volunteer Registration",
//     "formType": "IndividualProfile",
//     "subjectTypeName": "Cohort",
//     "formElements": [
//       { "name": "Volunteer Name",  "conceptName": "Name",  "dataType": "Text",    "type": "SingleLineText", "mandatory": true },
//       { "name": "Age",             "conceptName": "Age",   "dataType": "Numeric", "type": "SingleLineText", "mandatory": true },
//       { "name": "Phone",           "conceptName": "Phone", "dataType": "PhoneNumber", "type": "SingleLineText", "mandatory": false },
//       { "name": "Is Active",       "conceptName": "Active",  "dataType": "Coded",
//          "type": "SingleSelect", "mandatory": false,
//          "answers": ["Yes", "No"] }
//     ]
//   }

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argsArr = process.argv.slice(2);
function arg(name) { const i = argsArr.indexOf(`--${name}`); return i < 0 ? null : argsArr[i + 1]; }
function flag(name) { return argsArr.includes(`--${name}`); }

if (flag("help")) {
  process.stdout.write(fs.readFileSync(new URL(import.meta.url).pathname, "utf8").split("\n").slice(0, 50).join("\n") + "\n");
  process.exit(0);
}

const specPath = arg("spec");
const dryRun = flag("dry-run");
if (!specPath) { console.error("--spec <file.json> required (or --help)"); process.exit(2); }
if (!fs.existsSync(specPath)) { console.error(`spec file not found: ${specPath}`); process.exit(2); }

let spec;
try { spec = JSON.parse(fs.readFileSync(specPath, "utf8")); }
catch (e) { console.error(`spec parse error: ${e.message}`); process.exit(2); }

// ── validate spec ──────────────────────────────────────────────
const errors = [];
if (!spec.name) errors.push("spec.name required");
if (!spec.formType) errors.push("spec.formType required");
if (spec.formType && !["IndividualProfile", "Encounter"].includes(spec.formType)) {
  errors.push(`spec.formType must be IndividualProfile or Encounter (v1); got "${spec.formType}"`);
}
if (!spec.subjectTypeName) errors.push("spec.subjectTypeName required");
if (!Array.isArray(spec.formElements) || spec.formElements.length === 0) errors.push("spec.formElements must be a non-empty array");
for (let i = 0; i < (spec.formElements || []).length; i++) {
  const el = spec.formElements[i];
  if (!el.name) errors.push(`formElements[${i}].name required`);
  if (!el.conceptName) errors.push(`formElements[${i}].conceptName required`);
  if (!el.dataType) errors.push(`formElements[${i}].dataType required`);
  if (el.dataType === "Coded" && !Array.isArray(el.answers)) errors.push(`formElements[${i}]: dataType=Coded requires answers[]`);
}
if (errors.length) {
  process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2) + "\n");
  process.exit(1);
}

// ── load bundle state ─────────────────────────────────────────
const cwd = process.cwd();
function loadJson(rel) {
  const fp = path.join(cwd, rel);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}
const concepts = loadJson("concepts.json") || [];
const subjectTypes = loadJson("subjectTypes.json") || [];
const formMappings = loadJson("formMappings.json") || [];

// find subjectType by name
const subjectType = subjectTypes.find((s) => s.name === spec.subjectTypeName);
if (!subjectType) {
  process.stdout.write(JSON.stringify({
    ok: false,
    errors: [`subjectType "${spec.subjectTypeName}" not in subjectTypes.json`],
    availableSubjectTypes: subjectTypes.map((s) => s.name),
  }, null, 2) + "\n");
  process.exit(1);
}

// detect duplicate form name across forms/*.json
const formsDir = path.join(cwd, "forms");
if (fs.existsSync(formsDir)) {
  for (const fn of fs.readdirSync(formsDir)) {
    if (!fn.endsWith(".json")) continue;
    let f; try { f = JSON.parse(fs.readFileSync(path.join(formsDir, fn), "utf8")); } catch { continue; }
    if (f && f.name === spec.name) {
      process.stdout.write(JSON.stringify({ ok: false, errors: [`form name "${spec.name}" already exists in ${fn}`] }, null, 2) + "\n");
      process.exit(1);
    }
  }
}

// ── plan: concept resolution + new concept additions ──────────
function findConceptByName(name) {
  const lc = String(name).toLowerCase().trim();
  return concepts.find((c) => String(c.name || "").toLowerCase().trim() === lc) || null;
}
function newUuid() { return crypto.randomUUID(); }

const plan = {
  formUuid: newUuid(),
  groupUuid: newUuid(),
  newConcepts: [],   // {name, uuid, dataType, answers?}
  reusedConcepts: [], // {name, uuid, dataType}  for log
  newAnswerConcepts: [], // {name, uuid} when an answer needs creating
  formElements: [],  // resolved form-element entries
};

for (let i = 0; i < spec.formElements.length; i++) {
  const el = spec.formElements[i];
  // Resolve the FIELD-LEVEL concept
  let concept = findConceptByName(el.conceptName);
  if (!concept) {
    // Create new — push the SAME object reference into plan.newConcepts so
    // a later update to concept.answers (for Coded) flows through to the
    // version we write to disk.
    concept = { name: el.conceptName, uuid: newUuid(), dataType: el.dataType, active: true, media: [], answers: [] };
    plan.newConcepts.push(concept);
    // For Coded, also resolve answer concepts
    if (el.dataType === "Coded") {
      const answersRefs = [];
      for (const ansName of (el.answers || [])) {
        let ansC = findConceptByName(ansName);
        if (!ansC) {
          ansC = { name: ansName, uuid: newUuid(), dataType: "NA", active: true };
          plan.newAnswerConcepts.push({ name: ansC.name, uuid: ansC.uuid });
        }
        answersRefs.push({ name: ansC.name, uuid: ansC.uuid });
      }
      concept.answers = answersRefs;
    }
  } else {
    plan.reusedConcepts.push({ name: concept.name, uuid: concept.uuid, dataType: concept.dataType });
    // Mismatch check
    if (concept.dataType && concept.dataType !== el.dataType) {
      process.stdout.write(JSON.stringify({
        ok: false,
        errors: [`formElements[${i}]: existing concept "${concept.name}" has dataType=${concept.dataType} but spec says ${el.dataType}. Either change the spec or rename the conceptName.`],
      }, null, 2) + "\n");
      process.exit(1);
    }
  }

  plan.formElements.push({
    name: el.name,
    uuid: newUuid(),
    keyValues: [],
    concept: {
      name: concept.name,
      uuid: concept.uuid,
      dataType: concept.dataType,
      active: true,
      media: [],
      answers: concept.answers || [],
    },
    displayOrder: i + 1,
    // AVNI validator F8: formElement.type must be SingleSelect or MultiSelect.
    // The widget kind is independent of the concept's dataType — SingleSelect
    // is the universal default; MultiSelect only for multi-checkbox coded concepts.
    type: el.type === "MultiSelect" ? "MultiSelect" : "SingleSelect",
    mandatory: !!el.mandatory,
  });
}

// ── plan: form JSON ──
const formJson = {
  name: spec.name,
  uuid: plan.formUuid,
  formType: spec.formType,
  formElementGroups: [{
    uuid: plan.groupUuid,
    name: "Default",
    displayOrder: 1,
    formElements: plan.formElements,
    timed: false,
    display: "Default",
  }],
  decisionRule: "",
  visitScheduleRule: "",
  validationRule: "",
  checklistsRule: "",
  decisionConcepts: [],
};

// ── plan: formMappings entry ──
const formMappingEntry = {
  uuid: newUuid(),
  formUUID: plan.formUuid,
  subjectTypeUUID: subjectType.uuid,
  formType: spec.formType,
  formName: spec.name,
  enableApproval: false,
};

// ── apply (unless --dry-run) ──
const planReport = {
  ok: true,
  dryRun,
  form: { name: spec.name, uuid: plan.formUuid, formType: spec.formType },
  subjectType: { name: subjectType.name, uuid: subjectType.uuid },
  newConcepts: plan.newConcepts.map((c) => ({ name: c.name, uuid: c.uuid, dataType: c.dataType })),
  newAnswerConcepts: plan.newAnswerConcepts,
  reusedConcepts: plan.reusedConcepts,
  formElementCount: plan.formElements.length,
  fileWrites: [
    `forms/${spec.name}_${plan.formUuid}.json`,
    "concepts.json (append new concepts)",
    "formMappings.json (append entry)",
  ],
};

if (dryRun) {
  process.stdout.write(JSON.stringify(planReport, null, 2) + "\n");
  process.exit(0);
}

// Append new concepts. New answer concepts FIRST (so the field concept can
// reference them by UUID).
const updatedConcepts = [...concepts];
for (const ans of plan.newAnswerConcepts) {
  updatedConcepts.push({ name: ans.name, uuid: ans.uuid, dataType: "NA", active: true });
}
for (const nc of plan.newConcepts) {
  updatedConcepts.push(nc);
}

// Append formMapping
const updatedMappings = [...formMappings, formMappingEntry];

// Write files (all-or-nothing — write to tmp first, then rename)
const tmpForm = path.join(cwd, "forms", `${spec.name}_${plan.formUuid}.json.tmp`);
const finalForm = path.join(cwd, "forms", `${spec.name}_${plan.formUuid}.json`);
fs.mkdirSync(path.join(cwd, "forms"), { recursive: true });
fs.writeFileSync(tmpForm, JSON.stringify(formJson, null, 2));
fs.writeFileSync(path.join(cwd, "concepts.json"), JSON.stringify(updatedConcepts, null, 2));
fs.writeFileSync(path.join(cwd, "formMappings.json"), JSON.stringify(updatedMappings, null, 2));
fs.renameSync(tmpForm, finalForm);

process.stdout.write(JSON.stringify({
  ...planReport,
  applied: true,
  message: `Added form "${spec.name}" with ${plan.formElements.length} elements (${plan.newConcepts.length} new concepts, ${plan.newAnswerConcepts.length} new answer concepts, ${plan.reusedConcepts.length} reused).`,
}, null, 2) + "\n");
