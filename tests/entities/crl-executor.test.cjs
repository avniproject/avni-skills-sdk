"use strict";
// CI-safe (NO-LLM, no key) tests for src/crl/executor.js — the CRL's
// guardrailed, deterministic apply/revert pass. Findings are fed directly
// (bypassing aiJudge), so the executor's hard guardrails are exercised purely
// deterministically: never-prune-referenced, revert-on-regression via an
// in-memory pre-change snapshot (IC-5, NOT git checkout), below-threshold /
// flag-only skips. Bridges CJS→ESM via a cached dynamic import.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const EXEC = path.resolve(__dirname, "..", "..", "src", "crl", "executor.js");
async function loadExecutor() { return await import(pathToFileURL(EXEC).href + "?t=" + Date.now()); }

function tmpBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-exec-"));
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
const C_PARENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const C_CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// A doc scoped to the ONE integrity rule that reds on a MISSING_REQUIRED_REF —
// authored in the REAL P1 shape (tier/source/codes), so the checker filters +
// buckets it exactly as it does the committed compliance-doc.yaml.
function integrityDoc() {
  return { version: 1, rules: [
    { id: "fk-req", tier: "deterministic", severity: "error", source: "bundle-integrity", codes: ["MISSING_REQUIRED_REF"] },
  ] };
}

// Age is used by a form; Junk is a genuine orphan (referenced by nothing).
function baseBundle() {
  return {
    "concepts.json": [
      { name: "Age", uuid: C_USED, dataType: "Numeric" },
      { name: "JunkConceptNobodyUses", uuid: C_ORPHAN, dataType: "Text" },
    ],
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
    "programs.json": [], "encounterTypes.json": [], "formMappings.json": [],
    "forms/Registration_f1.json": {
      name: "Registration", uuid: "f1", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: { name: "Age", uuid: C_USED, dataType: "Numeric" } }] }],
    },
  };
}

// Parent is a Coded concept whose answer REQUIRES Child (a required FK edge);
// pruning Child creates a MISSING_REQUIRED_REF.
function codedRefBundle() {
  return {
    "concepts.json": [
      { name: "Parent", uuid: C_PARENT, dataType: "Coded", answers: [{ uuid: C_CHILD }] },
      { name: "Child", uuid: C_CHILD, dataType: "NA" },
    ],
    "subjectTypes.json": [{ name: "Individual", uuid: "st-1" }],
    "programs.json": [], "encounterTypes.json": [], "formMappings.json": [],
  };
}

function pruneFinding(target, extra = {}) {
  return { ruleId: "orphan-stray-concept", target, verdict: "orphan", action: "prune-candidate", confidence: 0.95, rationale: "unused", ...extra };
}

// ─── guardrail 3: confidence / action gate ───
test("executor: a DetFinding (no action, no confidence) is skipped flag-only, never applied", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const det = { ruleId: "fk-req", code: "DANGLING_REF", severity: "warning", file: "x", message: "y" };
  const { applied, skipped } = await executor(dir, [det], { doc: integrityDoc() });
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, "flag-only");
  cleanup(dir);
});

test("executor: a flag-only (advisory) action is skipped flag-only", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_ORPHAN, name: "JunkConceptNobodyUses" }, { action: "flag-only" });
  const { applied, skipped } = await executor(dir, [f], { doc: integrityDoc() });
  assert.equal(applied.length, 0);
  assert.equal(skipped[0].reason, "flag-only");
  cleanup(dir);
});

test("executor: a below-threshold prune-candidate is skipped below-threshold, entity untouched", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_ORPHAN, name: "JunkConceptNobodyUses" }, { confidence: 0.5 });
  const { applied, skipped } = await executor(dir, [f], { doc: integrityDoc() });
  assert.equal(applied.length, 0);
  assert.equal(skipped[0].reason, "below-threshold");
  assert.ok(readJson(dir, "concepts.json").some((c) => c.uuid === C_ORPHAN), "the concept must survive a below-threshold finding");
  cleanup(dir);
});

// ─── guardrail 1: never touch a referenced/required entity ───
test("executor: NEVER prunes a referenced entity — a concept another concept's answer requires is skipped referenced", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(codedRefBundle());
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_CHILD, name: "Child" });
  const { applied, skipped } = await executor(dir, [f], { doc: integrityDoc() });
  assert.equal(applied.length, 0);
  assert.equal(skipped[0].reason, "referenced");
  assert.ok(readJson(dir, "concepts.json").some((c) => c.uuid === C_CHILD), "a referenced concept must never be pruned");
  cleanup(dir);
});

