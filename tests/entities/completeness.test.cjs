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
function tmpBundle({ subjectTypes = [], programs = [], encounterTypes = [], formMappings = [], forms = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compl-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs));
  fs.writeFileSync(path.join(dir, "encounterTypes.json"), JSON.stringify(encounterTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
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
