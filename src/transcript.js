// Append-only JSONL conversation memory per session.
//
// Mirrors Claude Code's transcript model: each line is one event in the
// agent loop. The file is the source of truth for "what did the user and
// agent say to each other" across turns — git captures filesystem diffs,
// this captures conversation.
//
// Event kinds (open set, kebab-case strings):
//   user_message       — REPL free-text or :command input
//   assistant_message  — agent text reply (one per assistant text block)
//   tool_use           — agent called a tool (Edit, Read, Bash, workflow)
//   tool_result        — tool returned (success or error)
//   turn_commit        — git commit landed (filesystem turn boundary)
//   workflow_invoke    — CLI :rename / :add-form / :add-subject-type fired
//   system             — meta events (resume, model switch, wallet reset)
//
// On resume, callers replay events to rebuild user-visible context.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function sessionsRoot() {
  return process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");
}

export function transcriptPath(sessionId) {
  if (!/^sess_[0-9a-f]{16}$/.test(sessionId)) throw new Error("invalid session_id");
  return path.join(sessionsRoot(), sessionId, "transcript.jsonl");
}

export function appendEvent(sessionId, event) {
  if (!event || typeof event !== "object") throw new Error("event must be object");
  if (!event.kind || typeof event.kind !== "string") throw new Error("event.kind required");
  const fp = transcriptPath(sessionId);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) throw new Error(`session dir missing: ${dir}`);
  const line = JSON.stringify({ ts: event.ts || new Date().toISOString(), ...event });
  fs.appendFileSync(fp, line + "\n");
}

export function readTranscript(sessionId, { limit, sinceTs, kinds } = {}) {
  const fp = transcriptPath(sessionId);
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (sinceTs && ev.ts && ev.ts <= sinceTs) continue;
    if (kinds && Array.isArray(kinds) && !kinds.includes(ev.kind)) continue;
    out.push(ev);
  }
  if (limit && out.length > limit) return out.slice(-limit);
  return out;
}

export function transcriptStats(sessionId) {
  const events = readTranscript(sessionId);
  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return { total: events.length, counts, firstTs: events[0]?.ts || null, lastTs: events.at(-1)?.ts || null };
}