// ─── guardrail 2: revert-on-regression via in-memory snapshot (IC-5) ───
test("executor: reverts a prune that regresses the deterministic checker — restores the file from the in-memory pre-change snapshot", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(codedRefBundle());
  const before = readJson(dir, "concepts.json");
  // referencedGuard OFF so the prune is ATTEMPTED; guardrail 2 must then catch
  // the MISSING_REQUIRED_REF regression and revert the concepts.json bytes.
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_CHILD, name: "Child" });
  const { applied, reverted } = await executor(dir, [f], { doc: integrityDoc(), referencedGuard: false });
  assert.equal(applied.length, 0);
  assert.equal(reverted.length, 1);
  assert.equal(reverted[0].reason, "regression");
  assert.deepEqual(readJson(dir, "concepts.json"), before, "the pre-change bytes must be restored exactly");
  cleanup(dir);
});

// ─── happy path: a genuine orphan is pruned ───
test("executor: prunes a genuine orphan concept (no external references, no regression)", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_ORPHAN, name: "JunkConceptNobodyUses" });
  const { applied } = await executor(dir, [f], { doc: integrityDoc() });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].op, "prune");
  const remaining = readJson(dir, "concepts.json");
  assert.ok(!remaining.some((c) => c.uuid === C_ORPHAN), "the orphan must be removed");
  assert.ok(remaining.some((c) => c.uuid === C_USED), "the used concept must survive");
  cleanup(dir);
});

// ─── dryRun: reports the prune without mutating disk ───
test("executor: dryRun reports the applied prune but leaves the file on disk untouched", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_ORPHAN, name: "JunkConceptNobodyUses" });
  const { applied } = await executor(dir, [f], { doc: integrityDoc(), dryRun: true });
  assert.equal(applied.length, 1);
  assert.ok(readJson(dir, "concepts.json").some((c) => c.uuid === C_ORPHAN), "dryRun must not mutate the bundle");
  cleanup(dir);
});

// ─── merged ComplianceReport (2.5): per-rule-id merge of deterministic status
// + AI-judged actions, plus a top-level ok flag. Keyed on the ACTUAL P1 checker
// shape (byRule/green/red), reconciled from the master's perRule[] wording. ───
test("executor: returns a merged report — deterministic per-rule status + the AI-judged action, plus a top-level ok flag", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  const f = pruneFinding({ file: "concepts.json", entityKind: "concept", uuid: C_ORPHAN, name: "JunkConceptNobodyUses" });
  const { report } = await executor(dir, [f], { doc: integrityDoc() });
  assert.equal(typeof report.ok, "boolean");
  assert.ok(Array.isArray(report.rules));
  const detRules = report.rules.filter((r) => r.tag === "deterministic");
  assert.ok(detRules.length > 0, "the report must include the deterministic doc's per-rule status, not just executor actions");
  const aiRules = report.rules.filter((r) => r.tag === "ai-judged");
  assert.equal(aiRules.length, 1, "the applied finding must also appear in the merged report");
  assert.equal(aiRules[0].status, "resolved");
  cleanup(dir);
});

// ─── form-file resolution (ai-judge projection carries no file path) ───
test("executor: form prune resolves the real forms/*_<uuid>.json by uuid when the finding's file path is a wrong guess", async () => {
  const { executor } = await loadExecutor();
  const dir = tmpBundle(baseBundle());
  // The ai-judge cannot supply a form's on-disk path, so it guesses
  // "forms/Registration.json" — but the real file is "forms/Registration_f1.json".
  // Pre-fix this skipped as "referenced" (own record miscounted); it must prune.
  const f = pruneFinding(
    { entityKind: "form", file: "forms/Registration.json", uuid: "f1", name: "Registration" },
    { ruleId: "prose-as-entity-name", verdict: "stray" },
  );
  const { applied, skipped } = await executor(dir, [f], { doc: integrityDoc() });
  assert.equal(applied.length, 1, `form should be pruned via uuid resolution; skipped=${JSON.stringify(skipped)}`);
  assert.equal(applied[0].op, "prune");
  assert.equal(fs.existsSync(path.join(dir, "forms/Registration_f1.json")), false, "real form file removed");
  cleanup(dir);
});
