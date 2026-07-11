"use strict";
// Unit tests for src/crl/compliance-doc.js — the CRL's YAML loader.
// Bridges CJS → the ESM loader via a cached dynamic import (mirrors
// tests/corpus/lib/rule-grounding.cjs's bridge to src/rules-brain/validate.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
