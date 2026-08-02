// AUTOCREATED_ENTITY — surface generator-inferred entities as an integrity warning.
//
// WHY THIS EXISTS
//
// The brain generator mints an entity when a name it reads somewhere (a program's
// "Target Subject Type", an encounter row's subject reference) fails to match any
// entity DECLARED in the modelling workbook. `ensureSubjectTypeExists` stamps the
// result `_autoCreated: true` and moves on silently.
//
// That silence is the problem. The existing integrity checks verify REFERENTIAL
// INTEGRITY — does this UUID resolve? A phantom entity passes every one of them,
// because the formMappings pointing at it resolve perfectly well. Nothing asks the
// prior question: SHOULD this entity exist?
//
// Observed twice on real SRSes, both times invisible until a human read
// subjectTypes.json by hand:
//   • a modelling sheet naming a program's target with a qualifier
//     ("<Subject> (female)") minted a second subject type, and the entire program
//     — enrolment, encounters, exit, cancellations — hung off a subject that no
//     registration form ever creates. Nobody could be enrolled.
//   • program names leaking into the subject-type column minted one phantom
//     subject type per program.
//
// In both cases the validator and the FK integrity check reported ZERO errors.
// An agent driving toward green gates has no reason to look, and won't.
//
// SEVERITY IS DELIBERATELY "warning", NOT "error":
// auto-creation is sometimes legitimate (a genuinely undeclared subject type that
// an encounter row legitimately references). This finding is a SIGNAL to verify
// against the SRS, not a verdict — so it must NOT block export. Making it an error
// would wedge bundles that are actually fine.
//
// Synthetic fixtures only (CLAUDE.md §1) — no real org data.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "autocreated-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadServer() {
  return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now());
}

async function buildBundle(mutate) {
  const { buildMinimalSkeleton } = await loadServer();
  const files = buildMinimalSkeleton();
  if (mutate) mutate(files);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autocreated-bundle-"));
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  return dir;
}

function findingsOf(res) {
  return (res && res.findings) || [];
}
function autoFindings(res) {
  return findingsOf(res).filter((f) => f.code === "AUTOCREATED_ENTITY");
}

// ─── the core hole this closes ───────────────────────────────────────

test("AUTOCREATED_ENTITY: flags a phantom subject type that every FK check passes", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  // A phantom subject type, referenced by a formMapping so that every dangling-ref
  // check resolves cleanly. This is precisely the shape that shipped undetected.
  const phantomUuid = crypto.randomUUID();
  const dir = await buildBundle((files) => {
    files["subjectTypes.json"].push({
      name: "Member (adult)",
      uuid: phantomUuid,
      type: "Person",
      active: true,
      voided: false,
      _autoCreated: true,
    });
    for (const m of files["formMappings.json"] || []) m.subjectTypeUUID = phantomUuid;
  });

  const res = runBundleIntegrityCheck(dir);
  const auto = autoFindings(res);

  assert.equal(auto.length, 1, "the phantom subject type must produce exactly one finding");
  assert.equal(auto[0].severity, "warning", "must be a warning — auto-creation is sometimes legitimate");
  assert.match(auto[0].locator, /Member \(adult\)/, "locator must name the entity so it can be found");
  assert.match(auto[0].file, /subjectTypes\.json/, "finding must point at the file holding the entity");

  // The whole point: no OTHER check sees it.
  const refIssues = findingsOf(res).filter(
    (f) => f.code === "MISSING_REQUIRED_REF" || f.code === "DANGLING_REF",
  );
  assert.equal(refIssues.length, 0, "the phantom resolves cleanly — FK checks are blind to it by design");
});

test("AUTOCREATED_ENTITY: silent on a bundle with no inferred entities", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = await buildBundle();
  assert.equal(autoFindings(runBundleIntegrityCheck(dir)).length, 0, "a clean skeleton must produce no finding");
});

test("AUTOCREATED_ENTITY: _autoCreated:false and absent are both treated as authored", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = await buildBundle((files) => {
    files["subjectTypes.json"].push({
      name: "Declared Member", uuid: crypto.randomUUID(), type: "Person",
      active: true, voided: false, _autoCreated: false,
    });
  });
  assert.equal(autoFindings(runBundleIntegrityCheck(dir)).length, 0, "only a truthy _autoCreated counts");
});

test("AUTOCREATED_ENTITY: covers any entity collection, not just subjectTypes", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = await buildBundle((files) => {
    files["encounterTypes.json"] = files["encounterTypes.json"] || [];
    files["encounterTypes.json"].push({
      name: "Inferred Visit", uuid: crypto.randomUUID(), voided: false, _autoCreated: true,
    });
    files["programs.json"] = files["programs.json"] || [];
    files["programs.json"].push({
      name: "Inferred Program", uuid: crypto.randomUUID(), voided: false, _autoCreated: true,
    });
  });
  const auto = autoFindings(runBundleIntegrityCheck(dir));
  assert.equal(auto.length, 2, "the scan must not be hardcoded to subjectTypes");
  const files = auto.map((f) => f.file).sort();
  assert.deepEqual(files, ["encounterTypes.json", "programs.json"]);
});

// ─── must NOT become a ship gate ─────────────────────────────────────

test("AUTOCREATED_ENTITY: warning does not set ok=false", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = await buildBundle((files) => {
    files["subjectTypes.json"].push({
      name: "Member (adult)", uuid: crypto.randomUUID(), type: "Person",
      active: true, voided: false, _autoCreated: true,
    });
  });
  const res = runBundleIntegrityCheck(dir);
  assert.equal(autoFindings(res).length, 1);
  assert.equal(res.ok, true, "a warning-only bundle must remain ok — this is a signal, not a verdict");
});

test("AUTOCREATED_ENTITY: export still succeeds with only this warning", async () => {
  const { exportBundleToPath } = await loadServer();
  const dir = await buildBundle((files) => {
    files["subjectTypes.json"].push({
      name: "Member (adult)", uuid: crypto.randomUUID(), type: "Person",
      active: true, voided: false, _autoCreated: true,
    });
  });
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "autocreated-exports-"));
  const prev = process.env.SDK_EXPORT_DIR;
  process.env.SDK_EXPORT_DIR = exportsDir;
  try {
    const res = await exportBundleToPath(dir, path.join(exportsDir, "out.zip"));
    assert.notEqual(res.isError, true, "an AUTOCREATED_ENTITY warning must never block the ship gate");
  } finally {
    if (prev === undefined) delete process.env.SDK_EXPORT_DIR;
    else process.env.SDK_EXPORT_DIR = prev;
  }
});
