#!/usr/bin/env node
// CLI: prune sessions older than N days.
//
// Usage:
//   node scripts/prune-sessions.mjs --older-than 30 --dry-run
//   node scripts/prune-sessions.mjs --older-than 30
//
// Respects $SDK_SESSIONS_DIR via the underlying module.

import { pruneOlderThan } from "../src/session-prune.js";

function parseArgs(argv) {
  const out = { days: 30, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--older-than" || a === "-d") {
      out.days = Number(argv[++i]);
    } else if (a === "--dry-run" || a === "-n") {
      out.dryRun = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      console.error(`unknown arg: ${a}`);
      out.help = true;
    }
  }
  if (!Number.isFinite(out.days) || out.days < 0) out.help = true;
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.error("Usage: prune-sessions.mjs --older-than <days> [--dry-run]");
    process.exit(args.help && process.argv.includes("--help") ? 0 : 2);
  }
  const { kept, pruned, freedBytes } = pruneOlderThan({ days: args.days, dryRun: args.dryRun });
  const verb = args.dryRun ? "WOULD prune" : "Pruned";
  console.log(`${verb} ${pruned.length} session(s); kept ${kept.length}; ${args.dryRun ? "would free" : "freed"} ${fmtBytes(freedBytes)}`);
  for (const p of pruned) {
    console.log(`  - ${p.sessionId}  org=${p.org || "?"}  age=${p.ageDays}d  size=${fmtBytes(p.sizeBytes)}`);
  }
}

main();
