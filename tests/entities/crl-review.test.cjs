"use strict";
// Tests for src/crl/review.js — the assembled three-pass CRL API
// (deterministic → ai-judged → executor). The no-key tests are CI-safe; the
// live round-trip self-skips unless ANTHROPIC_API_KEY is set (budget-capped).
// Bridges CJS→ESM via a cached dynamic import.
//
// All fixture docs are authored in the ACTUAL P1 yaml shape: deterministic
// rules carry tier/source/codes (NOT the master's tag/delegate); ai-judged
// rules carry tier/class/action/inputs (NOT a judge{} block). This is the
// shape the committed compliance-doc.yaml + the P1 loader/checker consume.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REVIEW = path.resolve(__dirname, "..", "..", "src", "crl", "review.js");
async function loadReview() { return await import(pathToFileURL(REVIEW).href + "?t=" + Date.now()); }

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-review-"));
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

const C_ORPHAN = "11111111-1111-1111-1111-111111111111";
const C_USED = "22222222-2222-2222-2222-222222222222";

function cleanBundle() {
  return {
    "concepts.json": [
      { name: "Age", uuid: C_USED, dataType: "Numeric" },
      { name: "JunkConceptNobodyUses_DELETE_ME", uuid: C_ORPHAN, dataType: "Text" },
    ],
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
    "programs.json": [], "encounterTypes.json": [], "formMappings.json": [],
    "addressLevelTypes.json": [], "groupRoles.json": [],
    "forms/Registration_f1.json": {
      name: "Registration", uuid: "f1", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: { name: "Age", uuid: C_USED, dataType: "Numeric" } }] }],
    },
  };
}

// A doc with ZERO ai-judged rules — proves the deterministic + orchestration
// wiring without spending. The one deterministic rule reds on a required FK
// break. Authored in the REAL P1 shape (tier/source/codes).
function deterministicOnlyDoc() {
  return { version: 1, rules: [
    { id: "fk-req", tier: "deterministic", severity: "error", source: "bundle-integrity", codes: ["MISSING_REQUIRED_REF", "DANGLING_REF"] },
  ] };
}

// An ai-judged concept-orphan rule in the REAL flat shape (no judge{} block).
function orphanConceptDoc() {
  return { version: 1, rules: [
    { id: "orphan-stray-concept", tier: "ai-judged", class: "stray", severity: "warning",
      action: "prune-candidate", inputs: ["artifact.concepts", "scopingCtx"],
      description: "A concept that no form/rule/answer references and reads as leftover junk is a stray — prune-candidate." },
  ] };
}

test("reviewBundle: inspect mode on a clean bundle with a deterministic-only doc is ok, no executed pass", async () => {
  const { reviewBundle } = await loadReview();
  const dir = tmpBundle(cleanBundle());
  const result = await reviewBundle(dir, { mode: "inspect", doc: deterministicOnlyDoc() });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "inspect");
  assert.equal(result.kind, "bundle");
  assert.equal(result.deterministic.ok, true);
  assert.deepEqual(result.ai, { findings: [], confidence: 1, costUsd: 0 });
  assert.equal(result.report.costUsd, 0);
  assert.equal(result.executed, undefined, "inspect mode never invokes the executor");
  cleanup(dir);
});

test("reviewBundle: inspect mode surfaces a deterministic error (dangling required FK) as ok:false", async () => {
  const { reviewBundle } = await loadReview();
  const bundle = cleanBundle();
  bundle["formMappings.json"] = [{ uuid: "map-1", formType: "IndividualProfile", formUUID: "GHOST-FORM", subjectTypeUUID: "st-1" }];
  const dir = tmpBundle(bundle);
  const result = await reviewBundle(dir, { mode: "inspect", doc: deterministicOnlyDoc() });
  assert.equal(result.deterministic.ok, false);
  assert.equal(result.ok, false);
  cleanup(dir);
});

// ─── CRIT-1: never throw without a key, even when the doc HAS ai-judged rules ───
test("reviewBundle: a doc with ai-judged rules but no ANTHROPIC_API_KEY never throws — clean skip, deterministic pass preserved", async () => {
  const { reviewBundle } = await loadReview();
  const dir = tmpBundle(cleanBundle());
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await reviewBundle(dir, { mode: "inspect", doc: orphanConceptDoc() });
    assert.deepEqual(result.ai, { findings: [], confidence: 1, costUsd: 0 });
    assert.equal(typeof result.deterministic.ok, "boolean", "the deterministic pass must still run and not be discarded");
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  }
  cleanup(dir);
});
