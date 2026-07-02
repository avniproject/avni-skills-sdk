// Per-session token + cost ledger and circuit breakers.
//
// In-memory cache + disk-backed `cost.jsonl` per session. Each call to
// `recordResult` appends one JSON line to <session>/cost.jsonl so totals
// survive process restart and the CLI's `--resume <sid>` flag accumulates
// spend correctly. The in-memory row is the fast read path; on first access
// of a session we hydrate from disk if cost.jsonl exists.
//
// Three caps, in order of severity:
//
//   1. session.hardCapUsd  — once exceeded, every /messages request is refused
//                            until the user explicitly resets via /v1/sessions/:id/wallet/reset.
//                            A per-session cap can override the default in either
//                            direction: resetCap() bumps it UP; setCapOverride()
//                            sets an absolute value (may be BELOW the default).
//                            All enforcement paths read it via effectiveCap().
//   2. turn.maxEvents      — abort an in-flight turn if the SSE event count
//                            crosses this threshold (runaway loop guard).
//   3. turn.maxCostUsd     — abort an in-flight turn if its accumulated cost
//                            crosses this threshold (one bad prompt can't drain
//                            the whole budget).
//
// Defaults are conservative for safety. Override via env:
//   SDK_WALLET_HARD_CAP_USD       (default 5.00)
//   SDK_WALLET_TURN_MAX_EVENTS    (default 250)
//   SDK_WALLET_TURN_MAX_COST_USD  (default 1.00)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULTS = {
  hardCapUsd:      parseFloat(process.env.SDK_WALLET_HARD_CAP_USD || "5.00"),
  turnMaxEvents:   parseInt(process.env.SDK_WALLET_TURN_MAX_EVENTS || "250", 10),
  turnMaxCostUsd:  parseFloat(process.env.SDK_WALLET_TURN_MAX_COST_USD || "1.00"),
};

const ledger = new Map(); // sessionId → { totalUsd, totalInputTokens, totalOutputTokens, turns: [], hydrated }

function sessionsRoot() {
  return process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");
}

export function costLedgerPath(sessionId) {
  if (!/^sess_[0-9a-f]{16}$/.test(sessionId)) throw new Error("invalid session_id");
  return path.join(sessionsRoot(), sessionId, "cost.jsonl");
}

function hydrateFromDisk(sessionId, row) {
  if (row.hydrated) return;
  row.hydrated = true;
  if (!/^sess_[0-9a-f]{16}$/.test(sessionId)) return;
  const fp = path.join(sessionsRoot(), sessionId, "cost.jsonl");
  if (!fs.existsSync(fp)) return;
  const raw = fs.readFileSync(fp, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    row.totalUsd += entry.usd || 0;
    row.totalInputTokens += entry.inputTokens || 0;
    row.totalOutputTokens += entry.outputTokens || 0;
    row.turns.push({
      turnIndex: entry.turnIndex ?? row.turns.length,
      usd: entry.usd || 0,
      inputTokens: entry.inputTokens || 0,
      outputTokens: entry.outputTokens || 0,
      aborted: !!entry.aborted,
      abortReason: entry.abortReason || null,
      agent: entry.agent || null,
      endedAt: entry.endedAt || 0,
    });
  }
}

function appendCostEntry(sessionId, entry) {
  if (!/^sess_[0-9a-f]{16}$/.test(sessionId)) return;
  const dir = path.join(sessionsRoot(), sessionId);
  // Only persist if the session dir exists on disk — unit tests that exercise
  // wallet logic with arbitrary session ids won't have one, and we don't
  // create the dir ourselves (sessions.js owns that).
  if (!fs.existsSync(dir)) return;
  fs.appendFileSync(path.join(dir, "cost.jsonl"), JSON.stringify(entry) + "\n");
}

function get(sessionId) {
  let row = ledger.get(sessionId);
  if (!row) {
    row = { totalUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, turns: [], hydrated: false };
    ledger.set(sessionId, row);
  }
  hydrateFromDisk(sessionId, row);
  return row;
}

// The active hard cap for a session. A per-session `capOverride` (set by
// resetCap / setCapOverride) wins over the process-wide DEFAULTS.hardCapUsd.
// Before this was read, resetCap()'s write was a documented no-op (#13) — the
// enforcement paths (preDispatchCheck / shouldAbort / getWallet) all compared
// against DEFAULTS directly. They now go through here.
function effectiveCap(row) {
  return typeof row.capOverride === "number" ? row.capOverride : DEFAULTS.hardCapUsd;
}

