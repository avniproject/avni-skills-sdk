"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { manifest } = require("../manifest.cjs");
const { runAcceptance, CRITERIA } = require("./acceptance-core.cjs");

const phulwari = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwari.oracle.dir) && "committed corpus siblings not checked out";

// MAJ-8 / O-4: CRL2a is aspirational — its real CI floor lives in the P2
// executor guardrail tests, not here. O-1: CRL6 (spec-completeness) is
// likewise aspirational (agent/eval-scored, budget-gated).
const NEW_CRL_KEYS = [
  "CRL2a-scrub-precision",
  "CRL2b-scrub-recall",
  "CRL3-inspector",
  "CRL4-additive-safety",
  "CRL5-cost",
  "CRL6-spec-completeness",
];

test("CRITERIA declares the harness-eval CRL criteria (CRL2a-5 + CRL6), all aspirational (MAJ-8/O-1), agent-scored", () => {
  for (const key of NEW_CRL_KEYS) {
    const row = CRITERIA.find((c) => c.key === key);
    assert.ok(row, `CRITERIA missing ${key}`);
    assert.equal(row.tier, "aspirational", `${key} tier`);
    assert.equal(row.live, false, `${key} must not be live (agent-scored)`);
    assert.equal(row.agent, true, `${key} must be flagged agent:true`);
  }
  const keys = CRITERIA.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "CRITERIA keys must stay unique");
});

test("runAcceptance({crl:true}) populates a skip dim (with a pointer) for every new CRL key, per org", { skip: skipNoCorpus }, async () => {
  const res = await runAcceptance({ real: false, hasKey: false, crl: true });
  assert.ok(res.orgs.length >= 5, `expected >=5 committed orgs, got ${res.orgs.length}`);
  for (const o of res.orgs) {
    for (const key of NEW_CRL_KEYS) {
      assert.ok(o.dims[key], `${o.org} missing dim ${key}`);
      assert.equal(o.dims[key].status, "skip", `${o.org}/${key} status`);
      assert.match(o.dims[key].detail, /tests\/eval\/cases\/25-29/, `${o.org}/${key} detail should point at the eval cases`);
    }
    assert.match(o.dims["CRL2a-scrub-precision"].detail, /executor guardrail/, "CRL2a must point at the real CI floor (MAJ-8)");
    assert.match(o.dims["CRL5-cost"].detail, /review-cost/, "CRL5 must point at where its datapoint is recorded (MAJ-7)");
    assert.match(o.dims["CRL6-spec-completeness"].detail, /reviewSpec|spec-completeness/, "CRL6 must point at the spec-review datapoint (O-1)");
  }
  assert.equal(res.crl, true, "runAcceptance echoes the crl flag back");
});

test("runAcceptance() without crl (default) leaves the new CRL dims unpopulated — old callers unaffected", { skip: skipNoCorpus }, async () => {
  const res = await runAcceptance({ real: false, hasKey: false });
  assert.equal(res.crl, false);
  for (const o of res.orgs) {
    for (const key of NEW_CRL_KEYS) {
      assert.equal(o.dims[key], undefined, `${o.org}/${key} should stay unpopulated when crl is not requested`);
    }
  }
  assert.equal(res.floorPass, true, `floor reds: ${res.floorReds.join(", ")}`);
});
