// Unit tests for src/session-prune.js — TTL-based session pruning.
//
// We don't go through the real createSession() path here — that would require
// running the generator against a synthetic SRS for each fixture. Instead we
// fabricate sessions on disk in the exact shape sessions.js expects:
//   <SDK_SESSIONS_DIR>/sess_<16hex>/meta.json   (with sessionId, org, createdAt)
//   <SDK_SESSIONS_DIR>/sess_<16hex>/<arbitrary files for size>
// The public listSessions() / deleteSession() functions operate purely on
// those shapes, which is the contract this test pins.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ONE root for the whole file, set BEFORE first import. sessions.js captures
// SESSIONS_DIR at module-top, so we can't change it after load. Each test
// uses a unique subdirectory namespace via unique session ids (counter
// generates fresh hex), and cleans up its own sids at the end.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "avni-sdk-prune-test-"));
process.env.SDK_SESSIONS_DIR = ROOT;

let counter = 0;
function newSid() {
  counter += 1;
  return "sess_" + counter.toString(16).padStart(16, "0");
}

// Clear every session dir between tests (cheap — they're tiny scaffold dirs).
function clearRoot() {
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isDirectory()) fs.rmSync(path.join(ROOT, e.name), { recursive: true, force: true });
  }
}

function makeSession(root, { ageDays, org = "TestOrg", sizeBytes = 0, now = Date.now() }) {
  const sid = newSid();
  const dir = path.join(root, sid);
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = new Date(now - ageDays * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
    sessionId: sid,
    org,
    createdAt,
    currentTurn: 0,
    inputs: { forms: "forms.xlsx", modelling: null },
    validationAtCurrent: { valid: true, errors: 0, warnings: 0, groups: {} },
  }, null, 2));
  if (sizeBytes > 0) {
    // Pad a file to the requested size (within a few bytes — close enough for
    // freedBytes accounting which is best-effort).
    fs.writeFileSync(path.join(dir, "payload.bin"), Buffer.alloc(sizeBytes));
  }
  return sid;
}

// One shared module instance — sessions.js's SESSIONS_DIR was captured at
// the first load, which happened AFTER we set process.env.SDK_SESSIONS_DIR.
async function load() {
  const prune = await import("../../src/session-prune.js");
  return { prune };
}

test("dry-run reports prunable sessions WITHOUT deleting", async () => {
  clearRoot();
  const sOld = makeSession(ROOT, { ageDays: 45 });
  const sNew = makeSession(ROOT, { ageDays: 3 });
  const { prune } = await load();
  const r = prune.pruneOlderThan({ days: 30, dryRun: true });
  assert.equal(r.pruned.length, 1);
  assert.equal(r.pruned[0].sessionId, sOld);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].sessionId, sNew);
  // BOTH dirs must still exist on disk.
  assert.ok(fs.existsSync(path.join(ROOT, sOld)));
  assert.ok(fs.existsSync(path.join(ROOT, sNew)));
});

test("real run actually deletes old sessions, leaves new ones", async () => {
  clearRoot();
  const sA = makeSession(ROOT, { ageDays: 60 });
  const sB = makeSession(ROOT, { ageDays: 31 });
  const sC = makeSession(ROOT, { ageDays: 29 });
  const { prune } = await load();
  const r = prune.pruneOlderThan({ days: 30 });
  const prunedIds = r.pruned.map((p) => p.sessionId).sort();
  const keptIds = r.kept.map((p) => p.sessionId).sort();
  assert.deepEqual(prunedIds, [sA, sB].sort());
  assert.deepEqual(keptIds, [sC]);
  assert.ok(!fs.existsSync(path.join(ROOT, sA)));
  assert.ok(!fs.existsSync(path.join(ROOT, sB)));
  assert.ok(fs.existsSync(path.join(ROOT, sC)));
});

test("freedBytes accurately sums dir sizes of pruned sessions", async () => {
  clearRoot();
  const sA = makeSession(ROOT, { ageDays: 60, sizeBytes: 2048 });
  const sB = makeSession(ROOT, { ageDays: 60, sizeBytes: 4096 });
  makeSession(ROOT, { ageDays: 1, sizeBytes: 99999 }); // not counted
  const { prune } = await load();
  const r = prune.pruneOlderThan({ days: 30, dryRun: true });
  // Sum should be at least the payload sizes (meta.json adds a few hundred bytes).
  assert.ok(r.freedBytes >= 2048 + 4096, `freedBytes=${r.freedBytes} too low`);
  // Sanity: not absurdly inflated.
  assert.ok(r.freedBytes < 2048 + 4096 + 10000);
  // Per-session sizeBytes also recorded.
  const map = Object.fromEntries(r.pruned.map((p) => [p.sessionId, p.sizeBytes]));
  assert.ok(map[sA] >= 2048);
  assert.ok(map[sB] >= 4096);
});

test("ageDays computed from meta.createdAt, injectable now", async () => {
  clearRoot();
  const baseline = Date.parse("2026-01-01T00:00:00Z");
  const sid = makeSession(ROOT, { ageDays: 100, now: baseline });
  const { prune } = await load();
  // Use `now` injectable so we don't depend on wall clock.
  const r = prune.pruneOlderThan({ days: 30, dryRun: true, now: baseline });
  assert.equal(r.pruned.length, 1);
  assert.equal(r.pruned[0].sessionId, sid);
  assert.equal(r.pruned[0].ageDays, 100);
});

test("sessions with missing/unparseable createdAt are KEPT (fail closed)", async () => {
  clearRoot();
  const sid = newSid();
  const dir = path.join(ROOT, sid);
  fs.mkdirSync(dir);
  // No createdAt field.
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
    sessionId: sid,
    org: "Mystery",
    currentTurn: 0,
    inputs: { forms: "forms.xlsx", modelling: null },
    validationAtCurrent: { valid: true, errors: 0, warnings: 0, groups: {} },
  }));
  const { prune } = await load();
  const r = prune.pruneOlderThan({ days: 30 });
  assert.equal(r.pruned.length, 0);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].ageDays, null);
  assert.ok(fs.existsSync(dir), "missing-createdAt session must NOT be deleted");
});

test("days=0 prunes everything that has any age (boundary)", async () => {
  clearRoot();
  const sOld = makeSession(ROOT, { ageDays: 5 });
  const { prune } = await load();
  const r = prune.pruneOlderThan({ days: 0 });
  assert.equal(r.pruned.length, 1);
  assert.equal(r.pruned[0].sessionId, sOld);
});

test("empty sessions dir returns empty result", async () => {
  clearRoot();
  const { prune } = await load();
  const r = prune.pruneOlderThan({ days: 30 });
  assert.deepEqual(r, { kept: [], pruned: [], freedBytes: 0 });
});

test("invalid days rejected", async () => {
  clearRoot();
  const { prune } = await load();
  assert.throws(() => prune.pruneOlderThan({ days: -1 }), /days/);
});
