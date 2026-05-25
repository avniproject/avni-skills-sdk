// Unit tests for src/middleware/rate-limit.js — token-bucket Express middleware.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() { return await import("../../src/middleware/rate-limit.js"); }

// Minimal req/res mocks. We don't need full Express semantics here — only
// req.ip (the limiter falls back to socket.remoteAddress otherwise),
// res.setHeader / res.status / res.json, and a next() callable.
function makeReq(ip = "1.1.1.1") {
  return { ip, socket: { remoteAddress: ip } };
}
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}
function runOnce(mw, req) {
  return new Promise((resolve) => {
    const res = makeRes();
    let called = false;
    mw(req, res, () => { called = true; resolve({ res, nextCalled: true }); });
    // If next() wasn't called synchronously, the middleware responded.
    if (!called) queueMicrotask(() => resolve({ res, nextCalled: false }));
  });
}

test("exhaust burst → 429 with retryAfterMs + Retry-After header", async () => {
  const { rateLimit } = await load();
  let t = 1_000_000;
  const mw = rateLimit({ tokensPerMinute: 60, burst: 3, now: () => t });
  const req = makeReq("10.0.0.1");
  // First 3 requests pass.
  for (let i = 0; i < 3; i++) {
    const { nextCalled } = await runOnce(mw, req);
    assert.equal(nextCalled, true, `request ${i + 1} should be allowed`);
  }
  // 4th in same tick → 429.
  const { res, nextCalled } = await runOnce(mw, req);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "rate limit");
  assert.ok(res.body.retryAfterMs > 0);
  assert.ok(res.headers["Retry-After"]);
  // Retry-After is seconds, rounded up.
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
});

test("waiting refills tokens → request allowed again", async () => {
  const { rateLimit } = await load();
  let t = 0;
  const mw = rateLimit({ tokensPerMinute: 60, burst: 1, now: () => t });
  const req = makeReq("10.0.0.2");
  const r1 = await runOnce(mw, req);
  assert.equal(r1.nextCalled, true);
  // Immediately again → 429.
  const r2 = await runOnce(mw, req);
  assert.equal(r2.nextCalled, false);
  // Advance the clock by 1 second → 1 token refilled.
  t += 1000;
  const r3 = await runOnce(mw, req);
  assert.equal(r3.nextCalled, true);
});

test("different IPs have independent buckets", async () => {
  const { rateLimit } = await load();
  let t = 5000;
  const mw = rateLimit({ tokensPerMinute: 60, burst: 1, now: () => t });
  // IP A: drain.
  assert.equal((await runOnce(mw, makeReq("1.1.1.1"))).nextCalled, true);
  assert.equal((await runOnce(mw, makeReq("1.1.1.1"))).nextCalled, false);
  // IP B: still has its full bucket.
  assert.equal((await runOnce(mw, makeReq("2.2.2.2"))).nextCalled, true);
});

test("skip predicate bypasses limiter entirely", async () => {
  const { rateLimit } = await load();
  let t = 0;
  const mw = rateLimit({
    tokensPerMinute: 60,
    burst: 1,
    skip: (req) => req.url === "/health",
    now: () => t,
  });
  // /health is skipped → 5 requests all allowed even though burst=1.
  for (let i = 0; i < 5; i++) {
    const req = { ...makeReq("3.3.3.3"), url: "/health" };
    const r = await runOnce(mw, req);
    assert.equal(r.nextCalled, true, `health #${i + 1} should be allowed`);
  }
  // Non-skipped path: drains normally.
  const r1 = await runOnce(mw, { ...makeReq("3.3.3.3"), url: "/messages" });
  assert.equal(r1.nextCalled, true);
  const r2 = await runOnce(mw, { ...makeReq("3.3.3.3"), url: "/messages" });
  assert.equal(r2.nextCalled, false);
});

test("burst cap respected — accumulated tokens don't exceed burst", async () => {
  const { rateLimit } = await load();
  let t = 0;
  const mw = rateLimit({ tokensPerMinute: 60, burst: 3, now: () => t });
  const req = makeReq("4.4.4.4");
  // Wait a long time so we'd accrue WAY more than burst.
  t = 1_000_000_000;
  // Should still only allow burst=3.
  for (let i = 0; i < 3; i++) {
    assert.equal((await runOnce(mw, req)).nextCalled, true, `req ${i + 1}`);
  }
  assert.equal((await runOnce(mw, req)).nextCalled, false, "4th must be denied");
});

test("invalid options throw", async () => {
  const { rateLimit } = await load();
  assert.throws(() => rateLimit({ tokensPerMinute: 0 }), /tokensPerMinute/);
  assert.throws(() => rateLimit({ burst: 0 }), /burst/);
});

test("default options work (zero-config call)", async () => {
  const { rateLimit, _internals } = await load();
  const mw = rateLimit();
  const req = makeReq("5.5.5.5");
  // Default burst is 30 — first call should pass.
  const r = await runOnce(mw, req);
  assert.equal(r.nextCalled, true);
  assert.equal(_internals.DEFAULT_BURST, 30);
});
