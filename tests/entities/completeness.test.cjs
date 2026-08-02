"use strict";
// Tests for the deterministic completeness floor (Phase 3 agent floor-gate).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MOD = path.resolve(__dirname, "..", "..", "src", "completeness.js");
async function load() { return import(pathToFileURL(MOD).href); }

// Build a throwaway bundle dir from { file: json } (+ forms: { name: formObj }).
function tmpBundle({ subjectTypes = [], programs = [], encounterTypes = [], formMappings = [], forms = {}, concepts = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compl-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs));
  fs.writeFileSync(path.join(dir, "encounterTypes.json"), JSON.stringify(encounterTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
  if (concepts) fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  fs.mkdirSync(path.join(dir, "forms"));
  for (const [name, form] of Object.entries(forms)) {
    fs.writeFileSync(path.join(dir, "forms", `${name}.json`), JSON.stringify(form));
  }
  return dir;
}

const oneField = { formElementGroups: [{ name: "G", formElements: [{ name: "Q", concept: { name: "Q", dataType: "Text" } }] }] };

test("looksLikeProse flags requirement lines, not real names", async () => {
  const { looksLikeProse } = await load();
  assert.equal(looksLikeProse("7. Custom Report Cards (9 cards to be built)"), true);
  assert.equal(looksLikeProse("Custom Report Cards (9 cards)"), true);
  assert.equal(looksLikeProse("Beneficiary must be enrolled before the visit:"), true);
  assert.equal(looksLikeProse("The field worker records the child weight and height each month"), true);
  // Real entity names must NOT trip it.
  assert.equal(looksLikeProse("Anthropometry Assessment"), false);
  assert.equal(looksLikeProse("Daily Attendance Form"), false);
  assert.equal(looksLikeProse("Child"), false);
});

test("clean bundle → floor green", async () => {
  const { completenessFloor } = await load();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Child" }],
    formMappings: [{ formName: "Registration", formType: "IndividualProfile" }],
    forms: { Registration: { name: "Registration", formType: "IndividualProfile", ...oneField } },
  });
  const r = completenessFloor(dir);
  assert.equal(r.green, true, JSON.stringify(r.findings));
  assert.equal(r.evaluated, true);
});

test("prose leaked as an encounter type → PROSE_AS_ENTITY, floor red", async () => {
  const { completenessFloor } = await load();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Child" }],
    encounterTypes: [{ name: "7. Custom Report Cards (9 cards to be built)" }],
    formMappings: [{ formName: "Registration", formType: "IndividualProfile" }],
    forms: { Registration: { name: "Registration", formType: "IndividualProfile", ...oneField } },
  });
  const r = completenessFloor(dir);
  assert.equal(r.green, false);
  assert.ok(r.findings.some((f) => f.code === "PROSE_AS_ENTITY" && /Custom Report Cards/.test(f.entity)));
});

test("empty enrolment/exit shells do NOT trip FORM_NO_ELEMENTS", async () => {
  const { completenessFloor } = await load();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Child" }],
    formMappings: [
      { formName: "Registration", formType: "IndividualProfile" },
      { formName: "Enrolment", formType: "ProgramEnrolment" },
    ],
    forms: {
      Registration: { name: "Registration", formType: "IndividualProfile", ...oneField },
      Enrolment: { name: "Enrolment", formType: "ProgramEnrolment", formElementGroups: [] },
    },
  });
  const r = completenessFloor(dir);
  assert.equal(r.green, true, JSON.stringify(r.findings));
});

test("a content form with no fields → FORM_NO_ELEMENTS, floor red", async () => {
  const { completenessFloor } = await load();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Child" }],
    formMappings: [{ formName: "Visit", formType: "Encounter" }],
    forms: { Visit: { name: "Visit", formType: "Encounter", formElementGroups: [] } },
  });
  const r = completenessFloor(dir);
  assert.equal(r.green, false);
  assert.ok(r.findings.some((f) => f.code === "FORM_NO_ELEMENTS"));
});

test("subject types but no forms → NO_FORMS, floor red", async () => {
  const { completenessFloor } = await load();
  const dir = tmpBundle({ subjectTypes: [{ name: "Child" }] });
  const r = completenessFloor(dir);
  assert.equal(r.green, false);
  assert.ok(r.findings.some((f) => f.code === "NO_FORMS"));
});

