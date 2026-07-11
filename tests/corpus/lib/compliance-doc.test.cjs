"use strict";
// Unit tests for src/crl/compliance-doc.js — the CRL's YAML loader.
// Bridges CJS → the ESM loader via a cached dynamic import (mirrors
// tests/corpus/lib/rule-grounding.cjs's bridge to src/rules-brain/validate.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { manifest } = require("../manifest.cjs");

const MOD = path.resolve(__dirname, "..", "..", "..", "src", "crl", "compliance-doc.js");
let _mod;
async function load() {
  if (!_mod) _mod = await import(pathToFileURL(MOD).href);
  return _mod;
}

// ─── Task 1.0 — js-yaml provisioned via the brain's node_modules (MAJ-2) ───
test("loadYaml resolves js-yaml from the brain and parses a YAML string (MAJ-2)", async () => {
  const { loadYaml } = await load();
  const yaml = loadYaml();
  assert.equal(typeof yaml.load, "function", "js-yaml exposes .load()");
  const parsed = yaml.load("version: 1\nrules: []\n");
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.rules, []);
});

// ─── Task 1.1 — compliance-doc.yaml + spec-template.yaml (raw structural) ───
// These parse the authored YAML directly via loadYaml (no loader/accessors yet;
// those land in 1.2) to drive the data-artifact contract from IC-7/MAJ-3/MAJ-11.
async function rawDoc(pathKey) {
  const { loadYaml, [pathKey]: p } = await load();
  return { doc: loadYaml().load(fs.readFileSync(p, "utf8")), p };
}

test("compliance-doc.yaml parses with 11 rules — 7 deterministic + 4 ai-judged (IC-7 w/ MAJ-11 FK split)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.rules), "rules is an array");
  const det = doc.rules.filter((r) => r.tier === "deterministic");
  const ai = doc.rules.filter((r) => r.tier === "ai-judged");
  // MAJ-11 splits the single FK rule into fk-coded-answer-resolves (error) +
  // fk-coded-answer-optional-present (warning), so there are 7 deterministic
  // rules, not the plan verify-snippet's stale "6". Total 11, not "10".
  assert.equal(doc.rules.length, 11, "11 rules total");
  assert.equal(det.length, 7, "7 deterministic rules");
  assert.equal(ai.length, 4, "4 ai-judged rules");
});

test("FK rule is split by severity — resolves owns MISSING_REQUIRED_REF (error), optional-present owns DANGLING_REF (warning) (MAJ-11)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const byId = Object.fromEntries(doc.rules.map((r) => [r.id, r]));
  assert.deepEqual(byId["fk-coded-answer-resolves"].codes, ["MISSING_REQUIRED_REF"]);
  assert.equal(byId["fk-coded-answer-resolves"].severity, "error");
  assert.deepEqual(byId["fk-coded-answer-optional-present"].codes, ["DANGLING_REF"]);
  assert.equal(byId["fk-coded-answer-optional-present"].severity, "warning");
});

test("all four ai-judged design-gap classes are present, incl. the concept-level orphan/stray rule with the right inputs (MAJ-3/IC-7)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const ai = doc.rules.filter((r) => r.tier === "ai-judged");
  const classes = ai.map((r) => r.class);
  assert.ok(classes.includes("stray"), "stray class present (prose-form + orphan-concept)");
  assert.ok(classes.includes("contradicts-intent"), "rule-matches-intent class present");
  assert.ok(classes.includes("incoherent-name"), "naming-coherence class present");

  const byId = Object.fromEntries(ai.map((r) => [r.id, r]));
  assert.ok(byId["prose-should-be-form"], "prose-vs-form rule exists");
  const orphan = byId["orphan-stray-concept"];
  assert.ok(orphan, "concept-level orphan/stray rule exists (not just prose-forms)");
  for (const req of ["artifact.concepts", "scopingCtx", "deterministicFindings"]) {
    assert.ok(orphan.inputs.includes(req), `orphan-stray-concept inputs include ${req}`);
  }
});

test("every provenance field is org-free (MAJ-10)", async () => {
  const { doc } = await rawDoc("DEFAULT_COMPLIANCE_DOC_PATH");
  const orgs = manifest().map((r) => r.org);
  for (const rule of doc.rules) {
    for (const org of orgs) {
      assert.ok(!String(rule.provenance || "").includes(org), `rule "${rule.id}" provenance leaks org "${org}"`);
    }
  }
});

test("spec-template.yaml parses with a non-empty sections array", async () => {
  const { doc } = await rawDoc("DEFAULT_SPEC_TEMPLATE_PATH");
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.sections) && doc.sections.length > 0, "sections present");
});
