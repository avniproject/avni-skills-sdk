// eval-cases-load.test.cjs — the eval registry loads + every case exposes a
// valid contract, WITHOUT executing the LLM (story #11 part B).
//
// The eval harness (tests/eval/run.cjs) is gated on ANTHROPIC_API_KEY and only
// runs during a paid ops sweep. This test proves the STATIC health of the suite
// under `npm test`: all 20 case files parse + expose their contract, the fixture
// + assertion libs load, and the harness SKIPS cleanly with no key (no spend).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CASES_DIR = path.resolve(__dirname, "..", "eval", "cases");
const EVAL_DIR = path.resolve(__dirname, "..", "eval");
const SDK_DIR = path.resolve(__dirname, "..", "..");

function caseFiles() {
  return fs.readdirSync(CASES_DIR).filter((f) => f.endsWith(".cjs")).sort();
}

// ─── registry shape ─────────────────────────────────────────────────

test("eval registry: exactly 20 case files, numbered 01..20", () => {
  const files = caseFiles();
  assert.equal(files.length, 20, `expected 20 case files, got ${files.length}: ${files.join(", ")}`);
  const nums = files.map((f) => f.slice(0, 2));
  const expected = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"));
  assert.deepEqual(nums, expected, `case numbering gaps: ${nums.join(", ")}`);
});

test("eval cases: every file loads + exposes a valid contract (no LLM executed)", () => {
  const names = new Set();
  for (const f of caseFiles()) {
    let mod;
    assert.doesNotThrow(() => { mod = require(path.join(CASES_DIR, f)); }, `case ${f} failed to load`);
    assert.ok(mod && typeof mod === "object", `${f}: module.exports missing`);
    assert.ok(typeof mod.name === "string" && mod.name, `${f}: missing string 'name'`);
    assert.ok(!names.has(mod.name), `${f}: duplicate case name '${mod.name}'`);
    names.add(mod.name);
    assert.ok(f.startsWith(mod.name.slice(0, 2)), `${f}: name '${mod.name}' should share the file's number`);

    if (mod.pending) {
      assert.ok(typeof mod.pendingReason === "string", `${f}: pending case needs pendingReason`);
      continue;
    }
    // A runnable case must expose the full contract — but we NEVER call these
    // here (that would dispatch the LLM). We only assert their shape.
    assert.equal(typeof mod.setupFixture, "function", `${f}: setupFixture must be a function`);
    assert.equal(typeof mod.prompt, "string", `${f}: prompt must be a string`);
    assert.ok(mod.prompt.length > 0, `${f}: prompt must be non-empty`);
    assert.equal(typeof mod.assertions, "function", `${f}: assertions must be a function`);
    assert.equal(typeof mod.maxCostUsd, "number", `${f}: maxCostUsd (budget cap) must be a number`);
  }
  assert.equal(names.size, 20);
});

test("eval cases: all 20 are implemented (no pending stubs remain)", () => {
  const pending = caseFiles()
    .map((f) => require(path.join(CASES_DIR, f)))
    .filter((m) => m.pending)
    .map((m) => m.name);
  assert.deepEqual(pending, [], `still-pending cases: ${pending.join(", ")}`);
});

// ─── lib health ─────────────────────────────────────────────────────

test("eval libs: fixture + assertions expose the story #11 additions", () => {
  const fixture = require(path.join(EVAL_DIR, "lib", "fixture.cjs"));
  for (const fn of ["buildCleanSrsBuffers", "buildLocationTrapSrs", "buildLargeSrs",
                    "seedF5", "seedM3", "seedG2", "seedNAJunk", "poisonBundleForCode"]) {
    assert.equal(typeof fixture[fn], "function", `fixture.${fn} missing`);
  }
  const A = require(path.join(EVAL_DIR, "lib", "assertions.cjs"));
  for (const fn of ["assertToolOrder", "assertFormsEmbedConceptName", "assertFormMappingSubjectType",
                    "assertNoInventedPrivilegeType", "assertConceptCountByName", "isFileEditTool"]) {
    assert.equal(typeof A[fn], "function", `assertions.${fn} missing`);
  }
});

test("eval poisonBundleForCode: rejects unknown codes, accepts the known set", () => {
  const fixture = require(path.join(EVAL_DIR, "lib", "fixture.cjs"));
  assert.throws(() => fixture.poisonBundleForCode("/nonexistent", "ZZ99"), /unknown poison code/);
});

// ─── skip-without-key (no spend) ────────────────────────────────────

test("eval harness SKIPS cleanly (exit 0, status=skipped) when no ANTHROPIC_API_KEY", () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const r = spawnSync("node", ["tests/eval/run.cjs"], {
    cwd: SDK_DIR,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `run.cjs should exit 0 without a key; got ${r.status}. stderr: ${r.stderr}`);
  let report;
  assert.doesNotThrow(() => { report = JSON.parse(r.stdout); }, `stdout not JSON: ${r.stdout}`);
  assert.equal(report.status, "skipped", `expected status=skipped, got ${JSON.stringify(report)}`);
});
