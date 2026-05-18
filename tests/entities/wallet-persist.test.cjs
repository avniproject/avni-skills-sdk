// Wallet persistence — cost.jsonl written on recordResult; hydrated on resume.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avni-sdk-wallet-persist-"));
  process.env.SDK_SESSIONS_DIR = root;
  return root;
}

async function load() {
  // Re-import to pick up new env + ensure ledger is fresh
  return await import("../../src/wallet.js?t=" + Date.now());
}

function makeSessionDir(root, sid) {
  fs.mkdirSync(path.join(root, sid), { recursive: true });
  return sid;
}

test("recordResult appends one line per turn to cost.jsonl", async () => {
  const root = makeTmpRoot();
  const w = await load();
  w._testReset();
  const sid = makeSessionDir(root, "sess_1111111111111111");
  w.startTurn(sid).recordResult({ usd: 0.10, inputTokens: 500, outputTokens: 200 });
  w.startTurn(sid).recordResult({ usd: 0.05, inputTokens: 200, outputTokens: 100 });
  const lines = fs.readFileSync(w.costLedgerPath(sid), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  const t0 = JSON.parse(lines[0]);
  assert.equal(t0.usd, 0.10);
  assert.equal(t0.inputTokens, 500);
  assert.equal(t0.turnIndex, 0);
  assert.ok(t0.ts);
});

test("hydrateFromDisk: fresh process recovers totals", async () => {
  const root = makeTmpRoot();
  const w1 = await load();
  w1._testReset();
  const sid = makeSessionDir(root, "sess_2222222222222222");
  w1.startTurn(sid).recordResult({ usd: 0.40, inputTokens: 1000, outputTokens: 500 });
  w1.startTurn(sid).recordResult({ usd: 0.30, inputTokens: 800, outputTokens: 400 });

  // Simulate process restart — clear in-memory ledger, re-import
  w1._testReset();
  const w2 = await load();
  const wallet = w2.getWallet(sid);
  assert.ok(Math.abs(wallet.totalUsd - 0.70) < 1e-9);
  assert.equal(wallet.totalInputTokens, 1800);
  assert.equal(wallet.totalOutputTokens, 900);
  assert.equal(wallet.turnCount, 2);
});

test("no session dir → silent no-op (existing in-memory tests still pass)", async () => {
  makeTmpRoot();
  const w = await load();
  w._testReset();
  // sess_abc has wrong shape AND no dir — recordResult must not throw
  // (matches the existing wallet.test.cjs which uses ids like "sess_abc")
  const m = w.startTurn("sess_abc");
  m.recordResult({ usd: 0.05, inputTokens: 1, outputTokens: 1 });
  assert.equal(w.getWallet("sess_abc").totalUsd, 0.05);
});

test("hardCapUsd respected after disk hydrate (cannot bypass via restart)", async () => {
  const root = makeTmpRoot();
  process.env.SDK_WALLET_HARD_CAP_USD = "0.50";
  const w1 = await load();
  w1._testReset();
  const sid = makeSessionDir(root, "sess_3333333333333333");
  w1.startTurn(sid).recordResult({ usd: 0.50, inputTokens: 1, outputTokens: 1 });

  // Restart, re-hydrate — must remember the cap was hit
  w1._testReset();
  const w2 = await load();
  assert.throws(() => w2.preDispatchCheck(sid), /hard cap/i);

  delete process.env.SDK_WALLET_HARD_CAP_USD;
});
