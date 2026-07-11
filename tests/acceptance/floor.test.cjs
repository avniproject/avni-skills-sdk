"use strict";
// Deterministic floor gate over the committed corpus. Self-skips when the sibling
// corpus repos (avni-ai, avni-impl-bundles) aren't checked out (e.g. bare CI) —
// a committed synthetic fixture will provide the always-on CI path (later story).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { manifest } = require("../corpus/manifest.cjs");
const { runAcceptance } = require("../corpus/lib/acceptance-core.cjs");

const phulwari = manifest().find((r) => r.org === "phulwari");
const skipNoCorpus = !fs.existsSync(phulwari.oracle.dir) && "committed corpus siblings not checked out";

test("deterministic floor is green on the committed corpus", { skip: skipNoCorpus }, async () => {
  const res = await runAcceptance({ real: false, hasKey: false });
  assert.ok(res.orgs.length >= 5, `expected ≥5 committed orgs, got ${res.orgs.length}`);
  assert.equal(res.global["C5-generic"].status, "green", res.global["C5-generic"].detail);
  assert.equal(res.floorPass, true, `floor reds: ${res.floorReds.join(", ")}`);
});
