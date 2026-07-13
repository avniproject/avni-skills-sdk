// model-matrix.test.cjs — the evidence-based model-qualification matrix +
// selectModel() + the find-references tool promotion (story #13, P5).
//
// Synthetic / in-memory only (CLAUDE.md rule §1). No API key, no LLM — these are
// deterministic unit tests of the matrix, selection logic, checksum provenance,
// tool tiers, and the promoted MCP tool.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function loadMatrixMod() {
  return import("../../src/model-matrix.js?t=" + Date.now());
}
async function loadAgent() {
  return import("../../src/agent.js?t=" + Date.now());
}
async function loadMcp() {
  return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now());
}
async function loadNames() {
  return import("../../src/agents/bundle-mcp-tool-names.js?t=" + Date.now());
}

// ─── matrix loads + has provenance ──────────────────────────────────

test("matrix: loads with version, categories, fallbackModel, models, checksum", async () => {
  const M = await loadMatrixMod();
  const matrix = M.loadMatrix();
  assert.equal(matrix.version, 1);
  assert.deepEqual(matrix.categories, [...M.CATEGORIES]);
  assert.equal(typeof matrix.fallbackModel, "string");
  assert.ok(matrix.models && typeof matrix.models === "object");
  assert.match(matrix.checksum, /^sha256:[0-9a-f]{64}$/);
  // Interim provenance is clearly marked so it can't be mistaken for eval data.
  assert.equal(matrix.source, "interim-seed");
  assert.match(matrix.note, /INTERIM SEED/);
  // Every cell carries provenance.
  for (const model of Object.keys(matrix.models)) {
    const q = matrix.models[model].qualification;
    for (const cat of M.CATEGORIES) {
      assert.ok(q[cat], `${model} missing qualification for ${cat}`);
      assert.equal(typeof q[cat].qualified, "boolean");
      assert.equal(q[cat].source, "interim");
    }
  }
});

test("matrix: checksum verifies, and is mutation-proven (change a value → RED)", async () => {
  const M = await loadMatrixMod();
  const matrix = M.loadMatrix();
  // Stored checksum matches a fresh recompute over the models payload.
  assert.ok(M.verifyChecksum(matrix), "stored checksum must match computeChecksum(models)");
  assert.equal(matrix.checksum, M.computeChecksum(matrix.models));

  // Mutate one qualification value on a deep clone → checksum MUST change.
  const clone = JSON.parse(JSON.stringify(matrix));
  const firstModel = Object.keys(clone.models)[0];
  const cell = clone.models[firstModel].qualification[M.CATEGORIES[0]];
  cell.qualified = !cell.qualified;
  assert.notEqual(
    M.computeChecksum(clone.models),
    matrix.checksum,
    "flipping a qualified value must change the checksum (mutation-proven)",
  );
  assert.equal(M.verifyChecksum(clone), false, "verifyChecksum must reject a mutated matrix");
});

test("matrix: fallbackModel is pinned to agent.js DEFAULT_MODEL (no drift)", async () => {
  const M = await loadMatrixMod();
  const { DEFAULT_MODEL } = await loadAgent();
  assert.equal(M.loadMatrix().fallbackModel, DEFAULT_MODEL, "matrix fallback must equal the #11 default");
  assert.equal(M.FALLBACK_DEFAULT_MODEL, DEFAULT_MODEL, "the module floor constant must equal the #11 default");
});

// ─── selectModel: qualified model per signal ────────────────────────

test("selectModel: edit mode → cheapest qualified for data-integrity (opus, the 2026-07-13 structural default)", async () => {
  const M = await loadMatrixMod();
  const r = M.selectModel({ mode: "baseline", env: null });
  assert.equal(r.category, "data-integrity");
  assert.equal(r.source, "matrix");
  // 2026-07-13 model-matrix: Sonnet demoted from structural, so opus is the sole
  // qualified model for data-integrity → cheapest qualified = opus.
  assert.equal(r.model, "claude-opus-4-8");
});

test("selectModel: agent mode → cheapest qualified for srs-authorship (opus)", async () => {
  const M = await loadMatrixMod();
  const r = M.selectModel({ mode: "agent", env: null });
  assert.equal(r.category, "srs-authorship");
  assert.equal(r.source, "matrix");
  assert.equal(r.model, "claude-opus-4-8");
});

test("selectModel: low-risk signal (structural:false) → cheapest qualified for no-thrash (haiku)", async () => {
  const M = await loadMatrixMod();
  const r = M.selectModel({ mode: "baseline", structural: false, env: null });
  assert.equal(r.category, "no-thrash");
  assert.equal(r.source, "matrix");
  // haiku is interim-qualified for no-thrash and is the cheapest → selected.
  assert.equal(r.model, "claude-haiku-4-5");
});

// ─── selectModel: precedence ────────────────────────────────────────

