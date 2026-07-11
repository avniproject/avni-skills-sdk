"use strict";
// src/crl/index.js re-exports the full CRL public surface (Phase 1 + Phase 2).
// Names reflect the ACTUAL shipped P1 surface (deterministicRulesOf/aiRulesOf),
// with deterministicRules/aiRules aliases for the master §2.2 names. P1 folded
// shape validation into loadComplianceDoc and matches by source/codes (no
// delegate registry), so resolveDelegate/assertDocShape do not exist.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const IDX = path.resolve(__dirname, "..", "..", "src", "crl", "index.js");

test("src/crl/index.js re-exports the full CRL public surface", async () => {
  const m = await import(pathToFileURL(IDX).href + "?t=" + Date.now());
  for (const name of [
    "loadComplianceDoc", "loadSpecTemplate", "deterministicRulesOf", "aiRulesOf",
    "deterministicRules", "aiRules",
    "deterministicChecker",
    "aiJudge", "selectJudgeModel", "buildBundleProjection", "HAIKU_MODEL", "SONNET_MODEL",
    "executor",
    "reviewBundle", "reviewSpec", "crlGate",
  ]) {
    assert.notEqual(m[name], undefined, `index.js must export ${name}`);
  }
});
