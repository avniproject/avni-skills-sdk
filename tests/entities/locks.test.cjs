// Unit tests for src/locks.js — per-key async mutex.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() { return await import("../../src/locks.js"); }

test("serialised execution under contention for same key", async () => {
  const { withSessionLock, _resetLocksForTests } = await load();
  _resetLocksForTests();
  const order = [];
  let active = 0;
  let maxActive = 0;
  const work = (label, ms) => async () => {
    active += 1;
    if (active > maxActive) maxActive = active;
    order.push(`${label}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${label}:end`);
    active -= 1;
    return label;
  };
  const results = await Promise.all([
    withSessionLock("k", work("A", 20)),
    withSessionLock("k", work("B", 5)),
    withSessionLock("k", work("C", 10)),
  ]);
  assert.deepEqual(results, ["A", "B", "C"]);
  // Each must FULLY complete before the next starts.
  assert.equal(maxActive, 1, "no concurrent execution allowed under same key");
  assert.deepEqual(order, [
    "A:start", "A:end",
    "B:start", "B:end",
    "C:start", "C:end",
  ]);
});

test("different keys run in parallel", async () => {
  const { withSessionLock, _resetLocksForTests } = await load();
  _resetLocksForTests();
  let active = 0;
  let maxActive = 0;
  const work = (ms) => async () => {
    active += 1;
    if (active > maxActive) maxActive = active;
    await new Promise((r) => setTimeout(r, ms));
    active -= 1;
  };
  await Promise.all([
    withSessionLock("k1", work(20)),
    withSessionLock("k2", work(20)),
    withSessionLock("k3", work(20)),
  ]);
  assert.equal(maxActive, 3, "different keys should run concurrently");
});

test("throw in fn does NOT deadlock subsequent callers", async () => {
  const { withSessionLock, _resetLocksForTests } = await load();
  _resetLocksForTests();
  await assert.rejects(
    withSessionLock("k", async () => { throw new Error("boom"); }),
    /boom/,
  );
  // The chain must not be poisoned — the next caller must run normally.
  const result = await withSessionLock("k", async () => "ok");
  assert.equal(result, "ok");
});

test("returns fn's resolved value", async () => {
  const { withSessionLock, _resetLocksForTests } = await load();
  _resetLocksForTests();
  const v = await withSessionLock("k", async () => 42);
  assert.equal(v, 42);
});

test("synchronous fn supported (auto-promised)", async () => {
  const { withSessionLock, _resetLocksForTests } = await load();
  _resetLocksForTests();
  const v = await withSessionLock("k", () => "sync");
  assert.equal(v, "sync");
});

test("invalid key/fn throws synchronously-ish", async () => {
  const { withSessionLock } = await load();
  await assert.rejects(() => withSessionLock("", async () => {}), /key required/);
  await assert.rejects(() => withSessionLock("k"), /fn required/);
});

test("many short tasks complete in FIFO order", async () => {
  const { withSessionLock, _resetLocksForTests } = await load();
  _resetLocksForTests();
  const order = [];
  const ps = [];
  for (let i = 0; i < 25; i++) {
    ps.push(withSessionLock("k", async () => {
      await new Promise((r) => setTimeout(r, 1));
      order.push(i);
    }));
  }
  await Promise.all(ps);
  assert.deepEqual(order, Array.from({ length: 25 }, (_, i) => i));
});
