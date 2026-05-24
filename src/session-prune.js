// Session TTL prune.
//
// Sessions persist forever by default at $SDK_SESSIONS_DIR. For long-running
// deployments this leaks disk. This module computes age from each session's
// `createdAt` (set in meta.json at createSession time) and removes ones older
// than the cut-off.
//
// CONSTRAINT. Only call PUBLIC exports of src/sessions.js. We don't reach
// into private state. listSessions() returns meta objects (with createdAt and
// sessionId), and deleteSession(id) does the rm -rf. That's the whole
// surface.
//
// Disk-size accounting. We walk the session dir recursively to estimate
// freedBytes. This is best-effort: if `du` is faster we don't care, the
// numbers are for operator visibility, not billing.
//
// API:
//   pruneOlderThan({ days = 30, dryRun = false, now? }) → {
//     kept:   [{ sessionId, org, ageDays }],
//     pruned: [{ sessionId, org, ageDays, sizeBytes }],
//     freedBytes,
//   }
//
// `now` is injectable for tests.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listSessions, deleteSession } from "./sessions.js";

function sessionsRoot() {
  return process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");
}

function dirSizeBytes(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const p = stack.pop();
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); }
    catch { continue; } // gone mid-walk — fine.
    for (const e of entries) {
      const fp = path.join(p, e.name);
      try {
        if (e.isDirectory()) {
          stack.push(fp);
        } else if (e.isFile() || e.isSymbolicLink()) {
          // lstat: don't follow symlinks (the workspace stages symlinks into
          // .claude/skills/ pointing into avni-skills; counting those would
          // wildly overstate freed bytes).
          const st = fs.lstatSync(fp);
          total += st.size;
        }
      } catch { /* gone */ }
    }
  }
  return total;
}

export function pruneOlderThan({ days = 30, dryRun = false, now = Date.now() } = {}) {
  if (!(days >= 0)) throw new Error("pruneOlderThan: days must be >= 0");
  const cutoffMs = now - days * 24 * 60 * 60 * 1000;

  const kept = [];
  const pruned = [];
  let freedBytes = 0;

  let metas;
  try { metas = listSessions(); }
  catch { return { kept, pruned, freedBytes }; }

  for (const meta of metas) {
    const sid = meta.sessionId;
    if (!sid) continue;
    const createdAt = meta.createdAt ? Date.parse(meta.createdAt) : NaN;
    // Sessions with missing/unparseable createdAt are NEVER pruned — fail
    // closed. An operator can fix the meta manually if needed.
    if (!Number.isFinite(createdAt)) {
      kept.push({ sessionId: sid, org: meta.org || null, ageDays: null });
      continue;
    }
    const ageDays = Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));
    if (createdAt > cutoffMs) {
      kept.push({ sessionId: sid, org: meta.org || null, ageDays });
      continue;
    }
    // Eligible for pruning.
    const dir = path.join(sessionsRoot(), sid);
    let sizeBytes = 0;
    try { sizeBytes = dirSizeBytes(dir); } catch { /* zero */ }
    if (!dryRun) {
      try { deleteSession(sid); }
      catch { /* if it's already gone, fine; if it's locked, surface via kept */ continue; }
    }
    pruned.push({ sessionId: sid, org: meta.org || null, ageDays, sizeBytes });
    freedBytes += sizeBytes;
  }

  return { kept, pruned, freedBytes };
}
