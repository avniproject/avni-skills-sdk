"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scrubScore } = require("./crl-scrub-eval.cjs");

function tmpBundle(concepts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrub-eval-"));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  return dir;
}

test("identical scrubbed and oracle dirs: zero extra, zero present-loss", () => {
  const concepts = [{ name: "Age", dataType: "Numeric" }, { name: "Religion", dataType: "Coded" }];
  const scrubbed = tmpBundle(concepts);
  const oracle = tmpBundle(concepts);
  const s = scrubScore(scrubbed, oracle);
  assert.equal(s.extraCount, 0, JSON.stringify(s.extraByClass));
  assert.equal(s.presentLossCount, 0, JSON.stringify(s.missingByClass));
});

test("a leftover stray in the scrubbed dir is counted as extra, not present-loss", () => {
  const oracleConcepts = [{ name: "Age", dataType: "Numeric" }];
  const scrubbedConcepts = [{ name: "Age", dataType: "Numeric" }, { name: "Orphan NA Alpha", dataType: "NA" }];
  const s = scrubScore(tmpBundle(scrubbedConcepts), tmpBundle(oracleConcepts));
  assert.equal(s.extraCount, 1);
  assert.deepEqual(s.extraByClass.concepts, ["orphan na alpha"]);
  assert.equal(s.presentLossCount, 0);
});

test("a real entry removed from the scrubbed dir is counted as present-loss (the precision guardrail)", () => {
  const oracleConcepts = [{ name: "Age", dataType: "Numeric" }, { name: "Religion", dataType: "Coded" }];
  const scrubbedConcepts = [{ name: "Religion", dataType: "Coded" }]; // "Age" wrongly pruned
  const s = scrubScore(tmpBundle(scrubbedConcepts), tmpBundle(oracleConcepts));
  assert.equal(s.presentLossCount, 1, "a wrongly-pruned real entry must be counted");
  assert.deepEqual(s.missingByClass.concepts, ["age"]);
  assert.equal(s.extraCount, 0);
});
