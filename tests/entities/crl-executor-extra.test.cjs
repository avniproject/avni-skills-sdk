"use strict";
// CI-safe (NO-LLM, no key) tests for src/crl/executor.js EXTRA behaviours:
//   • form + formMapping unit prune (MAJ-6) — a stray form is pruned together
//     with its own formMapping(s); the referenced-guard excludes the form's
//     OWN mapping (else no real form is ever prunable).
//   • case-insensitive entityKind ("Concept" from a live model).
//   • unsupported entityKind fails LOUD.
//   • confident fix-candidate apply + revert-on-regression (O-3).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const EXEC = path.resolve(__dirname, "..", "..", "src", "crl", "executor.js");
async function loadExecutor() { return await import(pathToFileURL(EXEC).href + "?t=" + Date.now()); }

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-execx-"));
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function readJson(dir, rel) { return JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")); }

const C_USED = "22222222-2222-2222-2222-222222222222";
const C_ORPHAN = "11111111-1111-1111-1111-111111111111";
const C_FIX = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function integrityDoc() {
  return { version: 1, rules: [
    { id: "fk-req", tier: "deterministic", severity: "error", source: "bundle-integrity", codes: ["MISSING_REQUIRED_REF"] },
  ] };
}

// A stray form that HAS a formMapping (the case MAJ-6 exists for). Nothing
// else references it, so form+mapping should prune as a unit.
function bundleWithStrayForm() {
  return {
    "concepts.json": [{ name: "Age", uuid: C_USED, dataType: "Numeric" }],
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
    "programs.json": [], "encounterTypes.json": [],
    "formMappings.json": [{ uuid: "m-stray", formUUID: "stray-f", subjectTypeUUID: "st-1", formType: "IndividualProfile" }],
    "forms/Stray_stray-f.json": { name: "Stray", uuid: "stray-f", formType: "IndividualProfile", formElementGroups: [] },
  };
}

function baseBundle() {
  return {
    "concepts.json": [
      { name: "Age", uuid: C_USED, dataType: "Numeric" },
      { name: "JunkConceptNobodyUses", uuid: C_ORPHAN, dataType: "Text" },
    ],
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
    "programs.json": [], "encounterTypes.json": [], "formMappings.json": [],
  };
}

// An orphan concept (referenced by nothing) that we FIX in place.
function fixableOrphanBundle() {
  return {
    "concepts.json": [
      { name: "Age", uuid: C_USED, dataType: "Numeric" },
      { name: "Tmp", uuid: C_FIX, dataType: "Text" },
    ],
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
    "programs.json": [], "encounterTypes.json": [], "formMappings.json": [],
  };
}

// ─── MAJ-6: form + its formMapping prune as one unit ───
test("executor: prunes a stray form AND its own formMapping as a unit; the own-mapping is excluded from the referenced-guard, no dangling mapping remains", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(bundleWithStrayForm());
  const finding = {
    ruleId: "prose-should-be-form",
    target: { file: "forms/Stray_stray-f.json", entityKind: "form", name: "Stray", uuid: "stray-f" },
    verdict: "stray", action: "prune-candidate", confidence: 0.95, rationale: "stray prose form",
  };
  const { applied, skipped } = await executor(dir, [finding], { doc: integrityDoc() });
  assert.equal(applied.length, 1, "the stray form must be prunable even though its own mapping references it");
  assert.deepEqual(skipped, []);
  assert.ok(!fs.existsSync(path.join(dir, "forms/Stray_stray-f.json")), "the form file is removed");
  const mappings = readJson(dir, "formMappings.json");
  assert.ok(!mappings.some((m) => m.formUUID === "stray-f"), "the form's own mapping is removed too — no dangling mapping");
  assert.ok(applied[0].filesTouched.includes("formMappings.json"), "the report records the mapping file was touched");
  cleanup(dir);
});