export function getWallet(sessionId) {
  const row = get(sessionId);
  const cap = effectiveCap(row);
  // Per-agent breakdown: aggregate turn rows by agent tag. Untagged turns
  // (legacy /messages calls, /evaluate, etc.) bucket under "unspecified".
  const byAgent = {};
  for (const t of row.turns) {
    const a = t.agent || "unspecified";
    if (!byAgent[a]) byAgent[a] = { turns: 0, usd: 0, inputTokens: 0, outputTokens: 0 };
    byAgent[a].turns += 1;
    byAgent[a].usd += t.usd || 0;
    byAgent[a].inputTokens += t.inputTokens || 0;
    byAgent[a].outputTokens += t.outputTokens || 0;
  }
  // Round per-agent usd for display
  for (const a of Object.keys(byAgent)) byAgent[a].usd = Number(byAgent[a].usd.toFixed(6));

  return {
    totalUsd: Number(row.totalUsd.toFixed(6)),
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    turnCount: row.turns.length,
    caps: { ...DEFAULTS, hardCapUsd: cap },
    remainingUsd: Math.max(0, cap - row.totalUsd),
    byAgent,
  };
}

/**
 * Called before /messages dispatches the agent. Throws WalletError if the
 * session has already exceeded its hard cap.
 */
export function preDispatchCheck(sessionId) {
  const row = get(sessionId);
  const cap = effectiveCap(row);
  if (row.totalUsd >= cap) {
    const e = new Error(
      `wallet: session ${sessionId} has spent $${row.totalUsd.toFixed(4)} which meets/exceeds hard cap $${cap.toFixed(2)}. ` +
      `Reset via POST /v1/sessions/${sessionId}/wallet/reset to continue.`,
    );
    e.code = "WALLET_HARD_CAP";
    e.status = 402;
    throw e;
  }
  return { allowed: true, remainingUsd: cap - row.totalUsd };
}

/**
 * Build a per-turn meter. Returns an object with:
 *   shouldAbort(currentEventCount, currentCostUsd) → {abort, reason} | null
 *   recordResult({usd, inputTokens, outputTokens}) → final wallet snapshot
 */
export function startTurn(sessionId, { now = Date.now() } = {}) {
  const row = get(sessionId);
  const turnIndex = row.turns.length;
  const meter = {
    sessionId,
    turnIndex,
    startedAt: now,
    shouldAbort(eventCount, costUsd = 0) {
      if (eventCount > DEFAULTS.turnMaxEvents) {
        return { abort: true, reason: "TURN_MAX_EVENTS", events: eventCount, cap: DEFAULTS.turnMaxEvents };
      }
      if (costUsd > DEFAULTS.turnMaxCostUsd) {
        return { abort: true, reason: "TURN_MAX_COST", costUsd, cap: DEFAULTS.turnMaxCostUsd };
      }
      // Mid-stream session-cap check: even if this turn started under the cap,
      // if it's accumulated enough this single turn to push past, abort.
      const cap = effectiveCap(row);
      if (row.totalUsd + costUsd >= cap) {
        return { abort: true, reason: "SESSION_HARD_CAP_MID_TURN", costUsd, totalUsd: row.totalUsd + costUsd, cap };
      }
      return null;
    },
    recordResult({ usd = 0, inputTokens = 0, outputTokens = 0, aborted = false, abortReason = null, agent = null }) {
      const endedAt = Date.now();
      row.totalUsd += usd;
      row.totalInputTokens += inputTokens;
      row.totalOutputTokens += outputTokens;
      row.turns.push({ turnIndex, usd, inputTokens, outputTokens, aborted, abortReason, agent, endedAt });
      appendCostEntry(sessionId, {
        ts: new Date(endedAt).toISOString(),
        turnIndex, usd, inputTokens, outputTokens, aborted, abortReason, agent, endedAt,
      });
      return getWallet(sessionId);
    },
  };
  return meter;
}

/**
 * Manual reset (after the user explicitly confirms they want to keep spending).
 * We don't ZERO the totals — we just bump the hard cap upward by N x default,
 * so the session retains an audit trail of past spend.
 */
export function resetCap(sessionId, multiplier = 2) {
  const row = get(sessionId);
  // The per-session cap is computed from DEFAULTS.hardCapUsd; we model "reset"
  // as letting the session spend another full budget. Implementation: stash a
  // session-local cap-override on the row.
  row.capOverride = (row.capOverride || DEFAULTS.hardCapUsd) + DEFAULTS.hardCapUsd * multiplier;
  return getWallet(sessionId);
}

/**
 * Set an ABSOLUTE per-session hard cap (USD), overriding DEFAULTS.hardCapUsd for
 * this session only. Unlike resetCap (which bumps the cap UPWARD by a multiplier
 * so a session can keep spending), this sets an exact value — it can be BELOW the
 * default to tighten a session's budget. Honored by preDispatchCheck /
 * shouldAbort / getWallet (via effectiveCap).
 */
export function setCapOverride(sessionId, capUsd) {
  const row = get(sessionId);
  row.capOverride = Number(capUsd);
  return getWallet(sessionId);
}

export function _testReset() {
  // Used by tests to clear ledger between cases.
  ledger.clear();
}

