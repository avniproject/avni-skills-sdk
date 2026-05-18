// Unit tests for src/steplog.js — structured operational log.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-sdk-steplog-test-"));
  process.env.SDK_SESSIONS_DIR = root;
  return root;
}

async function load() {
  return await import("../../src/steplog.js?t=" + Date.now());
}

function makeSessionDir(root, sid) {
  fs.mkdirSync(path.join(root, sid), { recursive: true });
  return sid;
}

test("logStep writes one JSON line with required fields", async () => {
  const root = makeTmpRoot();
  const s = await load();
  const sid = makeSessionDir(root, "sess_0000000000000001");
  s.logStep(sid, { kind: "validator_run", duration_ms: 120, meta: { errors: 0 } });
  const raw = fs.readFileSync(s.stepLogPath(sid), "utf8").trim();
  const entry = JSON.parse(raw);
  assert.equal(entry.kind, "validator_run");
  assert.equal(entry.status, "ok");
  assert.equal(entry.duration_ms, 120);
  assert.ok(entry.ts);
  assert.ok(entry.step_id);
  assert.deepEqual(entry.meta, { errors: 0 });
});

test("wrap times a successful async fn and logs ok", async () => {
  const root = makeTmpRoot();
  const s = await load();
  const sid = makeSessionDir(root, "sess_0000000000000002");
  const result = await s.wrap(sid, "workflow_run", async () => {
    await new Promise((r) => setTimeout(r, 10));
    return 42;
  }, { name: "add-form" });
  assert.equal(result, 42);
  const steps = s.readSteps(sid);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, "workflow_run");
  assert.equal(steps[0].status, "ok");
  assert.ok(steps[0].duration_ms >= 10);
  assert.deepEqual(steps[0].meta, { name: "add-form" });
});

test("wrap logs error status and rethrows", async () => {
  const root = makeTmpRoot();
  const s = await load();
  const sid = makeSessionDir(root, "sess_0000000000000003");
  await assert.rejects(
    s.wrap(sid, "agent_turn", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  const steps = s.readSteps(sid);
  assert.equal(steps[0].status, "error");
  assert.equal(steps[0].error, "boom");
});

test("readSteps filters by kinds and status", async () => {
  const root = makeTmpRoot();
  const s = await load();
  const sid = makeSessionDir(root, "sess_0000000000000004");
  s.logStep(sid, { kind: "validator_run", status: "ok" });
  s.logStep(sid, { kind: "agent_turn", status: "ok" });
  s.logStep(sid, { kind: "agent_turn", status: "error", error: "x" });
  s.logStep(sid, { kind: "commit", status: "ok" });
  assert.equal(s.readSteps(sid, { kinds: ["agent_turn"] }).length, 2);
  assert.equal(s.readSteps(sid, { status: "error" }).length, 1);
});

test("stepStats summarises counts + avg duration + errors", async () => {
  const root = makeTmpRoot();
  const s = await load();
  const sid = makeSessionDir(root, "sess_0000000000000005");
  s.logStep(sid, { kind: "validator_run", duration_ms: 100 });
  s.logStep(sid, { kind: "validator_run", duration_ms: 200 });
  s.logStep(sid, { kind: "agent_turn", duration_ms: 5000, status: "error", error: "x" });
  const stats = s.stepStats(sid);
  assert.equal(stats.total, 3);
  assert.equal(stats.errors, 1);
  assert.equal(stats.counts.validator_run, 2);
  assert.equal(stats.avgMs.validator_run, 150);
  assert.equal(stats.avgMs.agent_turn, 5000);
});

test("logStep rejects malformed entries", async () => {
  const root = makeTmpRoot();
  const s = await load();
  const sid = makeSessionDir(root, "sess_0000000000000006");
  assert.throws(() => s.logStep(sid, null), /step must be object/);
  assert.throws(() => s.logStep(sid, {}), /step.kind required/);
});
