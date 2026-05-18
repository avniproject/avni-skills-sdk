// Unit tests for src/transcript.js — append-only JSONL conversation memory.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-sdk-transcript-test-"));
  process.env.SDK_SESSIONS_DIR = root;
  return root;
}

async function load() {
  return await import("../../src/transcript.js?t=" + Date.now());
}

function makeSessionDir(root, sid = "sess_0123456789abcdef") {
  const dir = path.join(root, sid);
  fs.mkdirSync(dir, { recursive: true });
  return { sid, dir };
}

test("appendEvent writes one JSON line per call", async () => {
  const root = makeTmpRoot();
  const t = await load();
  const { sid } = makeSessionDir(root);
  t.appendEvent(sid, { kind: "user_message", content: "hello" });
  t.appendEvent(sid, { kind: "assistant_message", content: "hi", model: "haiku" });
  const txt = fs.readFileSync(t.transcriptPath(sid), "utf8").trim();
  const lines = txt.split("\n");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.kind, "user_message");
  assert.equal(first.content, "hello");
  assert.ok(first.ts, "ts auto-added");
});

test("readTranscript returns events in order", async () => {
  const root = makeTmpRoot();
  const t = await load();
  const { sid } = makeSessionDir(root, "sess_abcdef0123456789");
  for (let i = 0; i < 5; i++) t.appendEvent(sid, { kind: "tool_use", name: "Edit", seq: i });
  const events = t.readTranscript(sid);
  assert.equal(events.length, 5);
  assert.deepEqual(events.map((e) => e.seq), [0, 1, 2, 3, 4]);
});

test("readTranscript honors limit (returns LAST N)", async () => {
  const root = makeTmpRoot();
  const t = await load();
  const { sid } = makeSessionDir(root, "sess_fedcba9876543210");
  for (let i = 0; i < 10; i++) t.appendEvent(sid, { kind: "user_message", seq: i });
  const last3 = t.readTranscript(sid, { limit: 3 });
  assert.equal(last3.length, 3);
  assert.deepEqual(last3.map((e) => e.seq), [7, 8, 9]);
});

test("readTranscript filters by kinds", async () => {
  const root = makeTmpRoot();
  const t = await load();
  const { sid } = makeSessionDir(root, "sess_aaaaaaaaaaaaaaaa");
  t.appendEvent(sid, { kind: "user_message" });
  t.appendEvent(sid, { kind: "tool_use" });
  t.appendEvent(sid, { kind: "assistant_message" });
  t.appendEvent(sid, { kind: "turn_commit" });
  const only = t.readTranscript(sid, { kinds: ["user_message", "assistant_message"] });
  assert.equal(only.length, 2);
});

test("transcriptStats counts events by kind", async () => {
  const root = makeTmpRoot();
  const t = await load();
  const { sid } = makeSessionDir(root, "sess_bbbbbbbbbbbbbbbb");
  t.appendEvent(sid, { kind: "user_message" });
  t.appendEvent(sid, { kind: "tool_use" });
  t.appendEvent(sid, { kind: "tool_use" });
  t.appendEvent(sid, { kind: "turn_commit" });
  const stats = t.transcriptStats(sid);
  assert.equal(stats.total, 4);
  assert.equal(stats.counts.user_message, 1);
  assert.equal(stats.counts.tool_use, 2);
  assert.equal(stats.counts.turn_commit, 1);
  assert.ok(stats.firstTs);
  assert.ok(stats.lastTs);
});

test("transcriptPath validates session_id shape", async () => {
  const root = makeTmpRoot();
  const t = await load();
  assert.throws(() => t.transcriptPath("not-a-session"), /invalid session_id/);
  assert.throws(() => t.transcriptPath("sess_xyz"), /invalid session_id/);
});

test("readTranscript returns [] when transcript file missing", async () => {
  const root = makeTmpRoot();
  const t = await load();
  // session dir exists but no events yet
  makeSessionDir(root, "sess_ccccccccccccccccc".slice(0, 21));
  // Note: a 16-hex-char id
  const events = t.readTranscript("sess_cccccccccccccccc");
  assert.deepEqual(events, []);
});

test("appendEvent rejects malformed event", async () => {
  const root = makeTmpRoot();
  const t = await load();
  const { sid } = makeSessionDir(root, "sess_dddddddddddddddd");
  assert.throws(() => t.appendEvent(sid, null), /event must be object/);
  assert.throws(() => t.appendEvent(sid, {}), /event.kind required/);
});

test("appendEvent throws if session dir missing", async () => {
  makeTmpRoot();
  const t = await load();
  // valid shape but no dir created
  assert.throws(() => t.appendEvent("sess_eeeeeeeeeeeeeeee", { kind: "x" }), /session dir missing/);
});
