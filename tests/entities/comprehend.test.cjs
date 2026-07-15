"use strict";
// CI-safe test for comprehend.js. The real comprehension pass is EVAL-ONLY (it
// calls Opus) — see design.md "Model-dependent (eval, manual)". Here we only
// assert the no-key clean-skip contract: with ANTHROPIC_API_KEY unset,
// comprehendBundle returns the skip shape WITHOUT calling the model and never
// throws. Any live round-trip is opt-in and lives in the eval harness, not CI.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function load() {
  return import(pathToFileURL(path.resolve(__dirname, "../../src/comprehension/comprehend.js")).href);
}

test("comprehendBundle: no ANTHROPIC_API_KEY → clean skip shape, no model call, never throws", async () => {
  const { comprehendBundle } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comprehend-"));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([{ name: "Gender", uuid: "c-gender", dataType: "Coded", answers: [] }]));

  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await comprehendBundle(dir, {});
    assert.deepEqual(result, { patch: null, valid: [], dropped: [], skipped: "no ANTHROPIC_API_KEY" });
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
