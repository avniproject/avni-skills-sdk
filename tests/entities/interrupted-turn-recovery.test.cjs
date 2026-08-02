// INTERRUPTED-TURN RECOVERY — surface work stranded by a turn that never finished.
//
// WHY THIS EXISTS
//
// A turn is all-or-nothing: the agent edits files in <session>/bundle/, and the
// server commits them only AFTER the SSE stream ends. If the process dies mid-turn
// — terminal closed, Ctrl-C, the CLI exiting and taking its spawned server child
// with it — the edits are already on disk but were never committed, and meta.json
// still describes the PREVIOUS turn.
//
// Nothing surfaced that. `listWorkingTreeChanges` existed but had zero callers
// outside sessions.js, so `GET /v1/sessions/:id` reported meta's view only. On
// resume the operator saw "turn 0 · empty workspace" while 19 modified files sat
// in the working tree — and because the stats box counts files from disk, the
// banner contradicted itself in two adjacent lines.
//
// This is not hypothetical: a real session died mid-way through removing a phantom
// subject type. It had deleted the entity but not yet repointed the 8 formMappings
// that referenced it, leaving a bundle strictly WORSE than where it started (8
// dangling refs). Resuming showed no sign anything had happened.
//
// The fix is to report it, not to auto-recover: committing someone else's
// half-finished surgery on their behalf is exactly the wrong call. Surface it,
// name the files, let the operator decide.
//
// Synthetic fixtures only (CLAUDE.md §1) — no real org data.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "interrupted-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadSessions() {
  return import("../../src/sessions.js?t=" + Date.now());
}

async function newAgentSession() {
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "agent", org: "RecoveryTest", srs: "requirements" });
  return { sessions, id: created.sessionId };
}

test("uncommittedChanges: empty right after session creation", async () => {
  const { sessions, id } = await newAgentSession();
  assert.deepEqual(sessions.uncommittedChanges(id), [], "a freshly committed turn 0 leaves a clean tree");
});

test("uncommittedChanges: names files an interrupted turn left behind", async () => {
  const { sessions, id } = await newAgentSession();
  const dir = sessions.bundleDir(id);

  // Simulate exactly what a killed mid-turn agent leaves: written, never committed.
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([{ name: "Patient" }], null, 2));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "forms", "Reg_abc.json"), JSON.stringify({ name: "Reg" }, null, 2));

  const changes = sessions.uncommittedChanges(id);
  assert.ok(changes.includes("subjectTypes.json"), `expected subjectTypes.json in ${JSON.stringify(changes)}`);
  assert.ok(
    changes.some((f) => f.startsWith("forms/")),
    `expected a forms/ entry in ${JSON.stringify(changes)}`,
  );
});

test("uncommittedChanges: meta still reports the OLD turn — the contradiction this exposes", async () => {
  const { sessions, id } = await newAgentSession();
  const dir = sessions.bundleDir(id);
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([{ name: "X" }], null, 2));

  const meta = sessions.getSession(id);
  assert.equal(meta.currentTurn, 0, "meta is unchanged by an interrupted turn — that is the whole problem");
  assert.ok(sessions.uncommittedChanges(id).length > 0, "…while the working tree has real work in it");
});

test("uncommittedChanges: clears once the work is committed as a turn", async () => {
  const { sessions, id } = await newAgentSession();
  const dir = sessions.bundleDir(id);
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([{ name: "X" }], null, 2));
  assert.ok(sessions.uncommittedChanges(id).length > 0);

  sessions.commitTurn(id, "recovered interrupted turn", {});
  assert.deepEqual(sessions.uncommittedChanges(id), [], "committing the stranded work clears the report");
});

test("uncommittedChanges: unknown session id throws rather than reporting clean", async () => {
  const { sessions } = await newAgentSession();
  assert.throws(
    () => sessions.uncommittedChanges("sess_0000000000000000"),
    "a missing session must not silently look clean",
  );
});
