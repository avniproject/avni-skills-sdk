"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
const { pathToFileURL } = require("node:url");
async function load() { return import(pathToFileURL(path.resolve(__dirname, "../../src/comprehension/apply-patch.js")).href); }
const prov = { sheet: "Student Register", row: 7 };

function tmpBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([{ name: "Student", uuid: "st-student" }, { name: "School", uuid: "st-school" }]));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([{ name: "Gender", uuid: "c-gender", dataType: "Coded", answers: [] }]));
  fs.writeFileSync(path.join(dir, "encounterTypes.json"), JSON.stringify([{ name: "FLN Perf Sample data", uuid: "e-junk" }]));
  fs.writeFileSync(path.join(dir, "operationalEncounterTypes.json"), JSON.stringify([]));
  fs.mkdirSync(path.join(dir, "forms"));
  fs.writeFileSync(path.join(dir, "forms", "Student Register_f1.json"), JSON.stringify({ name: "Student Register", uuid: "f1", formType: "Encounter", formElementGroups: [{ name: "G", formElements: [{ name: "Gender", concept: { name: "Gender", uuid: "c-gender", dataType: "Coded", answers: [] } }] }] }));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify([{ formName: "Student Register", formUUID: "f1", formType: "Encounter", subjectTypeUUID: "st-school" }]));
  return dir;
}

test("apply-patch: add-answers, reclassify-form, set-subject, drop-entity; unprovenanced dropped", async () => {
  const { applyCorrectionPatch } = await load();
  const dir = tmpBundle();
  const r = applyCorrectionPatch(dir, { corrections: [
    { op: "add-answers", concept: "Gender", answers: ["Male", "Female"], provenance: prov },
    { op: "reclassify-form", form: "Student Register", formType: "IndividualProfile", provenance: prov },
    { op: "set-subject", form: "Student Register", subjectType: "Student", provenance: prov },
    { op: "drop-entity", entityKind: "encounterType", name: "FLN Perf Sample data", provenance: prov },
    { op: "add-answers", concept: "Gender", answers: ["Other"] }, // no provenance → dropped
  ] }, { revalidate: false });

  // add-answers linked to the concept + the embedded form element
  const gender = JSON.parse(fs.readFileSync(path.join(dir, "concepts.json"), "utf8")).find((c) => c.name === "Gender");
  assert.deepEqual(gender.answers.map((a) => a.name), ["Male", "Female"], "answers attached to concept");
  const form = JSON.parse(fs.readFileSync(path.join(dir, "forms", "Student Register_f1.json"), "utf8"));
  assert.equal(form.formType, "IndividualProfile", "form reclassified");
  assert.equal(form.formElementGroups[0].formElements[0].concept.answers.length, 2, "answers mirrored onto the form element");
  const map = JSON.parse(fs.readFileSync(path.join(dir, "formMappings.json"), "utf8"))[0];
  assert.equal(map.formType, "IndividualProfile", "mapping reclassified");
  assert.equal(map.subjectTypeUUID, "st-student", "subject set to Student");
  const enc = JSON.parse(fs.readFileSync(path.join(dir, "encounterTypes.json"), "utf8"));
  assert.equal(enc.length, 0, "junk encounter dropped");
  assert.ok(r.skipped.some((s) => s.reason === "no-provenance"), "unprovenanced op dropped");
  assert.equal(r.applied.length, 4);
});
