#!/usr/bin/env node
/**
 * Bundle invariants harness — fully org-agnostic.
 *
 * Takes any bundle directory, asserts the universal properties an AVNI bundle
 * must satisfy regardless of which organisation it's for. No fixed file
 * counts, no org names, no fixture-specific magic numbers.
 *
 * Use it as a post-edit gate (run after every agent turn) or a CI check on
 * any generated bundle.
 *
 * Usage:
 *   node tests/bundle-harness.cjs <bundle-dir>
 *
 * Output:
 *   stdout — human-readable report
 *   stderr — RESULTS_JSON=<json> line for CI parsing
 *   exit code — 0 if all invariants hold, 1 otherwise
 */

"use strict";
const fs = require("node:fs");
const path = require("node:path");

const BUNDLE = process.argv[2];
if (!BUNDLE) { console.error("Usage: node bundle-harness.cjs <bundle-dir>"); process.exit(2); }
if (!fs.existsSync(BUNDLE)) { console.error(`bundle dir not found: ${BUNDLE}`); process.exit(2); }

const AVNI_SKILLS_PATH = process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "avni-skills");
const VALIDATOR = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "validators", "bundle_validator");

// Mirrors VALID_DATA_TYPES in avni-skills/srs-bundle-generator/validators/bundle_validator.js
const VALID_DATA_TYPES = new Set([
  "Numeric","Text","Notes","Coded","NA","Date","DateTime","Time",
  "Duration","Image","ImageV2","Id","Video","Subject","Location",
  "PhoneNumber","GroupAffiliation","Audio","File","QuestionGroup","Encounter",
]);
const VALID_SUBJECT_TYPES = new Set(["Person","Individual","Group","Household","User"]);
const VALID_FORM_TYPES = new Set([
  "IndividualProfile","ProgramEnrolment","ProgramExit",
  "Encounter","ProgramEncounter",
  "IndividualEncounterCancellation","ProgramEncounterCancellation",
  "ChecklistItem","IndividualRelationship",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function load(file) {
  const fp = path.join(BUNDLE, file);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}
function unwrapOp(file, key) {
  const d = load(file);
  if (!d) return null;
  return Array.isArray(d) ? d : (d[key] || []);
}
function listForms() {
  const fp = path.join(BUNDLE, "forms");
  if (!fs.existsSync(fp)) return [];
  return fs.readdirSync(fp).filter(f => f.endsWith(".json")).sort();
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("01: required top-level files all present", () => {
  const required = ["concepts.json","subjectTypes.json","programs.json","encounterTypes.json","formMappings.json","operationalSubjectTypes.json","operationalPrograms.json","operationalEncounterTypes.json","organisationConfig.json","addressLevelTypes.json"];
  const missing = required.filter(f => !fs.existsSync(path.join(BUNDLE, f)));
  if (!fs.existsSync(path.join(BUNDLE, "forms"))) missing.push("forms/");
  return { pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : `all ${required.length + 1} present` };
});

test("02: every JSON file in the bundle parses", () => {
  const fails = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".json")) {
        try { JSON.parse(fs.readFileSync(fp, "utf8")); }
        catch (err) { fails.push(`${path.relative(BUNDLE, fp)}: ${err.message.slice(0,80)}`); }
      }
    }
  }
  walk(BUNDLE);
  return { pass: fails.length === 0, detail: fails.length ? fails.slice(0,3).join("; ") : "all parse" };
});

test("03: every concept has a v4-shaped UUID and a valid dataType", () => {
  const concepts = load("concepts.json") || [];
  const bad = [];
  for (const c of concepts) {
    if (!c.uuid || !UUID_RE.test(c.uuid)) bad.push(`uuid '${c.uuid}' on '${c.name}'`);
    if (!c.dataType || !VALID_DATA_TYPES.has(c.dataType)) bad.push(`dataType '${c.dataType}' on '${c.name}'`);
    if (bad.length > 5) break;
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(" | ") : `${concepts.length} concepts ok` };
});

