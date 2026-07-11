"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manifest } = require("../manifest.cjs");
const { loadOracle } = require("./corpus-loader.cjs");
const { bundleDeepNames } = require("./deep-names.cjs");
const { diffDeep } = require("./deep-diff.cjs");

const phulwariRow = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwariRow.oracle.dir) && "committed corpus siblings not checked out";

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deep-bundle-"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(content));
  }
  return dir;
}

test("real bundle (phulwari): full-depth graph is rich and self-parity is clean", { skip: skipNoCorpus }, () => {
  const dir = loadOracle(manifest().find((r) => r.org === "phulwari"));
  const g = bundleDeepNames(dir);
  // rich: the deep layers are actually populated
  assert.ok(g.concepts.size > 50, `concepts ${g.concepts.size}`);
  assert.ok(g.formElements.size > 0, "form elements present");
  assert.ok(g.codedAnswers.size > 0, "coded answers present");
  assert.ok([...g.ruleFields].some((t) => t.toLowerCase().includes(":visitschedulerule")), "a visitScheduleRule is detected");
  // self-diff ⇒ full-depth floor is clean (the oracle-only round-trip guarantee)
  const d = diffDeep(g, g);
  assert.equal(d.pass, true, "self-parity passes");
  for (const k of d.gateClasses) {
    assert.equal(d.classes[k].missing.length, 0, `${k} no missing`);
    assert.equal(d.classes[k].extra.length, 0, `${k} no extra`);
  }
});

test("full-depth floor fails when the generated bundle drops a form element", () => {
  const target = tmpBundle({
    "subjectTypes.json": [{ name: "Member" }],
    "concepts.json": [{ name: "Weight", dataType: "Numeric" }],
    "forms/reg.json": { name: "Registration", formElementGroups: [{ name: "Main", formElements: [{ name: "Weight" }, { name: "Height" }] }] },
  });
  const generated = tmpBundle({
    "subjectTypes.json": [{ name: "Member" }],
    "concepts.json": [{ name: "Weight", dataType: "Numeric" }],
    "forms/reg.json": { name: "Registration", formElementGroups: [{ name: "Main", formElements: [{ name: "Weight" }] }] },
  });
  const d = diffDeep(bundleDeepNames(generated), bundleDeepNames(target));
  assert.equal(d.pass, false, "missing form element fails the full-depth floor");
  assert.deepEqual(d.classes.formElements.missing, ["registration › height"]);
});

test("voided/inactive entities are excluded from the graph", () => {
  const dir = tmpBundle({
    "subjectTypes.json": [{ name: "Member" }, { name: "Old", voided: true }, { name: "Off", active: false }],
    "forms/a.json": { name: "Kept", formElementGroups: [] },
    "forms/b.json": { name: "Gone (voided~9)", voided: true, formElementGroups: [] },
  });
  const g = bundleDeepNames(dir);
  assert.deepEqual([...g.subjectTypes].sort(), ["member"]);
  assert.deepEqual([...g.forms].sort(), ["kept"]);
});

test("rule-field presence is a parity class (floor)", () => {
  const withRule = tmpBundle({
    "programs.json": [{ name: "ANC", enrolmentEligibilityCheckRule: "() => true" }],
    "forms/x.json": { name: "Visit", visitScheduleRule: "() => []" },
  });
  const withoutRule = tmpBundle({
    "programs.json": [{ name: "ANC" }],
    "forms/x.json": { name: "Visit" },
  });
  const d = diffDeep(bundleDeepNames(withoutRule), bundleDeepNames(withRule));
  assert.equal(d.pass, false, "a missing rule field fails the floor");
  assert.ok(d.classes.ruleFields.missing.includes("program:anc:enrolmentEligibilityCheckRule"));
  assert.ok(d.classes.ruleFields.missing.includes("form:visit:visitScheduleRule"));
});
