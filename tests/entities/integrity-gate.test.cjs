// FIX 1 — THE INTEGRITY GATE.
//
// Before this fix `runBundleIntegrityCheck` had ZERO callers on the commit /
// export path, so FE_CONCEPT_NOT_OBJECT (Durga) + ALT_INVALID_NAME (Astitva)
// were tool+prose, not gates. This suite proves the two halves of the fix:
//
//   (a) ITERATION-FRIENDLY surfacing — integrity severity:error findings are
//       folded into BOTH the stored per-turn validation result
//       (commitWorkspaceChanges) AND the injected per-turn prompt
//       (currentValidatorStateText), so the agent sees them every turn exactly
//       like validator errors and iterates to fix them. It does NOT hard-revert.
//
//   (b) HARD SHIP GATE — bundle_export_to_path (exportBundleToPath) runs the
//       integrity check BEFORE zipping and REFUSES (isError) on any severity:
//       error finding. A clean bundle still exports fine.
//
// Synthetic fixtures only (CLAUDE.md §1) — no real org data.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// Isolate sessions on disk BEFORE importing sessions.js (it reads
// SDK_SESSIONS_DIR at module load). Cache-busted dynamic import re-reads it.
const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "integ-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadServer() {
  return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now());
}
async function loadSessions() {
  return import("../../src/sessions.js?t=" + Date.now());
}

// Build a bundle dir from the minimal (validator+integrity clean) skeleton, then
// apply `mutate(files)` to introduce violations before writing to disk.
async function buildBundle(mutate) {
  const { buildMinimalSkeleton } = await loadServer();
  const files = buildMinimalSkeleton();
  if (mutate) mutate(files);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integ-bundle-"));
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  return dir;
}

// The full dirty mutation the task calls for: a bare-string concept, a null
// concept, an object-without-uuid concept, and an addressLevelType "Zone > Block".
function makeDirty(files) {
  for (const [rel, val] of Object.entries(files)) {
    if (rel.startsWith("forms/")) {
      const feg = val.formElementGroups[0];
      feg.formElements[0].concept = feg.formElements[0].concept.uuid; // bare UUID string (Durga)
      feg.formElements.push({ name: "null-el", uuid: crypto.randomUUID(), concept: null, displayOrder: 2, type: "SingleSelect" });
      feg.formElements.push({ name: "nouuid-el", uuid: crypto.randomUUID(), concept: { name: "X", dataType: "Text" }, displayOrder: 3, type: "SingleSelect" });
    }
    if (rel === "addressLevelTypes.json") {
      val.push({ uuid: crypto.randomUUID(), name: "Zone > Block", level: 2, isRegistrationLocation: false }); // ALT_INVALID_NAME (Astitva)
    }
  }
}

// The validator-invisible subset: only a bare-string concept + "Zone > Block".
// Proves the "validator shows 0, agent thinks done" hole is what integrity closes.
function makeValidatorCleanButIntegrityDirty(files) {
  for (const [rel, val] of Object.entries(files)) {
    if (rel.startsWith("forms/")) val.formElementGroups[0].formElements[0].concept = val.formElementGroups[0].formElements[0].concept.uuid;
    if (rel === "addressLevelTypes.json") val.push({ uuid: crypto.randomUUID(), name: "Zone > Block", level: 2, isRegistrationLocation: false });
  }
}

// ─── (b) HARD SHIP GATE: exportBundleToPath ──────────────────────────

test("export gate: REFUSES a dirty bundle (isError names the integrity codes)", async () => {
  const { exportBundleToPath } = await loadServer();
  const dir = await buildBundle(makeDirty);
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "integ-exports-"));
  const prev = process.env.SDK_EXPORT_DIR;
  process.env.SDK_EXPORT_DIR = exportsDir;
  try {
    const res = await exportBundleToPath(dir, path.join(exportsDir, "out.zip"));
    assert.equal(res.isError, true, "a bundle with integrity errors must be REFUSED");
    const text = res.content[0].text;
    assert.match(text, /REFUSING TO EXPORT/);
    assert.match(text, /FE_CONCEPT_NOT_OBJECT/);
    assert.match(text, /ALT_INVALID_NAME/);
    // The refusal must NOT have written a zip — never ship a dirty bundle.
    assert.equal(fs.existsSync(path.join(exportsDir, "out.zip")), false, "no zip may be written on refusal");
  } finally {
    if (prev === undefined) delete process.env.SDK_EXPORT_DIR; else process.env.SDK_EXPORT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(exportsDir, { recursive: true, force: true });
  }
});

