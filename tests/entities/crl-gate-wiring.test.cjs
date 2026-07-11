"use strict";

// Phase 4 Task 4 — the per-change CRL gate wired into commitWorkspaceChanges.
//
// DETERMINISTIC / no-LLM: ANTHROPIC_API_KEY is unset for this process so the
// ai-judged pass clean-skips (CRIT-1) — every assertion here is a STRUCTURAL
// invariant of the Phase-4 wiring (delta shape + blast radius, commit-first
// ordering, SDK_CRL_GATE off-switch, durable meta persistence, no-op/collision
// bypass, reviewSpec on a spec-mutating turn), never a specific pass outcome.
delete process.env.ANTHROPIC_API_KEY;
// This file exercises the ENABLED gate (keyless → deterministic), so it must
// run with the gate ON even though the CI suite default (package.json
// test:entities) sets SDK_CRL_GATE=off to keep every OTHER entity test from
// firing an unbudgeted LLM gate. Node runs each test file in its own process
// (test isolation), so clearing it here re-enables the gate for THIS file only.
delete process.env.SDK_CRL_GATE;

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "crl-wiring-sessions-"));
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

test("buildCrlDelta: shapes {changedFiles, sinceSha, diff, blastRadius} — blastRadius covers dependents of a changed entity (MAJ-5)", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  const sinceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: bundleDir, encoding: "utf8" }).trim();

  // Edit the EXISTING "Name" concept IN PLACE (same uuid) — buildMinimalSkeleton
  // wires this concept's uuid into the registration form's
  // formElementGroups[0].formElements[0].concept, so it is a real
  // dependent-having entity, not an orphan.
  const conceptsPath = path.join(bundleDir, "concepts.json");
  const concepts = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
  concepts[0].dataType = "Numeric";
  fs.writeFileSync(conceptsPath, JSON.stringify(concepts, null, 2));

  const delta = sessions.buildCrlDelta(bundleDir, ["concepts.json"], sinceSha);
  assert.deepEqual(delta.changedFiles, ["concepts.json"]);
  assert.equal(delta.sinceSha, sinceSha);
  assert.match(delta.diff, /Numeric/, "the delta diff must show the uncommitted edit against sinceSha, not an empty diff against a moved HEAD");

  assert.ok(delta.blastRadius && delta.blastRadius.ok, "blastRadius must be a RefResult (contract §2.4)");
  assert.ok(delta.blastRadius.totalReferences >= 1, "the edited concept's uuid is embedded in the registration form — blastRadius must surface that dependent, not just the raw diff");
  const formFile = Object.keys(delta.blastRadius.byFile).find((f) => f.startsWith("forms/"));
  assert.ok(formFile, `blastRadius must include the dependent form; saw files: ${Object.keys(delta.blastRadius.byFile).join(", ")}`);

  sessions.deleteSession(created.sessionId);
});

