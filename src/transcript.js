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

// Read recent user+assistant messages from the transcript and format them as
// a "Recent conversation" preamble for the next agent turn. Returns "" if
// the transcript has none yet. Callers should invoke this BEFORE appending
// the current turn's user_message so the new prompt isn't double-included.
export function buildPriorContextString(sessionId, { limit = 12, maxCharsPerMessage = 800 } = {}) {
  const events = readTranscript(sessionId, {
    kinds: ["user_message", "assistant_message"],
    limit,
  });
  if (events.length === 0) return "";
  const lines = ["Recent conversation in this session (chronological — oldest first, most recent last):"];
  for (const e of events) {
    const role = e.kind === "user_message" ? "User" : "Assistant";
    const text = String(e.content || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const truncated = text.length > maxCharsPerMessage ? text.slice(0, maxCharsPerMessage) + "…" : text;
    lines.push(`  ${role}: ${truncated}`);
  }
  lines.push("");
  lines.push("The above is this session's conversation memory. The current user instruction below may be a short follow-up (\"yes\", \"do it\", \"add it and zip it\") — interpret it against the most recent assistant message. Do NOT ask the user to re-state what was already discussed.");
  return lines.join("\n");
}