// FIX 3 (#13 review): an explicit caller `model` is an explicit per-request
// override and MUST beat SDK_MODEL — the epic requires "explicit per-request
// model override remains throughout". (This inverts the pre-FIX-3 order.)
test("selectModel: caller's explicit model BEATS SDK_MODEL (FIX 3 precedence)", async () => {
  const M = await loadMatrixMod();
  // Both a caller model AND an operator env are present → the caller wins.
  const r = M.selectModel({ mode: "baseline", requested: "claude-opus-4-8", env: "claude-haiku-4-5" });
  assert.equal(r.source, "caller", "explicit per-request model must win over SDK_MODEL");
  assert.equal(r.model, "claude-opus-4-8");
});

test("selectModel: caller's explicit model beats process.env.SDK_MODEL too (FIX 3)", async () => {
  const M = await loadMatrixMod();
  const prev = process.env.SDK_MODEL;
  process.env.SDK_MODEL = "claude-haiku-4-5";
  try {
    const r = M.selectModel({ mode: "baseline", requested: "claude-opus-4-8" });
    assert.equal(r.source, "caller");
    assert.equal(r.model, "claude-opus-4-8");
  } finally {
    if (prev === undefined) delete process.env.SDK_MODEL; else process.env.SDK_MODEL = prev;
  }
});

test("selectModel: SDK_MODEL still wins when the caller does NOT pin a model", async () => {
  const M = await loadMatrixMod();
  // No `requested` → the operator env override applies.
  const r = M.selectModel({ mode: "baseline", env: "claude-haiku-4-5" });
  assert.equal(r.source, "override");
  assert.equal(r.model, "claude-haiku-4-5");
});

test("selectModel: reads process.env.SDK_MODEL when env arg omitted (no caller model)", async () => {
  const M = await loadMatrixMod();
  const prev = process.env.SDK_MODEL;
  process.env.SDK_MODEL = "claude-opus-4-8";
  try {
    const r = M.selectModel({ mode: "baseline" });
    assert.equal(r.source, "override");
    assert.equal(r.model, "claude-opus-4-8");
  } finally {
    if (prev === undefined) delete process.env.SDK_MODEL; else process.env.SDK_MODEL = prev;
  }
});

test("selectModel: caller's explicit model wins over the matrix (no env override)", async () => {
  const M = await loadMatrixMod();
  const r = M.selectModel({ mode: "baseline", requested: "claude-opus-4-8", env: null });
  assert.equal(r.source, "caller");
  assert.equal(r.model, "claude-opus-4-8");
});

// FIX 3 (runner.cjs): a per-case model must beat the run-wide SDK_EVAL_MODEL,
// mirroring `dispatchModel = caseDef.model || evalModel`. Kept in sync with
// tests/eval/lib/runner.cjs so a frontier-pinned case isn't contaminated by a
// broad SDK_EVAL_MODEL sweep. (Pure logic mirror — the eval harness itself is
// budget-gated and never runs in `npm test`.)
test("eval dispatch precedence: per-case model beats SDK_EVAL_MODEL (FIX 3)", async () => {
  const pick = (caseModel, evalModel) => caseModel || evalModel || undefined;
  assert.equal(pick("claude-opus-4-8", "claude-haiku-4-5"), "claude-opus-4-8", "per-case pin wins");
  assert.equal(pick(undefined, "claude-haiku-4-5"), "claude-haiku-4-5", "SDK_EVAL_MODEL pins cases with no model");
  assert.equal(pick(undefined, ""), undefined, "neither set → server/matrix selects");
});

// ─── selectModel: NO-EVIDENCE FALLBACK (regression guard) ────────────

test("selectModel: no qualified model for a category → falls back to the #11 default", async () => {
  const M = await loadMatrixMod();
  const { DEFAULT_MODEL } = await loadAgent();
  // Synthetic matrix with ZERO qualified models for data-integrity.
  const emptyEvidence = {
    source: "test-empty",
    fallbackModel: DEFAULT_MODEL,
    models: {
      "claude-haiku-4-5": {
        qualification: {
          "data-integrity": { qualified: false },
          "no-thrash": { qualified: false },
          "srs-authorship": { qualified: false },
          "correctness": { qualified: false },
          "safety-refusal": { qualified: false },
        },
      },
    },
  };
  const r = M.selectModel({ mode: "baseline", env: null, matrix: emptyEvidence });
  assert.equal(r.source, "fallback");
  assert.equal(r.model, DEFAULT_MODEL, "no evidence MUST NOT downgrade — return the #11 default");
});

test("selectModel: empty matrix models {} → still returns the #11 default (never throws)", async () => {
  const M = await loadMatrixMod();
  const { DEFAULT_MODEL } = await loadAgent();
  const r = M.selectModel({ mode: "agent", env: null, matrix: { models: {}, fallbackModel: DEFAULT_MODEL } });
  assert.equal(r.source, "fallback");
  assert.equal(r.model, DEFAULT_MODEL);
});

// ─── tool tiers (evidence-driven tool promotion) ────────────────────

