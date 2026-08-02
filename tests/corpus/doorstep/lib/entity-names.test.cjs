"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeName, isVoided, bundleActiveNames } = require("./entity-names.cjs");

test("normalizeName lowercases, trims, collapses whitespace, strips voided suffix", () => {
  assert.equal(normalizeName("  FLN   Enrolment "), "fln enrolment");
  assert.equal(normalizeName("Donor Association (voided~2240)"), "donor association");
  assert.equal(normalizeName("Attendance (voided~23177)"), "attendance");
  assert.equal(normalizeName(null), "");
  assert.equal(normalizeName(undefined), "");
});

test("isVoided detects the voided flag and the name marker", () => {
  assert.equal(isVoided({ name: "FLN", voided: true }), true);
  assert.equal(isVoided({ name: "Attendance (voided~23177)", voided: false }), true);
  assert.equal(isVoided({ name: "FLN", voided: false }), false);
  assert.equal(isVoided({ name: "FLN" }), false);
  assert.equal(isVoided(null), false);
  assert.equal(isVoided("not-an-object"), false);
});

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-bundle-"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(content));
  }
  return dir;
}

test("bundleActiveNames collects active names and excludes voided", () => {
  const dir = tmpBundle({
    "subjectTypes.json": [{ name: "Student" }, { name: "Old", voided: true }],
    "programs.json": [{ name: "FLN" }, { name: "Donor Association (voided~2240)", voided: true }],
    "encounterTypes.json": [{ name: "FLN Performance Assessment" }],
    "addressLevelTypes.json": [{ name: "School" }],
    "forms/a.json": { name: "Student Register" },
    "forms/b.json": { name: "Attendance (voided~1)", voided: true },
    "formMappings.json": [{ formName: "Student Register" }],
  });
  const n = bundleActiveNames(dir);
  assert.deepEqual([...n.subjectTypes].sort(), ["student"]);
  assert.deepEqual([...n.programs].sort(), ["fln"]);
  assert.deepEqual([...n.encounterTypes].sort(), ["fln performance assessment"]);
  assert.deepEqual([...n.forms].sort(), ["student register"]);
  assert.deepEqual([...n.addressLevelTypes].sort(), ["school"]);
  assert.deepEqual([...n.formMappings].sort(), ["student register"]);
});

// ─── behavioural classes (design gap#4) ───
// The six name classes above are silent about whether the config DOES anything.
// A generated bundle can match every roster name while carrying no visit
// schedules, no decision rules and a stub dashboard — which is exactly the
// state the name-only comparator reported as full parity.
test("bundleActiveNames reports which forms carry visit-schedule / decision / validation rules, not just how many", () => {
  const dir = tmpBundle({
    "forms/a.json": { name: "FLN Enrolment", visitScheduleRule: "({params}) => []" },
    "forms/b.json": { name: "Reading Enrolment", decisionRule: "({params}) => ({})", validationRule: "x" },
    "forms/c.json": { name: "Plain Form" },
    "forms/d.json": { name: "Blank Rules", visitScheduleRule: "", decisionRule: "   " },
    "forms/e.json": { name: "Voided One (voided~3)", voided: true, visitScheduleRule: "({params}) => []" },
  });
  const n = bundleActiveNames(dir);
  assert.deepEqual([...n.formsWithVisitScheduleRule].sort(), ["fln enrolment"]);
  assert.deepEqual([...n.formsWithDecisionRule].sort(), ["reading enrolment"]);
  assert.deepEqual([...n.formsWithValidationRule].sort(), ["reading enrolment"]);
});

test("bundleActiveNames treats an empty-string or whitespace rule as ABSENT — an empty rule does nothing, so it must not read as configured", () => {
  const dir = tmpBundle({ "forms/d.json": { name: "Blank Rules", visitScheduleRule: "", decisionRule: "   ", validationRule: null } });
  const n = bundleActiveNames(dir);
  assert.equal(n.formsWithVisitScheduleRule.size, 0);
  assert.equal(n.formsWithDecisionRule.size, 0);
  assert.equal(n.formsWithValidationRule.size, 0);
});

test("bundleActiveNames collects groups, report cards and dashboards — the categories a generated bundle stubs out", () => {
  const dir = tmpBundle({
    "groups.json": [{ name: "Everyone" }, { name: "Teachers" }, { name: "Retired", voided: true }],
    "reportCard.json": [{ name: "Total" }, { name: "Overdue visits" }],
    "reportDashboard.json": [{ name: "Teacher Dashboard" }],
  });
  const n = bundleActiveNames(dir);
  assert.deepEqual([...n.groups].sort(), ["everyone", "teachers"]);
  assert.deepEqual([...n.reportCards].sort(), ["overdue visits", "total"]);
  assert.deepEqual([...n.reportDashboards].sort(), ["teacher dashboard"]);
});

test("bundleActiveNames tolerates missing files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-empty-"));
  const n = bundleActiveNames(dir);
  for (const k of ["subjectTypes","programs","encounterTypes","forms","addressLevelTypes","formMappings"]) {
    assert.equal(n[k].size, 0, `${k} empty`);
  }
});

test("bundleActiveNames unwraps { key: [...] }-shaped files", () => {
  const dir = tmpBundle({
    "subjectTypes.json": { subjectTypes: [{ name: "Student" }, { name: "Gone", voided: true }] },
  });
  const n = bundleActiveNames(dir);
  assert.deepEqual([...n.subjectTypes].sort(), ["student"]);
});

test("bundleActiveNames excludes voided formMappings", () => {
  const dir = tmpBundle({
    "formMappings.json": [{ formName: "Student Register" }, { formName: "Old Map", voided: true }],
  });
  const n = bundleActiveNames(dir);
  assert.deepEqual([...n.formMappings].sort(), ["student register"]);
});