test("04: every subject type has a valid 'type' field", () => {
  const sts = load("subjectTypes.json") || [];
  const bad = sts.filter(s => !s.type || !VALID_SUBJECT_TYPES.has(s.type));
  return { pass: bad.length === 0, detail: bad.length ? bad.map(s => `'${s.name}'=${s.type}`).join(", ") : `${sts.length} subject types ok` };
});

test("05: every form has uuid + name + valid formType + formElementGroups array", () => {
  const bad = [];
  for (const ff of listForms()) {
    const f = JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8"));
    if (!f.uuid || !UUID_RE.test(f.uuid)) bad.push(`${ff}: bad uuid`);
    if (!f.name) bad.push(`${ff}: no name`);
    if (!f.formType || !VALID_FORM_TYPES.has(f.formType)) bad.push(`${ff}: formType=${f.formType}`);
    if (!Array.isArray(f.formElementGroups)) bad.push(`${ff}: no formElementGroups array`);
    if (bad.length > 4) break;
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(" | ") : `${listForms().length} forms ok` };
});

test("06: every form-element concept UUID exists in concepts.json", () => {
  const known = new Set((load("concepts.json") || []).map(c => c.uuid));
  const missing = [];
  for (const ff of listForms()) {
    const f = JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8"));
    for (const g of f.formElementGroups || []) {
      for (const el of g.formElements || []) {
        if (el.concept?.uuid && !known.has(el.concept.uuid)) {
          missing.push(`${f.name}/${el.name}`);
          if (missing.length > 4) break;
        }
      }
    }
  }
  return { pass: missing.length === 0, detail: missing.length ? missing.join(" | ") : "all linked" };
});

test("07: every Coded answer concept has a UUID and exists as a concept", () => {
  const concepts = load("concepts.json") || [];
  const known = new Set(concepts.map(c => c.uuid));
  const bad = [];
  for (const c of concepts) {
    if (c.dataType !== "Coded") continue;
    for (const a of c.answers || []) {
      if (!a.uuid) bad.push(`'${c.name}' → '${a.name}' has no uuid`);
      else if (!known.has(a.uuid)) bad.push(`'${c.name}' → '${a.name}' uuid not a concept`);
      if (bad.length > 4) break;
    }
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(" | ") : "all coded answers resolve" };
});

test("08: every formMapping references a real form file", () => {
  const formUuids = new Set();
  for (const ff of listForms()) {
    try { formUuids.add(JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8")).uuid); } catch {}
  }
  const bad = (load("formMappings.json") || []).filter(m => m.formUUID && !formUuids.has(m.formUUID));
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} dangling formUUIDs` : "all mappings → real forms" };
});

test("09: every formMapping references a real subject type", () => {
  const subjUuids = new Set((load("subjectTypes.json") || []).map(s => s.uuid));
  const bad = (load("formMappings.json") || []).filter(m => m.subjectTypeUUID && !subjUuids.has(m.subjectTypeUUID));
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} mappings → unknown subject` : `${subjUuids.size} subject types referenced` };
});

test("10: every formMapping with programUUID resolves to a real program", () => {
  const progUuids = new Set((load("programs.json") || []).map(p => p.uuid));
  const bad = (load("formMappings.json") || []).filter(m => m.programUUID && !progUuids.has(m.programUUID));
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} mappings → unknown program` : `${progUuids.size} programs referenced` };
});

test("11: every formMapping with encounterTypeUUID resolves to a real encounter type", () => {
  const encUuids = new Set((load("encounterTypes.json") || []).map(e => e.uuid));
  const bad = (load("formMappings.json") || []).filter(m => m.encounterTypeUUID && !encUuids.has(m.encounterTypeUUID));
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} mappings → unknown encounter` : `${encUuids.size} encounter types referenced` };
});

