// Task 4 — turn-0 prose scrub wiring.
//
// The deterministic generator will not itself emit a prose-named form from
// clean inputs (that failure mode comes from an agent authoring one, not the
// generator), so the FIRST-bundle wiring is exercised end-to-end here at the
// unit the wiring actually calls: sessions.scrubSessionBundle(id). We create a
// real session (agent mode — needs no xlsx fixture), author a prose-named form
// directly into its bundle dir (mirroring exactly what commitWorkspaceChanges
// would have committed as a turn), and confirm scrubSessionBundle prunes it and
// lands a real "scrub: prose cleanup" commit on the session's git history.
//
// Synthetic fixtures only (CLAUDE.md §1) — no real org data.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Isolate sessions on disk BEFORE importing sessions.js (reads SDK_SESSIONS_DIR
// at module load). Cache-busted dynamic import re-reads it.
const SESSIONS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "prose-gate-sessions-"));
process.env.SDK_SESSIONS_DIR = SESSIONS_ROOT;

async function loadSessions() { return import("../../src/sessions.js?t=" + Date.now()); }

function gitIn(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function headSubject(dir) {
  return gitIn(dir, "log", "-1", "--pretty=%s").trim();
}

test("sessions exports scrubSessionBundle", async () => {
  const sessions = await loadSessions();
  assert.equal(typeof sessions.scrubSessionBundle, "function",
    "sessions must export scrubSessionBundle(id) used by the turn-0 wiring and the :scrub command");
});

test("scrubSessionBundle prunes a prose-named form from a real session bundle and commits the scrub", async () => {
  const sessions = await loadSessions();
  const created = sessions.createSession({ mode: "agent", org: "ProseTest", srs: "requirements" });
  const id = created.sessionId;
  const dir = sessions.bundleDir(id);

  // Author a prose-named form + its formMapping straight into the bundle dir
  // (as an agent turn would), then commit it as a real turn so the pre-scrub
  // history is realistic.
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  const proseForm = { name: "7. Custom Report Cards (9 cards):", uuid: "f-x", formType: "Encounter", formElementGroups: [] };
  fs.writeFileSync(path.join(dir, "forms", "x_f-x.json"), JSON.stringify(proseForm, null, 2));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify([
    { uuid: "m-x", formUUID: "f-x", formName: proseForm.name, formType: "Encounter", subjectTypeUUID: "s-1" },
  ], null, 2));
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify([], null, 2));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify([{ name: "Student", uuid: "s-1" }], null, 2));

  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-m", "author prose form (test fixture)");

  const beforeSha = gitIn(dir, "rev-parse", "HEAD").trim();

  const r = await sessions.scrubSessionBundle(id, { ai: false });

  assert.ok(r.pruned.length >= 1, `expected at least one prune; got ${JSON.stringify(r)}`);
  assert.ok(r.pruned.some((p) => p.name === proseForm.name), `pruned list should name the prose form; got ${JSON.stringify(r.pruned)}`);
  assert.ok(!fs.existsSync(path.join(dir, "forms", "x_f-x.json")), "prose form file should be removed from disk");

  const afterSha = gitIn(dir, "rev-parse", "HEAD").trim();
  assert.notEqual(afterSha, beforeSha, "scrubSessionBundle must land a new commit when it prunes something");
  assert.match(headSubject(dir), /scrub: prose cleanup/, "HEAD commit subject must record the scrub");
});

test.after(() => { try { fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true }); } catch {} });
