// Wallet + circuit-breaker tests. Pure unit tests against src/wallet.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  // Force defaults so per-test results are predictable
  process.env.SDK_WALLET_HARD_CAP_USD = "1.00";
  process.env.SDK_WALLET_TURN_MAX_EVENTS = "10";
  process.env.SDK_WALLET_TURN_MAX_COST_USD = "0.50";
  // Re-import to pick up env (Node caches; use fresh URL)
  return await import("../../src/wallet.js?test=" + Date.now());
}

test("fresh session has zero spend, allowed", async () => {
  const w = await load();
  w._testReset();
  const ck = w.preDispatchCheck("sess_abc");
  assert.equal(ck.allowed, true);
  assert.equal(w.getWallet("sess_abc").totalUsd, 0);
});

test("turn meter aborts on event-cap exceedance", async () => {
  const w = await load();
  w._testReset();
  const meter = w.startTurn("sess_evt");
  // 10 events under cap, 11 over
  assert.equal(meter.shouldAbort(10, 0.001), null);
  const a = meter.shouldAbort(11, 0.001);
  assert.ok(a);
  assert.equal(a.reason, "TURN_MAX_EVENTS");
});

test("turn meter aborts on per-turn cost cap", async () => {
  const w = await load();
  w._testReset();
  const meter = w.startTurn("sess_cost");
  assert.equal(meter.shouldAbort(5, 0.49), null);
  const a = meter.shouldAbort(5, 0.51);
  assert.ok(a);
  assert.equal(a.reason, "TURN_MAX_COST");
});

test("recordResult accumulates session totals", async () => {
  const w = await load();
  w._testReset();
  const m1 = w.startTurn("sess_acc");
  m1.recordResult({ usd: 0.15, inputTokens: 1000, outputTokens: 500 });
  const m2 = w.startTurn("sess_acc");
  m2.recordResult({ usd: 0.20, inputTokens: 800, outputTokens: 300 });
  const wallet = w.getWallet("sess_acc");
  // floating-point: assertions tolerate epsilon
  assert.ok(Math.abs(wallet.totalUsd - 0.35) < 1e-9);
  assert.equal(wallet.totalInputTokens, 1800);
  assert.equal(wallet.totalOutputTokens, 800);
  assert.equal(wallet.turnCount, 2);
});

test("preDispatchCheck refuses once hard cap reached", async () => {
  const w = await load();
  w._testReset();
  const m = w.startTurn("sess_cap");
  m.recordResult({ usd: 1.00, inputTokens: 1, outputTokens: 1 });
  // Now at cap exactly — next dispatch should be refused
  assert.throws(() => w.preDispatchCheck("sess_cap"), /WALLET|hard cap/i);
});

test("mid-turn session-cap abort fires", async () => {
  const w = await load();
  w._testReset();
  const m1 = w.startTurn("sess_mid");
  m1.recordResult({ usd: 0.80, inputTokens: 1, outputTokens: 1 }); // session at $0.80
  const m2 = w.startTurn("sess_mid");
  // This turn alone is under per-turn cap, but added to 0.80 it crosses 1.00
  const a = m2.shouldAbort(5, 0.25);
  assert.ok(a);
  assert.equal(a.reason, "SESSION_HARD_CAP_MID_TURN");
});

test("remainingUsd reflects spend", async () => {
  const w = await load();
  w._testReset();
  const m = w.startTurn("sess_rem");
  m.recordResult({ usd: 0.40, inputTokens: 1, outputTokens: 1 });
  const wallet = w.getWallet("sess_rem");
  assert.ok(Math.abs(wallet.remainingUsd - 0.60) < 1e-9);
});
