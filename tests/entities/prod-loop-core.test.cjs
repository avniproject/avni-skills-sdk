"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
async function load() { return import(pathToFileURL(path.resolve(__dirname, "../../scripts/prod-loop-core.mjs")).href); }
test("shouldExit only when floor green AND no confirmed findings", async () => {
  const { shouldExit } = await load();
  assert.equal(shouldExit({ floorGreen: true }, []), true);
  assert.equal(shouldExit({ floorGreen: true }, [{ id: 1 }]), false);
  assert.equal(shouldExit({ floorGreen: false }, []), false);
});
test("regressed: green→red is a regression", async () => {
  const { regressed } = await load();
  assert.equal(regressed({ floorGreen: true }, { floorGreen: false }), true);
  assert.equal(regressed({ floorGreen: false }, { floorGreen: false }), false);
  assert.equal(regressed({ floorGreen: true }, { floorGreen: true }), false);
});
test("pickFixModel routes semantic→opus, mechanical→haiku (never sonnet)", async () => {
  const { pickFixModel } = await load();
  assert.equal(pickFixModel({ kind: "rule-authoring" }), "opus");
  assert.equal(pickFixModel({ kind: "reclassify-stray" }), "haiku");
});
test("dedupeFindings collapses same entity+category", async () => {
  const { dedupeFindings } = await load();
  const out = dedupeFindings([{ entity: "e", category: "c", confidence: 0.7 }, { entity: "e", category: "c", confidence: 0.9 }, { entity: "e2", category: "c", confidence: 0.5 }]);
  assert.equal(out.length, 2);
  assert.equal(out.find((f) => f.entity === "e").confidence, 0.9);
});