test("tool tiers: haiku + sonnet are read-only; only opus earns structural tiers (2026-07-13)", async () => {
  const M = await loadMatrixMod();
  // 2026-07-13 model-matrix: Sonnet demoted from structural → read-only, like haiku.
  assert.deepEqual(M.toolTiersFor("claude-haiku-4-5"), ["read"]);
  assert.deepEqual(M.toolTiersFor("claude-sonnet-4-6"), ["read"]);
  for (const tier of ["read", "write", "structural", "export"]) {
    assert.ok(M.isToolTierQualified("claude-opus-4-8", tier), `opus should have ${tier}`);
  }
  assert.equal(M.isToolTierQualified("claude-haiku-4-5", "structural"), false);
  assert.equal(M.isToolTierQualified("claude-sonnet-4-6", "structural"), false);
  // Unknown model → most conservative tier.
  assert.deepEqual(M.toolTiersFor("claude-nonexistent-9"), ["read"]);
});

test("tool tiers: deriveToolTiers grants structural iff qualified for a structural category", async () => {
  const M = await loadMatrixMod();
  const readOnly = M.deriveToolTiers({ "no-thrash": { qualified: true }, "data-integrity": { qualified: false } });
  assert.deepEqual(readOnly, ["read"]);
  const full = M.deriveToolTiers({ "correctness": { qualified: true } });
  assert.deepEqual(full, ["read", "write", "structural", "export"]);
});

// ─── eval-case category contract (feeds the regenerator) ────────────

test("eval cases: all 29 declare a valid category the regenerator can group by", async () => {
  const M = await loadMatrixMod();
  const CASES_DIR = path.resolve(__dirname, "..", "eval", "cases");
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith(".cjs")).sort();
  assert.equal(files.length, 29);
  const valid = new Set(M.CATEGORIES);
  for (const f of files) {
    const mod = require(path.join(CASES_DIR, f));
    assert.ok(typeof mod.category === "string" && mod.category, `${f}: missing string category`);
    assert.ok(valid.has(mod.category), `${f}: category "${mod.category}" not in CATEGORIES`);
  }
});

// ─── tool promotion: bundle_find_references ─────────────────────────

test("promotion: bundle_find_references frozen name appended (append-only, frozen)", async () => {
  const { BUNDLE_TOOL_NAME, BUNDLE_TOOL_NAMES } = await loadNames();
  assert.equal(BUNDLE_TOOL_NAME.FIND_REFERENCES, "mcp__avni-bundle__bundle_find_references");
  // Phase 4 appended bundle_review / bundle_scrub / spec_review (CRL edit-loop
  // wiring) after find_references — 10 → 13. find_references stays at index 9.
  assert.equal(BUNDLE_TOOL_NAMES.length, 13);
  assert.equal(BUNDLE_TOOL_NAMES[9], "mcp__avni-bundle__bundle_find_references");
  // The original five remain first + unchanged.
  assert.equal(BUNDLE_TOOL_NAMES[0], "mcp__avni-bundle__bundle_validator_run");
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAME));
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAMES));
});

test("promotion: createBundleMcpServer registers bundle_find_references alongside the rest", async () => {
  const { createBundleMcpServer } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-mcp-"));
  const server = createBundleMcpServer(dir);
  const names = Object.keys(server?.instance?._registeredTools || {});
  assert.ok(names.includes("bundle_find_references"), `saw: ${names.join(", ")}`);
  // The story #12 tools are still there (append-only, nothing removed).
  for (const n of ["bundle_validator_run", "bundle_read_srs", "bundle_generate_baseline"]) {
    assert.ok(names.includes(n), `${n} missing; saw ${names.join(", ")}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("promotion: findReferencesOnDir finds all references by uuid and by name", async () => {
  const { findReferencesOnDir } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-refs-"));
  const CU = "11111111-1111-4111-8111-111111111111";
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([
    { name: "Gender", uuid: CU, dataType: "Coded" },
  ]));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, `forms/Reg_form.json`), JSON.stringify({
    name: "Reg", formElementGroups: [{
      formElements: [{ name: "Gender", concept: { name: "Gender", uuid: CU, dataType: "Coded" } }],
    }],
    // UUID embedded inside a rule string must also be found.
    decisionRule: `({params}) => { return "${CU}"; }`,
  }));

  const byUuid = findReferencesOnDir(dir, { uuid: CU });
  assert.equal(byUuid.ok, true);
  assert.ok(byUuid.totalReferences >= 3, `expected ≥3 refs, got ${byUuid.totalReferences}`);
  assert.ok(byUuid.byFile["concepts.json"], "concept def must be found");
  assert.ok(byUuid.byFile["forms/Reg_form.json"], "form usage must be found");
  assert.ok(byUuid.references.some((r) => r.kind === "uuid-field-exact"), "must flag the exact uuid field");

  const byName = findReferencesOnDir(dir, { name: "Gender" });
  assert.equal(byName.ok, true);
  assert.ok(byName.references.some((r) => r.kind === "name-field-exact"), "must flag exact name-field matches");

  // No target → actionable error, never throws.
  const bad = findReferencesOnDir(dir, {});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /uuid.*name/);

  fs.rmSync(dir, { recursive: true, force: true });
});
