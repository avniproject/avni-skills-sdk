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