// ─── case-insensitive entityKind ───
test("executor: a capitalised entityKind (\"Concept\", as a live model returns) is still recognised as a concept prune", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const finding = {
    ruleId: "orphan-stray-concept",
    target: { file: "concepts.json", entityKind: "Concept", name: "JunkConceptNobodyUses", uuid: C_ORPHAN },
    verdict: "orphan", action: "prune-candidate", confidence: 0.95, rationale: "unused",
  };
  const { applied } = await executor(dir, [finding], { doc: integrityDoc() });
  assert.equal(applied.length, 1, "a capitalised entityKind must still be recognised as a concept prune");
  assert.ok(!readJson(dir, "concepts.json").some((c) => c.uuid === C_ORPHAN));
  cleanup(dir);
});

// ─── fail loud on an unsupported entityKind ───
test("executor: throws a clear error for an unsupported entityKind (fails loud, never silently mis-skips)", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const finding = {
    ruleId: "ai-orphan-program",
    target: { file: "programs.json", entityKind: "program", name: "Ghost Program", uuid: "p1" },
    verdict: "orphan", action: "prune-candidate", confidence: 0.95, rationale: "unused",
  };
  await assert.rejects(() => executor(dir, [finding], { doc: integrityDoc() }), /prune not supported for entityKind "program"/);
  cleanup(dir);
});

// ─── O-3: confident fix-candidate is APPLIED (not flag-only) ───
test("executor: applies a confident fix-candidate — writes the replacement, op:\"fix\", under the same guardrails", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(fixableOrphanBundle());
  const finding = {
    ruleId: "naming-incoherent",
    target: { file: "concepts.json", entityKind: "concept", name: "Tmp", uuid: C_FIX },
    verdict: "incoherent-name", action: "fix-candidate", confidence: 0.95, fixConfidence: 0.95,
    replacement: { name: "Temperature", uuid: C_FIX, dataType: "Numeric" },
    rationale: "incoherent placeholder name",
  };
  const { applied } = await executor(dir, [finding], { doc: integrityDoc() });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].op, "fix");
  const concepts = readJson(dir, "concepts.json");
  const fixed = concepts.find((c) => c.uuid === C_FIX);
  assert.equal(fixed.name, "Temperature", "the replacement value must be written");
  assert.equal(fixed.dataType, "Numeric");
  cleanup(dir);
});

// ─── O-3: a fix that regresses the checker is REVERTED from the in-memory snapshot ───
test("executor: reverts a fix-candidate that regresses the deterministic checker — restores the pre-change bytes", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(fixableOrphanBundle());
  const before = readJson(dir, "concepts.json");
  const finding = {
    ruleId: "naming-incoherent",
    target: { file: "concepts.json", entityKind: "concept", name: "Tmp", uuid: C_FIX },
    action: "fix-candidate", confidence: 0.95, fixConfidence: 0.95,
    // this replacement turns Tmp into a Coded concept whose required answer FK
    // dangles → MISSING_REQUIRED_REF regression → must revert.
    replacement: { name: "Tmp", uuid: C_FIX, dataType: "Coded", answers: [{ uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc" }] },
    rationale: "bad fix",
  };
  const { applied, reverted } = await executor(dir, [finding], { doc: integrityDoc() });
  assert.equal(applied.length, 0);
  assert.equal(reverted.length, 1);
  assert.equal(reverted[0].reason, "regression");
  assert.deepEqual(readJson(dir, "concepts.json"), before, "the pre-change bytes must be restored exactly");
  cleanup(dir);
});

// ─── O-3: a fix below the (higher) fixThreshold is NOT applied ───
test("executor: a fix-candidate below fixThreshold is skipped below-threshold (flagged for a human), not applied", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(fixableOrphanBundle());
  const finding = {
    ruleId: "naming-incoherent",
    target: { file: "concepts.json", entityKind: "concept", name: "Tmp", uuid: C_FIX },
    action: "fix-candidate", confidence: 0.8, fixConfidence: 0.8,
    replacement: { name: "Temperature", uuid: C_FIX, dataType: "Numeric" },
    rationale: "low-confidence fix",
  };
  const { applied, skipped } = await executor(dir, [finding], { doc: integrityDoc(), fixThreshold: 0.9 });
  assert.equal(applied.length, 0);
  assert.equal(skipped[0].reason, "below-threshold");
  assert.equal(readJson(dir, "concepts.json").find((c) => c.uuid === C_FIX).name, "Tmp", "the concept is left untouched for a human");
  cleanup(dir);
});