test("export gate: a CLEAN bundle still exports fine", async () => {
  const { exportBundleToPath } = await loadServer();
  const dir = await buildBundle(null); // pristine skeleton — validator+integrity clean
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "integ-exports-"));
  const prev = process.env.SDK_EXPORT_DIR;
  process.env.SDK_EXPORT_DIR = exportsDir;
  try {
    const dest = path.join(exportsDir, "clean.zip");
    const res = await exportBundleToPath(dir, dest);
    assert.notEqual(res.isError, true, `clean bundle must export; got: ${res.content[0].text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.zipPath, dest);
    assert.equal(fs.existsSync(dest), true, "a zip must actually be written for a clean bundle");
    assert.ok(payload.bytes > 0, "the written zip is non-empty");
  } finally {
    if (prev === undefined) delete process.env.SDK_EXPORT_DIR; else process.env.SDK_EXPORT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(exportsDir, { recursive: true, force: true });
  }
});

// ─── (a) ITERATION-FRIENDLY surfacing: stored + injected state ───────

test("integrity errors are FOLDED into the stored per-turn validation (commitWorkspaceChanges)", async () => {
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "author", org: "IntegTest", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);

  // Author the dirty bundle into the session's bundle dir.
  const files = (await loadServer()).buildMinimalSkeleton();
  makeDirty(files);
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }

  const res = await sessions.commitWorkspaceChanges(created.sessionId, "author dirty bundle");
  // The stored validation folds integrity → NOT valid, and carries labeled detail.
  assert.equal(res.validation.valid, false, "folded validation must be invalid when integrity has errors");
  assert.ok(res.validation.integrity, "the stored validation carries a labeled integrity sub-object");
  assert.equal(res.validation.integrity.ok, false);
  const codes = res.validation.integrity.findings.map((f) => f.code);
  assert.ok(codes.includes("FE_CONCEPT_NOT_OBJECT"), `expected FE_CONCEPT_NOT_OBJECT; got ${codes.join(",")}`);
  assert.ok(codes.includes("ALT_INVALID_NAME"), `expected ALT_INVALID_NAME; got ${codes.join(",")}`);
  assert.equal(res.validation.integrity.counts.FE_CONCEPT_NOT_OBJECT, 3, "three flattened/invalid concepts");
  assert.equal(res.validation.integrity.counts.ALT_INVALID_NAME, 1);

  sessions.deleteSession(created.sessionId);
});

test("integrity errors are INJECTED into every turn's prompt (currentValidatorStateText)", async () => {
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "author", org: "IntegTest", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);

  const files = (await loadServer()).buildMinimalSkeleton();
  makeDirty(files);
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  await sessions.commitWorkspaceChanges(created.sessionId, "author dirty bundle");

  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  assert.match(text, /INTEGRITY/, "the injected state must have a labeled INTEGRITY section");
  assert.match(text, /FE_CONCEPT_NOT_OBJECT/);
  assert.match(text, /ALT_INVALID_NAME/);
  // Validator + integrity are kept clearly labeled (distinct sources).
  assert.match(text, /VALIDATOR/);

  sessions.deleteSession(created.sessionId);
});

test("closes the hole: validator shows 0 errors but integrity is dirty → folded state is NOT clean", async () => {
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "author", org: "IntegTest", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);

  const files = (await loadServer()).buildMinimalSkeleton();
  makeValidatorCleanButIntegrityDirty(files); // bare-string concept + "Zone > Block" only
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  const res = await sessions.commitWorkspaceChanges(created.sessionId, "validator-clean but integrity-dirty");

  // The validator half is clean (0 errors) — that's exactly the trap — but the
  // FOLDED result is invalid because integrity caught it.
  assert.equal(res.validation.integrity.ok, false, "integrity must catch what the validator misses");
  assert.equal(res.validation.valid, false, "folded validation must be invalid despite a green validator");

  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  assert.doesNotMatch(text, /✓ bundle is clean/, "must NOT report clean while integrity is dirty");
  assert.match(text, /FE_CONCEPT_NOT_OBJECT/);
  assert.match(text, /ALT_INVALID_NAME/);

  sessions.deleteSession(created.sessionId);
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