test("runCrlGateSafely: a CRL evaluation failure degrades to pass:null + error, never throws", async () => {
  const sessions = await loadSessions();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-safe-"));
  const delta = { changedFiles: [], sinceSha: null, diff: "", blastRadius: { ok: true, totalReferences: 0, byFile: {}, references: [] } };
  // Force a genuine CRL-layer failure: point AVNI_SKILLS_PATH at a nonexistent
  // brain so the deterministic checker's brain-graph load throws inside crlGate.
  // runCrlGateSafely MUST swallow it and report the "not evaluated" sentinel.
  const prev = process.env.AVNI_SKILLS_PATH;
  process.env.AVNI_SKILLS_PATH = path.join(os.tmpdir(), "no-such-brain-" + Date.now());
  let res;
  try {
    res = await sessions.runCrlGateSafely(dir, delta);
  } finally {
    if (prev === undefined) delete process.env.AVNI_SKILLS_PATH; else process.env.AVNI_SKILLS_PATH = prev;
  }
  assert.equal(res.pass, null, "an unevaluated CRL gate must report pass:null, never true/false");
  assert.equal(res.retries, 0);
  assert.equal(res.escalated, false);
  assert.equal(typeof res.error, "string");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commitWorkspaceChanges: a mutating turn carries a crlGate result with pass/retries/escalated", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());

  const res = await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  assert.ok(res.crlGate, "commitWorkspaceChanges must return a crlGate field on a mutating turn");
  assert.ok(res.crlGate.pass === null || typeof res.crlGate.pass === "boolean",
    `crlGate.pass must be boolean or null, got ${JSON.stringify(res.crlGate.pass)}`);
  assert.equal(typeof res.crlGate.retries, "number");
  assert.ok(res.crlGate.retries <= 3, "self-heal is bounded — must never exceed crlGate's own maxRetries default (3)");
  assert.equal(typeof res.crlGate.escalated, "boolean");

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: commit-first ordering — a 'git checkout HEAD' issued right after the turn can never destroy the agent's edit (MAJ-1 regression)", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "turn 1: author skeleton");

  const conceptsPath = path.join(bundleDir, "concepts.json");
  const concepts = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
  concepts[0].dataType = "Numeric"; // the edit THIS turn makes
  fs.writeFileSync(conceptsPath, JSON.stringify(concepts, null, 2));

  await sessions.commitWorkspaceChanges(created.sessionId, "author edit turn");

  // Simulate the executor's own worst-case guardrail (contract §2.5,
  // guardrail 2: `git checkout HEAD -- <file>`) firing right after
  // commitWorkspaceChanges has returned — exactly the scenario MAJ-1 found:
  // pre-fix, this destroyed the agent's just-made edit because HEAD was still
  // the PRIOR turn while the gate ran. Post-fix (commit-first ordering), HEAD
  // already IS the turn containing this edit, so the checkout is a true no-op.
  execFileSync("git", ["checkout", "HEAD", "--", "concepts.json"], { cwd: bundleDir });
  const survived = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
  assert.equal(survived[0].dataType, "Numeric", "the agent's edit must survive a HEAD-relative checkout issued after the turn — proves the turn was committed before any git-level revert could target it");

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: SDK_CRL_GATE=off skips the gate — crlGate reports {disabled:true, pass:null} (MAJ-12)", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());

  const prev = process.env.SDK_CRL_GATE;
  process.env.SDK_CRL_GATE = "off";
  let res;
  try {
    res = await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");
  } finally {
    if (prev === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prev;
  }

  assert.equal(res.crlGate.disabled, true);
  assert.equal(res.crlGate.pass, null, "disabled must still report pass:null — never silently 'clean'");

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: the crlGate result is DURABLY persisted to session meta.json", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  // Re-read straight off disk — simulates a session resumed in a fresh process
  // months later (SDK_SESSIONS_DIR is the durable record; see sessions.js header).
  const metaOnDisk = JSON.parse(fs.readFileSync(path.join(SESSIONS_ROOT, created.sessionId, "meta.json"), "utf8"));
  assert.ok(metaOnDisk.crlAtCurrent, "crlAtCurrent must be persisted to meta.json");
  assert.equal(typeof metaOnDisk.crlAtCurrent.retries, "number");

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: a NO-OP turn never invokes the CRL gate", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  const res = await sessions.commitWorkspaceChanges(created.sessionId, "no-op turn");
  assert.equal(res.noChanges, true);
  assert.equal(res.crlGate, undefined, "a no-op turn must not carry a fresh crlGate result — the gate did not run");

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: a CONCEPT_COLLISION-rejected turn never invokes the CRL gate", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  // Case-insensitive concept-name collision — the interceptor's trigger.
  const conceptsPath = path.join(bundleDir, "concepts.json");
  const concepts = JSON.parse(fs.readFileSync(conceptsPath, "utf8"));
  concepts.push({ name: concepts[0].name.toLowerCase(), uuid: crypto.randomUUID(), dataType: "Text", active: true });
  fs.writeFileSync(conceptsPath, JSON.stringify(concepts, null, 2));

  const res = await sessions.commitWorkspaceChanges(created.sessionId, "colliding concept");
  assert.equal(res.rejected, true);
  assert.equal(res.rejectionReason, "CONCEPT_COLLISION");
  assert.equal(res.crlGate, undefined, "a collision-rejected turn must not invoke the CRL gate");

  sessions.deleteSession(created.sessionId);
});

// ─── O-1: reviewSpec wired for a spec-mutating turn ─────────────────
const SEED_SPEC = `
org: RoundTripOrg
subjectTypes:
  - name: Beneficiary
    type: Person
    registrationForm:
      sections:
        - name: Identity
          fields:
            - {name: Full Name, dataType: Text, mandatory: true}
            - {name: Age, dataType: Numeric, min: 0, max: 120}
`;

test("commitWorkspaceChanges: a spec-mutating turn also gates the spec artifact via reviewSpec (O-1)", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  const bundleDir = sessions.bundleDir(created.sessionId);
  writeSkeleton(bundleDir, buildMinimalSkeleton());
  // A canonical spec artifact authored into the bundle this turn.
  fs.writeFileSync(path.join(bundleDir, "spec.yaml"), SEED_SPEC);

  const res = await sessions.commitWorkspaceChanges(created.sessionId, "author skeleton + spec");

  assert.ok(res.specGate, "a spec-mutating turn must carry a specGate result (reviewSpec wired, O-1)");
  assert.ok(res.specGate.pass === null || typeof res.specGate.pass === "boolean",
    `specGate.pass must be boolean or null, got ${JSON.stringify(res.specGate.pass)}`);
  assert.ok(res.specGate.review && res.specGate.review.kind === "spec",
    "specGate must review the SPEC artifact against spec-template.yaml, not the bundle");

  // Durably persisted alongside the bundle gate.
  const metaOnDisk = JSON.parse(fs.readFileSync(path.join(SESSIONS_ROOT, created.sessionId, "meta.json"), "utf8"));
  assert.ok(metaOnDisk.specCrlAtCurrent, "specCrlAtCurrent must be persisted to meta.json");

  sessions.deleteSession(created.sessionId);
});

test("commitWorkspaceChanges: a bundle-only turn carries NO specGate (reviewSpec only fires on a spec artifact)", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlWiring", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());

  const res = await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");
  assert.equal(res.specGate, undefined, "a turn that touches no spec artifact must not run reviewSpec");

  sessions.deleteSession(created.sessionId);
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
