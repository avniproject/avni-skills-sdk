// Tests for POST /v1/sessions/:id/agent-messages — covers the validation
// paths that don't require a live Anthropic key. The actual LLM dispatch
// path is exercised manually via the :agent REPL command (live key needed).
//
// These tests spin up the server in-process, hit it with various
// request shapes, and verify the 400/401/404 responses.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const AVNI_SKILLS_PATH = process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "..", "avni-skills");

// Spin up the server on a random port per test-run to avoid collisions
// with a dev server on :3030.
const PORT = 13000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
let serverProc;

async function waitForHealth(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server failed to start");
}

test("startup", async () => {
  const { spawn } = require("node:child_process");
  serverProc = spawn("node", ["src/server.js"], {
    cwd: path.resolve(__dirname, "..", ".."),
    env: {
      ...process.env,
      AVNI_SKILLS_PATH,
      SDK_SESSIONS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "agent-msgs-test-")),
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", () => {});
  serverProc.stderr.on("data", () => {});
  await waitForHealth();
});

// ─── Request validation (no LLM call needed) ──────────────────────

test("returns 401 when Authorization header missing", async () => {
  const r = await fetch(`${BASE}/v1/sessions/sess_0000000000000001/agent-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "spec", prompt: "hi" }),
  });
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.match(body.error, /Authorization/);
});

test("returns 400 when agent param missing", async () => {
  const r = await fetch(`${BASE}/v1/sessions/sess_0000000000000001/agent-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-fake" },
    body: JSON.stringify({ prompt: "hi" }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /agent.*required/);
  // Error message should list valid agent names
  assert.match(body.error, /spec/);
  assert.match(body.error, /bundle-config/);
  assert.match(body.error, /review/);
});

test("returns 400 on unknown agent name", async () => {
  const r = await fetch(`${BASE}/v1/sessions/sess_0000000000000001/agent-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-fake" },
    body: JSON.stringify({ agent: "freelance", prompt: "hi" }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /unknown agent.*freelance/);
});

test("returns 400 on missing prompt", async () => {
  const r = await fetch(`${BASE}/v1/sessions/sess_0000000000000001/agent-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-fake" },
    body: JSON.stringify({ agent: "spec" }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /prompt.*required/);
});

test("returns 404 when session id doesn't exist", async () => {
  const r = await fetch(`${BASE}/v1/sessions/sess_doesnotexistxx/agent-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-fake" },
    body: JSON.stringify({ agent: "spec", prompt: "hi" }),
  });
  assert.equal(r.status, 404);
});

// ─── All three agents accepted as valid agent params ──────────────

test("all three canonical agent names are accepted (no 400 on /messages dispatch)", async () => {
  // We don't have a real session, so we expect 404 — but NOT 400 (which would
  // mean the agent name itself was rejected).
  for (const agent of ["spec", "bundle-config", "review"]) {
    const r = await fetch(`${BASE}/v1/sessions/sess_0000000000000099/agent-messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-fake" },
      body: JSON.stringify({ agent, prompt: "hi" }),
    });
    assert.equal(r.status, 404, `${agent}: expected 404 (session not found), got ${r.status}`);
  }
});

// ─── Validate the agent-config wiring (agents registered with the API) ──

test("agent config is correctly registered (introspection via 400 error message)", async () => {
  const r = await fetch(`${BASE}/v1/sessions/sess_0000000000000001/agent-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-fake" },
    body: JSON.stringify({ agent: "bogus" }),     // also missing prompt; agent fails first
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  // The agent enum is listed verbatim in the error message
  for (const name of ["spec", "bundle-config", "review"]) {
    assert.ok(body.error.includes(name), `missing ${name} in: ${body.error}`);
  }
});

// ─── shutdown ────────────────────────────────────────────────────

test("shutdown", () => {
  if (serverProc) serverProc.kill("SIGTERM");
});
