"use strict";

// Live Spec View — Phase 3 (Spec-sync step). Contract §2.3 (syncSpecView).
// Task 1 (below) unit-tests syncSpecView directly (pure filesystem + emit — no
// sessions.js, no git). Task 2 (appended lower) exercises the
// commitWorkspaceChanges wiring (git commit + gate ownership).
//
// Synthesis M9 — hermetic against the AI/cost path even when this file is run
// directly (not just via `npm run test:entities`, which already wires
// SDK_CRL_GATE=off SDK_SPEC_VIEW=off itself). Deleting the key here means
// reviewSpec's AI pass clean-skips (CRIT-1) inside runSpecGateSafely regardless
// of which gate flags are set, protecting BOTH halves of this file.
delete process.env.ANTHROPIC_API_KEY;

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

async function loadSync() { return import("../../src/spec-view/sync.js?t=" + Date.now()); }

test("syncSpecView: first call on a fresh bundle writes both files, reports changed:true for both", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-fresh-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  const result = syncSpecView(dir, { org: "FreshOrg" });

  assert.equal(result.specChanged, true);
  assert.equal(result.identityChanged, true);
  assert.equal(result.specRelPath, "spec.yaml");
  assert.equal(result.identityRelPath, "identity-map.yaml");
  assert.equal(result.error, undefined);

  assert.ok(fs.existsSync(path.join(dir, "spec.yaml")), "spec.yaml must be written to the bundle root");
  assert.ok(fs.existsSync(path.join(dir, "identity-map.yaml")), "identity-map.yaml must be written to the bundle root");
  assert.match(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), /Individual/, "the emitted spec must name the subject type");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a second call with NO bundle change is a true no-op (byte-identical re-emit)", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-noop-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  syncSpecView(dir, { org: "NoOpOrg" });
  const specAfterFirst = fs.readFileSync(path.join(dir, "spec.yaml"), "utf8");
  const identityAfterFirst = fs.readFileSync(path.join(dir, "identity-map.yaml"), "utf8");

  const second = syncSpecView(dir, { org: "NoOpOrg" });
  assert.equal(second.specChanged, false, "re-emitting an UNCHANGED bundle must not report a spec change");
  assert.equal(second.identityChanged, false, "re-emitting an UNCHANGED bundle must not report an identity-map change");
  assert.equal(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), specAfterFirst, "spec.yaml must be byte-identical across a no-op re-emit");
  assert.equal(fs.readFileSync(path.join(dir, "identity-map.yaml"), "utf8"), identityAfterFirst, "identity-map.yaml must be byte-identical across a no-op re-emit");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a real bundle edit between two calls is detected as changed:true", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-change-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");
  syncSpecView(dir, { org: "ChangeOrg" });

  const subjectTypes = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8"));
  subjectTypes.push({ name: "Household", uuid: crypto.randomUUID(), active: true, type: "Household", voided: false });
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes, null, 2));

  const result = syncSpecView(dir, { org: "ChangeOrg" });
  assert.equal(result.specChanged, true, "adding a subject type must change the derived spec");
  assert.match(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), /Household/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a single corrupt bundle file degrades to a THIN emit — swallowed per-file, not a hard error (synthesis M8 — readRichBundleFileMap's per-file JSON.parse is wrapped, contract §2.1)", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-file-corrupt-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), "{ not valid json");
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  const result = syncSpecView(dir, { org: "PartialOrg" });

  assert.equal(result.error, undefined, "a single corrupt file must NOT surface as a top-level sync error — readRichBundleFileMap swallows per-file parse failures");
  assert.equal(result.specChanged, true, "a fresh (even partial/thin) emit is still a real, written change");
  assert.ok(fs.existsSync(path.join(dir, "spec.yaml")), "a thin spec.yaml must still be written despite the corrupt file");
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "spec.yaml"), "utf8"), /Individual/, "the corrupt subjectTypes.json family must be silently omitted (thin emit), not fabricated from stale/partial parse state");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncSpecView: a genuine infra-level failure degrades to {specChanged:false, identityChanged:false, error}, and leaves NO partial file on disk (synthesis M8 — the case per-file swallowing does NOT cover)", async () => {
  const { syncSpecView } = await loadSync();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-infra-broken-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([
    { name: "Individual", uuid: crypto.randomUUID(), active: true, type: "Person", voided: false },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), "[]");

  // Inject a GENUINE infra-level throw distinct from the per-file JSON swallow
  // above. The plan's original suggestion (a broken AVNI_SKILLS_PATH so the
  // brain `entitiesToSpec` require throws) is DEFEATED by the process-level
  // module cache in emit.js/identity-map.js (`_entitiesToSpec`/`_yaml`): once
  // ANY prior test in this process performs a successful emit, the brain is
  // cached and a later broken path no longer re-resolves — verified empirically.
  // Instead, make the `forms` entry a FILE rather than a directory: emitRichSpec
  // calls readRichBundleFileMap FIRST, whose `fs.readdirSync(formsDir)` is NOT
  // inside the per-file try/catch, so it throws ENOTDIR unconditionally,
  // cache-independent and order-independent — reaching syncSpecView's own
  // try/catch exactly as a genuine infra failure would, BEFORE any file write.
  fs.writeFileSync(path.join(dir, "forms"), "not a directory");

  const result = syncSpecView(dir, { org: "InfraBrokenOrg" });

  assert.equal(result.specChanged, false);
  assert.equal(result.identityChanged, false);
  assert.equal(typeof result.error, "string");
  assert.equal(fs.existsSync(path.join(dir, "spec.yaml")), false, "a genuine infra failure must not leave a partial spec.yaml on disk");
  assert.equal(fs.existsSync(path.join(dir, "identity-map.yaml")), false, "a genuine infra failure must not leave a partial identity-map.yaml on disk either");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── Task 2 — commitWorkspaceChanges wiring (git + gate ownership) ───────────