test("12: operational files are wrapped objects (not bare arrays)", () => {
  const checks = [
    { file: "operationalSubjectTypes.json",  key: "operationalSubjectTypes" },
    { file: "operationalPrograms.json",      key: "operationalPrograms" },
    { file: "operationalEncounterTypes.json",key: "operationalEncounterTypes" },
  ];
  const bad = [];
  for (const c of checks) {
    const d = load(c.file);
    if (Array.isArray(d)) bad.push(`${c.file}: bare array`);
    else if (!d || !Array.isArray(d[c.key])) bad.push(`${c.file}: missing key '${c.key}'`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join("; ") : "all 3 wrapped" };
});

test("13: operational entries reference real base entities", () => {
  const subjUuids = new Set((load("subjectTypes.json") || []).map(s => s.uuid));
  const progUuids = new Set((load("programs.json") || []).map(p => p.uuid));
  const encUuids  = new Set((load("encounterTypes.json") || []).map(e => e.uuid));
  const bad = [];
  for (const op of unwrapOp("operationalSubjectTypes.json","operationalSubjectTypes") || []) {
    if (!op.subjectType?.uuid || !subjUuids.has(op.subjectType.uuid)) bad.push(`opSubject ${op.name}`);
  }
  for (const op of unwrapOp("operationalPrograms.json","operationalPrograms") || []) {
    if (!op.program?.uuid || !progUuids.has(op.program.uuid)) bad.push(`opProg ${op.name}`);
  }
  for (const op of unwrapOp("operationalEncounterTypes.json","operationalEncounterTypes") || []) {
    if (!op.encounterType?.uuid || !encUuids.has(op.encounterType.uuid)) bad.push(`opEnc ${op.name}`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.slice(0,5).join(" | ") : "all back-refs ok" };
});

test("14: every concept name is unique", () => {
  const names = new Map();
  for (const c of load("concepts.json") || []) names.set(c.name, (names.get(c.name) || 0) + 1);
  const dups = [...names].filter(([_, n]) => n > 1);
  return { pass: dups.length === 0, detail: dups.length ? dups.slice(0,3).map(([n,c]) => `'${n}'×${c}`).join(", ") : `${names.size} unique` };
});

test("15: every form name is unique", () => {
  const names = new Map();
  for (const ff of listForms()) {
    try {
      const f = JSON.parse(fs.readFileSync(path.join(BUNDLE, "forms", ff), "utf8"));
      names.set(f.name, (names.get(f.name) || 0) + 1);
    } catch {}
  }
  const dups = [...names].filter(([_, n]) => n > 1);
  return { pass: dups.length === 0, detail: dups.length ? dups.slice(0,3).map(([n,c]) => `'${n}'×${c}`).join(", ") : `${names.size} unique` };
});

test("16: server-contract validator: no MECHANICAL errors", () => {
  // Mechanical = anything not F2 (cross-group concept reuse).
  // F2 is semantic — the agent loop's responsibility, not the generator's.
  let r;
  try {
    const { BundleValidator } = require(VALIDATOR);
    const orig = console.log; console.log = () => {};
    r = new BundleValidator(BUNDLE).validate();
    console.log = orig;
  } catch (e) {
    return { pass: false, detail: `validator threw: ${e.message.slice(0,100)}` };
  }
  const groups = {};
  for (const e of r.errors) {
    const k = (e.match(/^([A-Z][0-9]+)/) || ["?"])[0];
    groups[k] = (groups[k] || 0) + 1;
  }
  const f2 = groups.F2 || 0;
  const mechanical = r.errors.length - f2;
  return {
    pass: mechanical === 0,
    detail: `total=${r.errors.length}  F2-semantic=${f2}  mechanical=${mechanical}  warnings=${r.warnings.length}`,
  };
});

let pass = 0, fail = 0;
const results = [];
for (const t of tests) {
  let r;
  try { r = t.fn(); } catch (e) { r = { pass: false, detail: "THROW: " + e.message.slice(0,100) }; }
  results.push({ name: t.name, ...r });
  r.pass ? pass++ : fail++;
}

console.log("┌" + "─".repeat(73) + "┐");
console.log(`│ Bundle:  ${BUNDLE.padEnd(62)} │`);
console.log(`│ Result:  ${pass}/${tests.length} pass, ${fail} fail`.padEnd(74) + "│");
console.log("└" + "─".repeat(73) + "┘");
for (const r of results) {
  console.log(`  ${r.pass ? "✓" : "✗"}  ${r.name}`);
  console.log(`        ${r.detail}`);
}

console.error("RESULTS_JSON=" + JSON.stringify({
  bundle: BUNDLE, total: tests.length, pass, fail,
  results: results.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
}));
process.exit(fail === 0 ? 0 : 1);