// ─── PROGRAM_NO_ENROLMENT / ENCOUNTER_TYPE_NO_FORM / CODED_CONCEPT_TOO_FEW_ANSWERS ───
// Three universal invariants: true regardless of what any SRS says, so they are
// decidable from the bundle alone and belong here rather than in the paid
// ai-judged tier. Each caught something the validator reports as clean.
const codes = (r) => r.findings.map((f) => f.code);

test("PROGRAM_NO_ENROLMENT: a program with no ProgramEnrolment mapping is inert — nobody can be enrolled", async () => {
  const { completenessFloor } = await load();
  const r = completenessFloor(tmpBundle({
    programs: [{ name: "FLN", uuid: "p1" }],
    formMappings: [{ formName: "FLN Exit", formType: "ProgramExit", programUUID: "p1" }],
  }));
  assert.ok(codes(r).includes("PROGRAM_NO_ENROLMENT"));
});

test("PROGRAM_NO_ENROLMENT: a program WITH an enrolment mapping is clean, and a missing EXIT form is NOT flagged (a lifelong program is legitimate)", async () => {
  const { completenessFloor } = await load();
  const r = completenessFloor(tmpBundle({
    programs: [{ name: "NCD Screening", uuid: "p1" }],
    formMappings: [{ formName: "NCD Enrolment", formType: "ProgramEnrolment", programUUID: "p1" }],
  }));
  assert.deepEqual(r.findings, [], "no exit form must not be a finding — only the SRS can say whether one is required");
});

test("ENCOUNTER_TYPE_NO_FORM: an encounter type nothing maps to can never be recorded", async () => {
  const { completenessFloor } = await load();
  const r = completenessFloor(tmpBundle({
    encounterTypes: [{ name: "Home Visit", uuid: "e1" }],
  }));
  assert.ok(codes(r).includes("ENCOUNTER_TYPE_NO_FORM"));

  const ok = completenessFloor(tmpBundle({
    encounterTypes: [{ name: "Home Visit", uuid: "e1" }],
    formMappings: [{ formName: "Home Visit", formType: "Encounter", encounterTypeUUID: "e1" }],
  }));
  assert.deepEqual(ok.findings, []);
});

test("CODED_CONCEPT_TOO_FEW_ANSWERS: a coded concept with 0 or 1 answers is not a choice; 2+ is fine; non-coded is ignored", async () => {
  const { completenessFloor } = await load();
  const r = completenessFloor(tmpBundle({
    concepts: [
      { name: "Gender", uuid: "c1", dataType: "Coded", answers: [] },
      { name: "Grade", uuid: "c2", dataType: "Coded", answers: [{ name: "A", uuid: "a1" }] },
      { name: "Status", uuid: "c3", dataType: "Coded", answers: [{ name: "Yes", uuid: "a2" }, { name: "No", uuid: "a3" }] },
      { name: "Weight", uuid: "c4", dataType: "Numeric" },
    ],
  }));
  const flagged = r.findings.filter((f) => f.code === "CODED_CONCEPT_TOO_FEW_ANSWERS").map((f) => f.entity);
  assert.deepEqual(flagged.sort(), ["concept:Gender", "concept:Grade"]);
});

test("CODED_CONCEPT_TOO_FEW_ANSWERS: voided answers do not count toward the two", async () => {
  const { completenessFloor } = await load();
  const r = completenessFloor(tmpBundle({
    concepts: [{ name: "Status", uuid: "c1", dataType: "Coded", answers: [{ name: "Yes", uuid: "a1" }, { name: "Old", uuid: "a2", voided: true }] }],
  }));
  assert.ok(codes(r).includes("CODED_CONCEPT_TOO_FEW_ANSWERS"));
});

test("an absent concepts.json skips the coded check rather than failing the whole floor", async () => {
  const { completenessFloor } = await load();
  const r = completenessFloor(tmpBundle({}));
  assert.equal(r.evaluated, true);
  assert.ok(!codes(r).includes("CODED_CONCEPT_TOO_FEW_ANSWERS"));
});
