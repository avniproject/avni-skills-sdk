// commands/sessions.mjs — `:session` REPL command.
//
//   :session                       — list recent sessions (table)
//   :session list                  — same
//   :session resume <sess_xxx>     — attach to that session, mutates state.sid
//   :session info [sess_xxx]       — show meta for current (or named) session
//
// Mirrors Claude Code's `/resume` flow. The session id is held in
// `state.sid` (mutable across REPL turns); after `:session resume`, every
// subsequent free-text prompt and `:command` operates against the new id.
//
// Listing pulls GET /v1/sessions (which itself reads ~/.avni-skills-sdk/sessions
// — the SDK_SESSIONS_DIR override is honored).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bold, cyan, dim, green, red, yellow, rule } from "../ui.mjs";

function sessionsRoot() {
  return process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");
}

function readCostTotal(sid) {
  const fp = path.join(sessionsRoot(), sid, "cost.jsonl");
  if (!fs.existsSync(fp)) return { usd: 0, turns: 0 };
  let usd = 0, turns = 0;
  for (const line of fs.readFileSync(fp, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); usd += e.usd || 0; turns += 1; } catch {}
  }
  return { usd, turns };
}

function ageStr(iso) {
  if (!iso) return "?";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

function pad(s, w, align = "left") {
  s = String(s);
  if (s.length >= w) return s.slice(0, w);
  const fill = " ".repeat(w - s.length);
  return align === "right" ? fill + s : s + fill;
}

export function makeSessionsCommands({ http, state, attachSession }) {
  async function cmdSession(args) {
    const sub = (args && args[0]) || "list";

    // :session list
    if (sub === "list" || sub === "ls") {
      let metas;
      try {
        const r = await http.getJson("/v1/sessions");
        metas = r.sessions || [];
      } catch (e) {
        console.log(red("could not list sessions: " + e.message));
        return;
      }
      if (metas.length === 0) {
        console.log(dim("no sessions yet — start one with `npm start` or `npm run cli`."));
        return;
      }
      // Sort newest first by createdAt
      metas.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      // Header
      rule(cyan("sessions"), dim);
      console.log(
        "  " + bold(pad("session id", 26)) + bold(pad("org", 20)) + bold(pad("age", 6)) +
        bold(pad("turn", 5, "right")) + "  " + bold(pad("errors", 7, "right")) + "  " +
        bold(pad("cost", 8, "right")) + "  " + bold(pad("active", 8))
      );
      for (const m of metas.slice(0, 20)) {
        const cost = readCostTotal(m.sessionId);
        const err = m.validationAtCurrent?.errors || 0;
        const isActive = state.sid === m.sessionId;
        const errTag = err === 0 ? green(pad(String(err), 7, "right")) : red(pad(String(err), 7, "right"));
        const ageTag = dim(pad(ageStr(m.createdAt), 6));
        const activeTag = isActive ? green(pad("← here", 8)) : dim(pad("", 8));
        console.log(
          "  " + cyan(pad(m.sessionId, 26)) + pad((m.org || "?").slice(0, 19), 20) + ageTag +
          pad(String(m.currentTurn ?? 0), 5, "right") + "  " + errTag + "  " +
          dim("$" + pad(cost.usd.toFixed(4), 7, "right")) + "  " + activeTag
        );
      }
      console.log("");
      console.log(dim("  resume one with: ") + cyan(":session resume <id>"));
      return;
    }

    // :session resume <id>
    if (sub === "resume") {
      const target = args[1];
      if (!target) {
        console.log(red(":session resume <sess_xxxxxxxxxxxxxxxx> — id required"));
        return;
      }
      if (!/^sess_[0-9a-f]{16}$/.test(target)) {
        console.log(red(`invalid session id "${target}" (expected sess_<16-hex>)`));
        return;
      }
      if (target === state.sid) {
        console.log(dim("already attached to " + target));
        return;
      }
      try {
        const sess = await attachSession(target);
        state.sid = target;
        state.priorValidationGroups = { ...(sess.meta?.validationAtCurrent?.groups || {}) };
        rule(cyan("resumed " + target), dim);
        const v = sess.meta?.validationAtCurrent;
        const codes = v?.groups ? Object.entries(v.groups).map(([k, n]) => `${k}:${n}`).join(" ") : "";
        console.log("  " + dim("org: ") + (sess.meta?.org || "?") +
          dim("  · turn: ") + (sess.meta?.currentTurn ?? 0) +
          dim("  · validator: ") + (v?.valid ? green("✓ clean") : red(`${v?.errors || 0} errors`)) +
          (codes ? dim("  " + codes) : ""));
        console.log(dim("  (subsequent prompts now target the resumed session)"));
      } catch (e) {
        console.log(red("attach failed: " + (e?.message || e)));
      }
      return;
    }

    // :session info [id]
    if (sub === "info") {
      const target = args[1] || state.sid;
      try {
        const m = await http.getJson(`/v1/sessions/${target}`);
        const cost = readCostTotal(target);
        console.log(JSON.stringify({ ...m, costTotalUsd: Number(cost.usd.toFixed(6)), costTurns: cost.turns }, null, 2));
      } catch (e) {
        console.log(red("info failed: " + (e?.message || e)));
      }
      return;
    }

    // :session prune [--older-than <days>] [--dry-run]
    // Delegates to src/session-prune.js (loaded dynamically; CLI lives at
    // scripts/prune-sessions.mjs for ops use outside the REPL).
    if (sub === "prune") {
      let days = 30;
      let dryRun = true;  // safe default — explicit --yes to actually delete
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--older-than") { days = Number(args[++i]) || days; }
        else if (args[i] === "--yes" || args[i] === "--confirm") { dryRun = false; }
        else if (args[i] === "--dry-run") { dryRun = true; }
      }
      try {
        const sdkDir = process.cwd();
        const mod = await import(`${sdkDir}/src/session-prune.js`);
        const result = mod.pruneOlderThan({ days, dryRun });
        rule(cyan(dryRun ? "prune (dry-run)" : "prune (DELETING)"), dim);
        console.log(dim(`older than: `) + days + dim(" days  ·  freedBytes: ") + result.freedBytes);
        console.log(dim(`kept: `) + result.kept.length + dim("   pruned: ") + (dryRun ? yellow(`${result.pruned.length} (would prune)`) : red(result.pruned.length)));
        for (const p of result.pruned.slice(0, 10)) {
          console.log(`  ${dryRun ? yellow("would-prune") : red("pruned")} ${cyan(p.sid)} ${dim(p.org || "?")} age=${p.ageDays}d`);
        }
        if (dryRun) {
          console.log(dim("  ↪ re-run with ") + cyan("--yes") + dim(" to actually delete"));
        }
      } catch (e) {
        console.log(red("prune failed: " + (e?.message || e)));
      }
      return;
    }

    console.log(red(`unknown :session subcommand "${sub}". Try: list, resume <id>, info [id], prune [--older-than N] [--yes]`));
  }

  return { cmdSession };
}
