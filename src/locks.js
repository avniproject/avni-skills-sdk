// Per-key async mutex.
//
// PROBLEM. Concurrent /messages dispatches for the same session race on:
//   - wallet reads (turnIndex assignment in startTurn → recordResult)
//   - transcript writes (ordering)
//   - git working-tree (two agent edits stepping on each other before commit)
//
// SOLUTION. Coalesce all per-session work onto a single in-process Promise
// chain. Each call to `withSessionLock(key, fn)` appends `.then(fn)` to the
// chain for that key; subsequent calls wait for everything queued before them.
//
// Single-process only. Correct for the current architecture: the SDK runs as
// one Node process, sessions are not sharded, and there is no cross-process
// session storage. If we ever shard, we'll need a real distributed lock —
// don't reach for this module in that case, swap it.
//
// REENTRANCY (READ THIS).
//   withSessionLock("k", async () => {
//     await withSessionLock("k", async () => { ... }); // ← DEADLOCK
//   });
// Calling `withSessionLock` for the same key from inside an already-locked
// section will deadlock — the inner call waits for the outer's promise to
// resolve, which can't happen until the inner returns. Callers MUST NOT nest.
// For our use case (one /messages dispatch per session at a time) this is
// trivially satisfied. If a future call site needs to do multiple things
// atomically, bundle them into a single fn passed to withSessionLock.
//
// API:
//   withSessionLock(key: string, fn: () => Promise<T>): Promise<T>
//
// IMPLEMENTATION NOTES.
//   - The chain is stored as a Promise<void>. fn's return value is forwarded
//     through a separate Promise returned to the caller.
//   - If fn throws, the chain MUST NOT be poisoned — we catch and swallow the
//     rejection on the internal chain, while rethrowing to the caller. Without
//     this, one throw would deadlock every subsequent caller for that key.
//   - We prune the Map entry when its chain resolves AND no new work is
//     queued, so long-running processes don't leak one entry per session id
//     forever. Caveat: a new caller arriving the same tick as the resolution
//     might create a fresh chain — that's fine, correctness is preserved.

const chains = new Map(); // key → Promise<void>

export async function withSessionLock(key, fn) {
  if (typeof key !== "string" || !key) throw new Error("withSessionLock: key required");
  if (typeof fn !== "function") throw new Error("withSessionLock: fn required");

  const prev = chains.get(key) || Promise.resolve();

  // The chain promise that subsequent callers will await. It resolves once
  // fn() settles (success or throw) — never rejects, so a throwing fn does
  // NOT poison the chain.
  let releaseChain;
  const chainNext = new Promise((resolve) => { releaseChain = resolve; });
  chains.set(key, chainNext);

  // Wait our turn.
  try { await prev; } catch { /* prior fn threw — swallow on chain, that caller already got the throw */ }

  try {
    return await fn();
  } finally {
    releaseChain();
    // Prune if no one else queued behind us.
    // Microtask defer so a synchronous follow-up call (same tick) that already
    // observed chainNext and replaced the map entry is not clobbered.
    queueMicrotask(() => {
      if (chains.get(key) === chainNext) chains.delete(key);
    });
  }
}

// Test-only: clear all chains. Useful between cases in a single process where
// keys may be recycled.
export function _resetLocksForTests() {
  chains.clear();
}