// These drive the LIVE per-turn commit path. Every test below sets
// SDK_CRL_GATE/SDK_SPEC_VIEW EXPLICITLY (saved + restored in `finally`) rather
// than relying on the ambient default — Task 3 wires package.json's
// test/test:entities scripts to SDK_SPEC_VIEW=off (mirroring SDK_CRL_GATE
// already off), so "default on" is not a safe assumption for a test that needs
// the sync to actually run. SDK_CRL_GATE is set off purely to keep these tests
// on the spec-sync path, not the unrelated bundle CRL gate.

const { execFileSync } = require("node:child_process");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "spec-sync-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadSessions() { return import("../../src/sessions.js?t=" + Date.now()); }
async function loadServer() { return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now()); }

function writeSkeleton(bundleDir, files) {
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(bundleDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
}

test("commitWorkspaceChanges: a mutating turn writes+commits spec.yaml + identity-map.yaml as a turn N.spec follow-up commit (SDK_SPEC_VIEW explicitly 'on')", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecSync", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());

  const prevSpecView = process.env.SDK_SPEC_VIEW;
  const prevCrlGate = process.env.SDK_CRL_GATE;
  process.env.SDK_SPEC_VIEW = "on";
  process.env.SDK_CRL_GATE = "off";
  let res;
  try {
    res = await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");
  } finally {
    if (prevSpecView === undefined) delete process.env.SDK_SPEC_VIEW; else process.env.SDK_SPEC_VIEW = prevSpecView;
    if (prevCrlGate === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prevCrlGate;
  }

  assert.ok(fs.existsSync(path.join(bundleDir, "spec.yaml")), "spec.yaml must be written to the bundle root");
  assert.ok(fs.existsSync(path.join(bundleDir, "identity-map.yaml")), "identity-map.yaml must be written to the bundle root");

  assert.ok(res.specSync, "commitWorkspaceChanges must return a specSync field");
  assert.equal(res.specSync.specChanged, true);
  assert.equal(res.specSync.identityChanged, true);
  assert.equal(res.specSync.specRelPath, "spec.yaml");
  assert.equal(res.specSync.identityRelPath, "identity-map.yaml");

  const log = execFileSync("git", ["log", "--pretty=format:%s"], { cwd: bundleDir, encoding: "utf8" }).split("\n");
  assert.ok(log.includes("turn 1.spec: derived spec view"), `expected a turn 1.spec follow-up commit; saw: ${log.join(" | ")}`);
  assert.ok(log.includes("turn 1: author minimal skeleton"), "the agent's own turn commit must still exist, distinct from the .spec follow-up");

  assert.ok(res.specGate, "a spec-sync turn must ALSO carry a specGate result (O-2 gates the DERIVED spec, contract §2.4)");
  assert.ok(res.specGate.review && res.specGate.review.kind === "spec", "specGate must review the SPEC artifact, not the bundle");

  const metaOnDisk = JSON.parse(fs.readFileSync(path.join(SESSIONS_ROOT, created.sessionId, "meta.json"), "utf8"));
  assert.ok(metaOnDisk.specViewAtCurrent, "specViewAtCurrent must be durably persisted to meta.json");
  assert.equal(metaOnDisk.specViewAtCurrent.specChanged, true);

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: SDK_SPEC_VIEW=off skips the spec-sync step entirely — no files written, no .spec commit, specSync.disabled:true", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecSync", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());

  const prevSpecView = process.env.SDK_SPEC_VIEW;
  const prevCrlGate = process.env.SDK_CRL_GATE;
  process.env.SDK_SPEC_VIEW = "off";
  process.env.SDK_CRL_GATE = "off";
  let res;
  try {
    res = await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");
  } finally {
    if (prevSpecView === undefined) delete process.env.SDK_SPEC_VIEW; else process.env.SDK_SPEC_VIEW = prevSpecView;
    if (prevCrlGate === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prevCrlGate;
  }

  assert.equal(res.specSync.disabled, true);
  assert.equal(res.specSync.specChanged, false);
  assert.equal(res.specSync.identityChanged, false);
  assert.equal(res.specGate, undefined, "no derived spec means no specGate either");
  assert.equal(fs.existsSync(path.join(bundleDir, "spec.yaml")), false);
  assert.equal(fs.existsSync(path.join(bundleDir, "identity-map.yaml")), false);

  const log = execFileSync("git", ["log", "--pretty=format:%s"], { cwd: bundleDir, encoding: "utf8" }).split("\n");
  assert.ok(!log.some((s) => s.includes(".spec:")), `no .spec follow-up commit must exist; saw: ${log.join(" | ")}`);

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: the turn N.spec follow-up commit is NOT counted as a new turn — diffTurn/revertToTurn still target only the agent's own turn N: commit (SDK_SPEC_VIEW explicitly 'on')", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecSync", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());

  const prevSpecView = process.env.SDK_SPEC_VIEW;
  const prevCrlGate = process.env.SDK_CRL_GATE;
  process.env.SDK_SPEC_VIEW = "on";
  process.env.SDK_CRL_GATE = "off";
  try {
    await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton"); // turn 1 (+ turn 1.spec)

    const conceptsPath = path.join(bundleDir, "concepts.json");
    const concepts = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
    concepts[0].dataType = "Numeric";
    fs.writeFileSync(conceptsPath, JSON.stringify(concepts, null, 2));

    const res2 = await sessions.commitWorkspaceChanges(created.sessionId, "author edit turn"); // turn 2 (+ turn 2.spec)
    assert.equal(res2.turn, 2, "the .spec follow-up commit must not bump the turn counter a second time");

    const diff2 = sessions.diffTurn(created.sessionId, 2);
    assert.match(diff2, /Numeric/, "diffTurn(2) must show the agent's own concepts.json edit");
    assert.doesNotMatch(diff2, /spec\.yaml/, "diffTurn(2) must isolate the agent's own turn — turn 2.spec is a SEPARATE commit, not folded into turn 2's diff");
    assert.doesNotMatch(diff2, /identity-map\.yaml/, "diffTurn(2) must not show the derived identity-map.yaml either");

    const metaAfterRevert = sessions.revertToTurn(created.sessionId, 2);
    assert.equal(metaAfterRevert.currentTurn, 2, "revertToTurn(2) must land on the agent's own turn 2: commit, unaffected by the .spec suffix");
  } finally {
    if (prevSpecView === undefined) delete process.env.SDK_SPEC_VIEW; else process.env.SDK_SPEC_VIEW = prevSpecView;
    if (prevCrlGate === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prevCrlGate;
  }

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: adding ONE encounter to an existing program produces a single legible spec.yaml diff (design.md/trial.md §4 before/after) (SDK_SPEC_VIEW explicitly 'on')", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "SpecSync", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);

  const prevSpecView = process.env.SDK_SPEC_VIEW;
  const prevCrlGate = process.env.SDK_CRL_GATE;
  process.env.SDK_SPEC_VIEW = "on";
  process.env.SDK_CRL_GATE = "off";
  try {
    // Turn 1: skeleton + a Program ("Maternal") with its enrolment form.
    // Relationships wired via formMappings.json UUIDs — the REAL bundle shape
    // (forms carry NO program/subjectType/encounterType name fields).
    const skeleton = buildMinimalSkeleton();
    const ST = skeleton["subjectTypes.json"][0].uuid;
    const P = crypto.randomUUID(), OP = crypto.randomUUID(), F2 = crypto.randomUUID(), FM2 = crypto.randomUUID();
    writeSkeleton(bundleDir, {
      ...skeleton,
      "programs.json": [{ name: "Maternal", uuid: P, colour: "#96d643", voided: false, active: true, showGrowthChart: false, enrolmentEligibilityCheckRule: "" }],
      "operationalPrograms.json": { operationalPrograms: [{ uuid: OP, program: { uuid: P }, name: "Maternal", voided: false, programSubjectLabel: "Individual" }] },
      "formMappings.json": [
        ...skeleton["formMappings.json"],
        { uuid: FM2, formUUID: F2, subjectTypeUUID: ST, formType: "ProgramEnrolment", formName: "Maternal Enrolment", enableApproval: false, programUUID: P },
      ],
      [`forms/Maternal Enrolment_${F2}.json`]: { name: "Maternal Enrolment", uuid: F2, formType: "ProgramEnrolment", formElementGroups: [], decisionRule: "", visitScheduleRule: "", validationRule: "", checklistsRule: "", decisionConcepts: [] },
    });
    await sessions.commitWorkspaceChanges(created.sessionId, "author skeleton + Maternal program");

    // Turn 2: add ONE ProgramEncounter — "Deworming Followup" — to Maternal.
    const E = crypto.randomUUID(), OE = crypto.randomUUID(), F3 = crypto.randomUUID(), FM3 = crypto.randomUUID(), FE = crypto.randomUUID(), FEG = crypto.randomUUID();
    const formMappings = JSON.parse(fs.readFileSync(path.join(bundleDir, "formMappings.json"), "utf8"));
    formMappings.push({ uuid: FM3, formUUID: F3, subjectTypeUUID: ST, formType: "ProgramEncounter", formName: "Deworming Followup", enableApproval: false, programUUID: P, encounterTypeUUID: E });
    fs.writeFileSync(path.join(bundleDir, "formMappings.json"), JSON.stringify(formMappings, null, 2));
    fs.writeFileSync(path.join(bundleDir, "encounterTypes.json"), JSON.stringify([{ name: "Deworming Followup", uuid: E, entityEligibilityCheckRule: "", active: true, immutable: false }], null, 2));
    fs.writeFileSync(path.join(bundleDir, "operationalEncounterTypes.json"), JSON.stringify({ operationalEncounterTypes: [{ uuid: OE, encounterType: { uuid: E, voided: false }, name: "Deworming Followup", voided: false }] }, null, 2));
    fs.writeFileSync(path.join(bundleDir, `forms/Deworming Followup_${F3}.json`), JSON.stringify({
      name: "Deworming Followup", uuid: F3, formType: "ProgramEncounter",
      formElementGroups: [{ uuid: FEG, name: "Details", displayOrder: 1, formElements: [
        { uuid: FE, name: "Date of deworming dose", displayOrder: 1, type: "Date", mandatory: true, keyValues: [],
          concept: { name: "Date of deworming dose", uuid: crypto.randomUUID(), dataType: "Date", active: true, media: [], answers: [] } },
      ], timed: false, display: "Details" }],
      decisionRule: "", visitScheduleRule: "", validationRule: "", checklistsRule: "", decisionConcepts: [],
    }, null, 2));

    const res2 = await sessions.commitWorkspaceChanges(created.sessionId, "add Deworming Followup encounter");
    assert.equal(res2.specSync.specChanged, true, "adding an encounter must change the derived spec");

    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // The AGENT's own bundle-level diff (turn 2:) — the UUID-consistency puzzle.
    const bundleDiff = sessions.diffTurn(created.sessionId, 2);
    assert.match(bundleDiff, UUID_RE, "the raw bundle diff for a one-encounter-add is UUID-laden (the thing spec.yaml exists to fix)");

    // The DERIVED spec.yaml diff, from the turn 2.spec follow-up commit — the changelog.
    const log = execFileSync("git", ["log", "--pretty=format:%H%x09%s"], { cwd: bundleDir, encoding: "utf8" }).split("\n");
    const specCommit = log.find((l) => l.split("\t")[1] === "turn 2.spec: derived spec view");
    assert.ok(specCommit, `expected a turn 2.spec follow-up commit; saw: ${log.map((l) => l.split("\t")[1]).join(" | ")}`);
    const specSha = specCommit.split("\t")[0];
    const specDiff = execFileSync("git", ["diff", `${specSha}^`, specSha, "--", "spec.yaml"], { cwd: bundleDir, encoding: "utf8" });

    assert.match(specDiff, /Deworming Followup/, "the spec.yaml diff must name the new encounter in plain English");
    assert.doesNotMatch(specDiff, UUID_RE, "the spec.yaml diff must carry ZERO UUIDs — identity lives only in identity-map.yaml (contract §3.1 rule 5)");

    const changedLines = specDiff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    assert.ok(changedLines.length > 0 && changedLines.length <= 20,
      `expected a small, single legible YAML block (<=20 changed lines); saw ${changedLines.length}:\n${specDiff}`);
  } finally {
    if (prevSpecView === undefined) delete process.env.SDK_SPEC_VIEW; else process.env.SDK_SPEC_VIEW = prevSpecView;
    if (prevCrlGate === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prevCrlGate;
  }

  sessions.deleteSession(created.sessionId);
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
