// Append-only structured operational log per session.
//
// Distinct from transcript.jsonl (conversation memory):
//   transcript.jsonl → what was said
//   steps.jsonl      → what was *done* (validator runs, workflow runs,
//                       agent turns, commits, zips) with durations + status
//
// Use the `wrap()` helper to time + log any async function call. The
// returned step_id is a short hex hash you can correlate to other systems.
//
// Step shape:
//   { ts, step_id, kind, status: "ok"|"error"|"aborted", duration_ms,
//     meta?: object, error?: string }

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

function sessionsRoot() {
  return process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");
}

export function stepLogPath(sessionId) {
  if (!/^sess_[0-9a-f]{16}$/.test(sessionId)) throw new Error("invalid session_id");
  return path.join(sessionsRoot(), sessionId, "steps.jsonl");
}

function newStepId() {
  return crypto.randomBytes(6).toString("hex");
}

export function logStep(sessionId, step) {
  if (!step || typeof step !== "object") throw new Error("step must be object");
  if (!step.kind || typeof step.kind !== "string") throw new Error("step.kind required");
  const fp = stepLogPath(sessionId);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) throw new Error(`session dir missing: ${dir}`);
  const entry = {
    ts: step.ts || new Date().toISOString(),
    step_id: step.step_id || newStepId(),
    kind: step.kind,
    status: step.status || "ok",
    duration_ms: typeof step.duration_ms === "number" ? step.duration_ms : null,
    ...(step.meta ? { meta: step.meta } : {}),
    ...(step.error ? { error: step.error } : {}),
  };
  fs.appendFileSync(fp, JSON.stringify(entry) + "\n");
  return entry;
}

/**
 * Time an async function and log a step with the result.
 *   const result = await wrap(sid, "validator_run", async () => { ... }, { ngo: "X" });
 * Re-throws on error after logging an "error" status.
 */
export async function wrap(sessionId, kind, fn, meta) {
  const startedAt = Date.now();
  const step_id = newStepId();
  try {
    const result = await fn();
    logStep(sessionId, {
      step_id, kind, status: "ok",
      duration_ms: Date.now() - startedAt,
      meta,
    });
    return result;
  } catch (e) {
    logStep(sessionId, {
      step_id, kind, status: "error",
      duration_ms: Date.now() - startedAt,
      meta,
      error: e?.message || String(e),
    });
    throw e;
  }
}

export function readSteps(sessionId, { limit, kinds, status } = {}) {
  const fp = stepLogPath(sessionId);
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let s;
    try { s = JSON.parse(line); } catch { continue; }
    if (kinds && !kinds.includes(s.kind)) continue;
    if (status && s.status !== status) continue;
    out.push(s);
  }
  if (limit && out.length > limit) return out.slice(-limit);
  return out;
}

export function stepStats(sessionId) {
  const steps = readSteps(sessionId);
  const counts = {};
  const durations = {};
  let errors = 0;
  for (const s of steps) {
    counts[s.kind] = (counts[s.kind] || 0) + 1;
    if (typeof s.duration_ms === "number") {
      if (!durations[s.kind]) durations[s.kind] = { total: 0, n: 0 };
      durations[s.kind].total += s.duration_ms;
      durations[s.kind].n += 1;
    }
    if (s.status === "error") errors += 1;
  }
  const avgMs = {};
  for (const k of Object.keys(durations)) {
    avgMs[k] = Math.round(durations[k].total / durations[k].n);
  }
  return { total: steps.length, errors, counts, avgMs };
}
