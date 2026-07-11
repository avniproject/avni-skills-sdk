"use strict";
// Deterministic floor gate over the committed corpus. Self-skips when the sibling
// corpus repos (avni-ai, avni-impl-bundles) aren't checked out (e.g. bare CI) —
// a committed synthetic fixture will provide the always-on CI path (later story).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAcceptance } = require("../corpus/lib/acceptance-core.cjs");

const res = runAcceptance({ real: false, hasKey: false });
const corpusPresent = res.orgs.length >= 5;

test("deterministic floor is green on the committed corpus",
  { skip: !corpusPresent && "committed corpus siblings not checked out" },
  () => {
    assert.equal(res.global["C5-generic"].status, "green", res.global["C5-generic"].detail);
    assert.equal(res.floorPass, true, `floor reds: ${res.floorReds.join(", ")}`);
  });
