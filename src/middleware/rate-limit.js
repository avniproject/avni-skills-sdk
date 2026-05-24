// Per-IP token-bucket rate limiter — Express middleware, zero deps.
//
// Algorithm. Each remote IP gets a bucket holding up to `burst` tokens. On
// every request we refill `(now - lastRefill) * tokensPerMinute / 60_000`
// tokens (capped at `burst`). If tokens >= 1, decrement and call next().
// Otherwise respond 429 with { error: "rate limit", retryAfterMs } and the
// standard `Retry-After` header (rounded up to the nearest second).
//
// Skip predicate. `skip(req)` returning truthy short-circuits the limiter
// before any bucket work. Use for cheap/health endpoints that you don't want
// counted (e.g. /health, GET /v1/skills).
//
// Clock injection. `now()` defaults to Date.now but tests pass an injectable
// clock so we don't need fake timers. The injected clock returns ms.
//
// Memory. Per-IP entries are an object {tokens, lastRefill}. We GC entries
// that have been at full bucket for > 10 minutes on each call (O(n) sweep
// amortised once per minute) — a tiny SDK serving a handful of IPs won't
// notice; protects against unbounded growth if an attacker rotates IPs.

const DEFAULT_TOKENS_PER_MINUTE = 60;
const DEFAULT_BURST = 30;
const GC_FULL_BUCKET_AGE_MS = 10 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;

export function rateLimit(opts = {}) {
  const tokensPerMinute = opts.tokensPerMinute ?? DEFAULT_TOKENS_PER_MINUTE;
  const burst = opts.burst ?? DEFAULT_BURST;
  const skip = typeof opts.skip === "function" ? opts.skip : null;
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();

  if (!(tokensPerMinute > 0)) throw new Error("rateLimit: tokensPerMinute must be > 0");
  if (!(burst > 0)) throw new Error("rateLimit: burst must be > 0");

  const buckets = new Map(); // ip → { tokens, lastRefill }
  let lastGc = now();

  function refill(bucket, t) {
    const elapsed = t - bucket.lastRefill;
    if (elapsed <= 0) return;
    bucket.tokens = Math.min(burst, bucket.tokens + (elapsed * tokensPerMinute) / 60_000);
    bucket.lastRefill = t;
  }

  function gc(t) {
    if (t - lastGc < GC_INTERVAL_MS) return;
    lastGc = t;
    for (const [ip, b] of buckets) {
      // Bring bucket up to date before deciding.
      refill(b, t);
      if (b.tokens >= burst && t - b.lastRefill > GC_FULL_BUCKET_AGE_MS) {
        buckets.delete(ip);
      }
    }
  }

  function clientIp(req) {
    // Express stashes the connection IP at req.ip (honours `trust proxy`).
    // Fall back to socket address for non-Express callers (defensive).
    return req.ip || req.socket?.remoteAddress || "unknown";
  }

  return function rateLimitMiddleware(req, res, next) {
    if (skip && skip(req)) return next();
    const t = now();
    gc(t);
    const ip = clientIp(req);
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: burst, lastRefill: t };
      buckets.set(ip, bucket);
    } else {
      refill(bucket, t);
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return next();
    }
    // Need 1 token. ms to next token = (1 - tokens) / tokensPerMinute * 60_000.
    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / tokensPerMinute) * 60_000);
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "rate limit", retryAfterMs });
  };
}

// Test-only knobs surfaced for the test file. Not load-bearing in prod.
export const _internals = {
  DEFAULT_TOKENS_PER_MINUTE,
  DEFAULT_BURST,
  GC_FULL_BUCKET_AGE_MS,
  GC_INTERVAL_MS,
};
