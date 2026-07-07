// build-model-matrix.test.cjs — the regenerate-from-evidence script
// (scripts/build-model-matrix.mjs), story #13, P5.
//
// Proves: the interim seed is reproducible/idempotent, and the regenerator turns
// a synthetic eval-results JSONL into the expected matrix (pass-rates +
// provenance), is idempotent, honours the pass-rate threshold, and produces a
// self-consistent checksum. Synthetic in-memory only — no LLM, no disk eval run.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function loadBuilder() {
  return import("../../scripts/build-model-matrix.mjs?t=" + Date.now());
}
async function loadMatrixMod() {
  return import("../../src/model-matrix.js?t=" + Date.now());
}

// A small synthetic eval-results set (the shape run.cjs appends to
// SDK_EVAL_RESULTS_JSONL). opus passes everything it ran; haiku splits
// data-integrity (1/2) and clears no-thrash.
function syntheticRows() {
  const base = { runId: "eval-TEST", date: "2026-07-01" };
  return [
    { ...base, model: "claude-opus-4-8", name: "02-fix-c5-error", category: "data-integrity", status: "pass" },
    { ...base, model: "claude-opus-4-8", name: "11-fix-f5-dangling-uuid", category: "data-integrity", status: "pass" },
    { ...base, model: "claude-opus-4-8", name: "10-no-thrash", category: "no-thrash", status: "pass" },
    { ...base, model: "claude-haiku-4-5", name: "02-fix-c5-error", category: "data-integrity", status: "pass" },
    { ...base, model: "claude-haiku-4-5", name: "11-fix-f5-dangling-uuid", category: "data-integrity", status: "fail" },
    { ...base, model: "claude-haiku-4-5", name: "10-no-thrash", category: "no-thrash", status: "pass" },
    // pending/skipped must be ignored by the regenerator.
    { ...base, model: "claude-haiku-4-5", name: "17-large-bundle-converges", category: "correctness", status: "skipped" },
  ];
}

test("interim seed: buildInterim() is reproducible + self-consistent checksum", async () => {
  const B = await loadBuilder();
  const M = await loadMatrixMod();
  const a = B.buildInterim();
  const b = B.buildInterim();
  assert.equal(B.serializeMatrix(a), B.serializeMatrix(b), "interim build must be deterministic");
  assert.equal(a.source, "interim-seed");
  assert.equal(a.checksum, M.computeChecksum(a.models), "checksum must match its models payload");
  assert.ok(M.verifyChecksum(a));
});

test("regenerator: computes pass-rates + qualification from eval-results JSONL", async () => {
  const B = await loadBuilder();
  const M = await loadMatrixMod();
  const doc = B.buildFromResults(syntheticRows(), 1.0);

  assert.equal(doc.source, "eval-run");
  assert.equal(doc.generatedAt, "2026-07-01", "generatedAt derived from input, not Date.now()");
  assert.deepEqual(doc.runIds, ["eval-TEST"]);

  const opus = doc.models["claude-opus-4-8"].qualification;
  assert.equal(opus["data-integrity"].qualified, true);
  assert.equal(opus["data-integrity"].passed, 2);
  assert.equal(opus["data-integrity"].total, 2);
  assert.equal(opus["data-integrity"].passRate, 1);
  assert.equal(opus["data-integrity"].source, "eval-run");
  assert.equal(opus["data-integrity"].runId, "eval-TEST");
  assert.equal(opus["no-thrash"].qualified, true);
  // Categories with no observed cases → not qualified, zero evidence.
  assert.equal(opus["srs-authorship"].qualified, false);
  assert.equal(opus["srs-authorship"].total, 0);

  const haiku = doc.models["claude-haiku-4-5"].qualification;
  // 1/2 in data-integrity → NOT qualified at threshold 1.0.
  assert.equal(haiku["data-integrity"].qualified, false);
  assert.equal(haiku["data-integrity"].passed, 1);
  assert.equal(haiku["data-integrity"].total, 2);
  assert.equal(haiku["data-integrity"].passRate, 0.5);
  // no-thrash cleared.
  assert.equal(haiku["no-thrash"].qualified, true);
  // skipped case must not have created a correctness data point.
  assert.equal(haiku["correctness"].total, 0);

  // Evidence-driven tool tiers: haiku earns read-only (no structural category),
  // opus earns the full set.
  assert.deepEqual(doc.models["claude-haiku-4-5"].toolTiers, ["read"]);
  assert.deepEqual(doc.models["claude-opus-4-8"].toolTiers, ["read", "write", "structural", "export"]);

  // Self-consistent checksum.
  assert.equal(doc.checksum, M.computeChecksum(doc.models));
  assert.ok(M.verifyChecksum(doc));
});

test("regenerator: is idempotent (same input → byte-identical output)", async () => {
  const B = await loadBuilder();
  const rows = syntheticRows();
  const a = B.serializeMatrix(B.buildFromResults(rows, 1.0));
  const b = B.serializeMatrix(B.buildFromResults(rows, 1.0));
  assert.equal(a, b);
});

test("regenerator: threshold governs qualification (0.5 qualifies haiku's split category)", async () => {
  const B = await loadBuilder();
  const strict = B.buildFromResults(syntheticRows(), 1.0);
  const lenient = B.buildFromResults(syntheticRows(), 0.5);
  assert.equal(strict.models["claude-haiku-4-5"].qualification["data-integrity"].qualified, false);
  assert.equal(lenient.models["claude-haiku-4-5"].qualification["data-integrity"].qualified, true);
});

test("regenerator: mutation-proven checksum on a regenerated matrix", async () => {
  const B = await loadBuilder();
  const M = await loadMatrixMod();
  const doc = B.buildFromResults(syntheticRows(), 1.0);
  const clone = JSON.parse(JSON.stringify(doc));
  clone.models["claude-opus-4-8"].qualification["data-integrity"].qualified = false;
  assert.notEqual(M.computeChecksum(clone.models), doc.checksum);
});

test("regenerator: the committed interim matrix equals a fresh buildInterim()", async () => {
  // Guards against a hand-edited spec/model-qualification.json drifting from the
  // generator — the committed seed must be exactly what --interim produces.
  const B = await loadBuilder();
  const M = await loadMatrixMod();
  const fresh = B.buildInterim();
  const committed = M.loadMatrix();
  assert.equal(B.serializeMatrix(committed), B.serializeMatrix(fresh),
    "committed spec/model-qualification.json is stale — re-run `node scripts/build-model-matrix.mjs --interim`");
});
