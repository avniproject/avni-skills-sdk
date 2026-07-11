"use strict";

// Phase 4 Task 5 — durable CRL state injection into the per-turn validator
// preamble (currentValidatorStateText). DETERMINISTIC / no-LLM: the AI key is
// unset and the gate runs keyless-enabled for THIS file (Node isolates each
// test file's process, so this doesn't leak to other entity tests, which the CI
// suite runs with SDK_CRL_GATE=off).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SDK_CRL_GATE;

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "crl-state-sessions-"));
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

test("currentValidatorStateText: labels a CRL section once a turn has a recorded crlAtCurrent", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlState", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  assert.match(text, /CRL/, "the injected per-turn state must carry a labeled CRL section once a gate result exists");

  sessions.deleteSession(created.sessionId);
});

test("currentValidatorStateText: SDK_CRL_GATE=off is rendered as 'disabled', not as an unexplained error", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlState", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());

  const prev = process.env.SDK_CRL_GATE;
  process.env.SDK_CRL_GATE = "off";
  try {
    await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");
  } finally {
    if (prev === undefined) delete process.env.SDK_CRL_GATE; else process.env.SDK_CRL_GATE = prev;
  }

  sessions._resetValidatorCache();
  const text = sessions.currentValidatorStateText(created.sessionId);
  assert.match(text, /disabled \(SDK_CRL_GATE=off\)/);
  assert.doesNotMatch(text, /unavailable/, "a deliberately disabled gate must not be rendered as an unexplained failure");

  sessions.deleteSession(created.sessionId);
});

test("currentValidatorStateText: a durably-persisted ESCALATED result survives a fresh module load (cross-session resume)", async () => {
  const sessions = await loadSessions();
  const { buildMinimalSkeleton } = await loadServer();
  const created = sessions.createSession({ mode: "agent", org: "CrlState", srs: "requirements" });
  writeSkeleton(sessions.bundleDir(created.sessionId), buildMinimalSkeleton());
  await sessions.commitWorkspaceChanges(created.sessionId, "author minimal skeleton");

  // Hand-write an escalated gate result (the shape a real crlGate reports,
  // master §2.6) straight into meta.json — proves the injection reads DURABLE
  // state, not a recomputation. This is the "resumed months later" scenario: a
  // brand-new process, a brand-new sessions.js import, reading only on-disk state.
  const metaPath = path.join(SESSIONS_ROOT, created.sessionId, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.crlAtCurrent = {
    pass: false, retries: 3, escalated: true,
    review: { escalate: { reason: "ambiguous: form 'Notes' may be prose, not a real form", findings: [] } },
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  const freshSessions = await import("../../src/sessions.js?t=" + Date.now() + "-fresh");
  freshSessions._resetValidatorCache();
  const text = freshSessions.currentValidatorStateText(created.sessionId);
  assert.match(text, /ESCALATED/);
  assert.match(text, /ambiguous: form 'Notes'/);
  assert.doesNotMatch(text, /✓ bundle is clean/, "an escalated CRL result must NOT be hidden behind the 'fully clean' shortcut");

  freshSessions.deleteSession(created.sessionId);
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
