"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
async function loadDoc() {
  const m = await import(pathToFileURL(path.resolve(__dirname, "../../src/crl/compliance-doc.js")).href);
  return m.loadComplianceDoc();
}
test("prose-as-entity-name rule exists as ai-judged prune-candidate", async () => {
  const doc = await loadDoc();
  const rule = doc.rules.find((r) => r.id === "prose-as-entity-name");
  assert.ok(rule, "prose-as-entity-name rule must be present");
  assert.equal(rule.tier, "ai-judged");
  assert.equal(rule.class, "stray");
  assert.equal(rule.action, "prune-candidate");
});
