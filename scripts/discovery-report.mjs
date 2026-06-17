#!/usr/bin/env node
// discovery-report.mjs — read the discovery results JSONL and emit a
// tool-reach + flounder report (per model × scenario).
//
// Reads tests/discovery/results/discovery.jsonl (the combined stream the
// discovery harness appends to). Groups by scenario and reports, per scenario:
//   • the latest run's tool histogram (total, distinct, integrity?, skill?)
//   • the flounder verdict + reasons
//   • aggregate reach across all recorded runs (how often integrity was reached)
//
// Pure reader — no API key needed, no spend. Safe to run any time; if there are
// no results yet it says so and exits 0.
//
// Usage:
//   node scripts/discovery-report.mjs                  # human-readable table
//   node scripts/discovery-report.mjs --json           # machine-readable JSON
//   node scripts/discovery-report.mjs --file <path>    # custom JSONL

import fs from "node:fs";
import path from "node:path";

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_JSONL = path.join(SDK_DIR, "tests", "discovery", "results", "discovery.jsonl");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const fileArg = (() => {
  const i = args.indexOf("--file");
  return i >= 0 && args[i + 1] ? args[i + 1] : DEFAULT_JSONL;
})();

function readRecords(fp) {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function buildReport(records) {
  const byScenario = new Map();
  for (const rec of records) {
    const key = rec.scenario || "(unknown)";
    if (!byScenario.has(key)) byScenario.set(key, []);
    byScenario.get(key).push(rec);
  }
  const rows = [];
  for (const [scenario, runs] of [...byScenario.entries()].sort()) {
    const latest = runs[runs.length - 1];
    const h = latest.histogram || {};
    const reachedIntegrity = runs.filter((r) => r.histogram?.usedIntegrityCheck).length;
    const reachedSkill = runs.filter((r) => r.histogram?.usedSkill).length;
    const flounderedCount = runs.filter((r) => r.flounder?.floundered).length;
    rows.push({
      scenario,
      runs: runs.length,
      latestStatus: latest.status,
      tools: h.total ?? 0,
      distinct: h.distinctTools ?? 0,
      usedIntegrity: !!h.usedIntegrityCheck,
      usedValidator: !!h.usedValidator,
      usedSkill: !!h.usedSkill,
      floundered: !!latest.flounder?.floundered,
      flounderReasons: latest.flounder?.reasons || [],
      integrityReachRate: runs.length ? reachedIntegrity / runs.length : 0,
      skillReachRate: runs.length ? reachedSkill / runs.length : 0,
      flounderRate: runs.length ? flounderedCount / runs.length : 0,
      byClass: h.byClass || {},
    });
  }
  return rows;
}

function printTable(rows) {
  if (!rows.length) {
    process.stderr.write(
      "No discovery results yet at " + fileArg + ".\n" +
      "Run the harness first (needs an API key — it's gated/opt-in):\n" +
      "  ANTHROPIC_API_KEY=sk-ant-... SDK_EVAL_BUDGET_USD=5 npm run eval:discovery\n",
    );
    return;
  }
  const isTTY = !!process.stderr.isTTY;
  const b = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  process.stderr.write(b("\nDISCOVERY — tool-reach + flounder report\n"));
  process.stderr.write(dim(`  source: ${fileArg}\n\n`));
  process.stderr.write(
    "  " + "scenario".padEnd(34) + "runs  tools  dist  integ  valid  skill  flounder\n",
  );
  process.stderr.write("  " + "─".repeat(86) + "\n");
  for (const r of rows) {
    const yn = (v) => (v ? "  Y  " : "  ·  ");
    const fl = r.floundered ? `[${r.flounderReasons.join(",")}]` : "no";
    process.stderr.write(
      "  " +
      r.scenario.padEnd(34) +
      String(r.runs).padEnd(6) +
      String(r.tools).padEnd(7) +
      String(r.distinct).padEnd(6) +
      yn(r.usedIntegrity) + "  " +
      yn(r.usedValidator) + "  " +
      yn(r.usedSkill) + "  " +
      fl + "\n",
    );
  }
  process.stderr.write("\n  Reach rates across all recorded runs:\n");
  for (const r of rows) {
    process.stderr.write(
      dim(`    ${r.scenario.padEnd(34)} integrity ${(r.integrityReachRate * 100).toFixed(0)}%  ` +
      `skill ${(r.skillReachRate * 100).toFixed(0)}%  flounder ${(r.flounderRate * 100).toFixed(0)}%\n`),
    );
  }
  process.stderr.write("\n");
}

const records = readRecords(fileArg);
const rows = buildReport(records);
if (asJson) {
  process.stdout.write(JSON.stringify({ source: fileArg, scenarioCount: rows.length, rows }, null, 2) + "\n");
} else {
  printTable(rows);
}
process.exit(0);
