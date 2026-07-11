"use strict";
// Gated: runs the real avni-skills generator (slow, needs the committed corpus +
// avni-skills sibling). Enable with RUN_GENERATE=1.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { manifest } = require("../manifest.cjs");
const { loadOracle } = require("./corpus-loader.cjs");

const org = manifest().find((r) => r.org === "Mazi Saheli");
const enabled = process.env.RUN_GENERATE === "1" && org && fs.existsSync(org.inputs.srs);
const skip = !enabled && "set RUN_GENERATE=1 with the committed corpus to run generation";

test("generation pipeline runs and returns a deep-diff gap vs the oracle", { skip }, async () => {
  const { generateAndDiff } = require("./generation.cjs");
  const oracleDir = loadOracle(org);
  const r = await generateAndDiff(org, oracleDir);
  assert.ok(r.generated || r.error, "generation returned a structured result");
  if (r.generated) {
    assert.equal(typeof r.pass, "boolean");
    assert.ok(r.gap.forms, "forms gap reported");
  }
});
