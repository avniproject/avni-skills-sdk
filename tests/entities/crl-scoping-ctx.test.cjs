"use strict";

// Phase 4 Task 2 — buildCrlScopingCtx: the SRS-grounded scoping context the
// CRL's ai-judged pass consumes ("what did the org actually ask for"). Reads the
// session's own attached SRS (the same source bundle_read_srs uses), capped to a
// small preview so it never floods the review payload.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "crl-scoping-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadSessions() { return import("../../src/sessions.js?t=" + Date.now()); }
async function loadMcp() { return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now()); }

test("buildCrlScopingCtx: an agent-mode session with a prose SRS returns { srs: <text> }", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: "Register beneficiaries with name, age, and village." });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.equal(ctx.srs, "Register beneficiaries with name, age, and village.");
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a JSON SRS is returned as its raw text", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: { entities: ["Beneficiary"] } });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.match(ctx.srs, /Beneficiary/);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: caps a large SRS instead of flooding the review payload", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const big = "x".repeat(10000);
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest", srs: big });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.ok(ctx.srs.length <= 4000, `expected capped srs, got ${ctx.srs.length} chars`);
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: an agent-mode session with no SRS attached returns {}", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  const created = sessions.createSession({ mode: "agent", org: "ScopeTest" });
  const ctx = buildCrlScopingCtx(sessions.bundleDir(created.sessionId));
  assert.deepEqual(ctx, {});
  sessions.deleteSession(created.sessionId);
});

test("buildCrlScopingCtx: a baseline-mode session returns {} (no attached SRS to ground on)", async () => {
  const sessions = await loadSessions();
  const { buildCrlScopingCtx } = await loadMcp();
  // A baseline-mode session bundleDir. Fake a session dir with a baseline meta.
  const fakeSession = fs.mkdtempSync(path.join(SESSIONS_ROOT, "sess_faux-"));
  fs.mkdirSync(path.join(fakeSession, "bundle"), { recursive: true });
  fs.writeFileSync(path.join(fakeSession, "meta.json"), JSON.stringify({ mode: "baseline" }));
  const ctx = buildCrlScopingCtx(path.join(fakeSession, "bundle"));
  assert.deepEqual(ctx, {});
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
