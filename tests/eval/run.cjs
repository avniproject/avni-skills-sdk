#!/usr/bin/env node
// tests/eval/run.cjs
//
// Real-LLM regression harness for avni-skills-sdk. Boots a fresh server per
// case on a random port + ephemeral SDK_SESSIONS_DIR, dispatches each case's
// prompt, runs the case's assertions, and emits a JSON report on stdout +
// human-readable table on stderr.
//
// Cost-budgeted, opt-in: if ANTHROPIC_API_KEY is unset, exits 0 with a clear
// "SKIPPED" notice so it's harness-friendly. If running cases push past
// SDK_EVAL_BUDGET_USD (default $5.00), the run halts after the current case
// and subsequent cases are marked "skipped (budget)".
//
// Env:
//   ANTHROPIC_API_KEY   — REQUIRED (otherwise skipped clean)
//   SDK_EVAL_BUDGET_USD — total spend cap across all cases (default 5.00)
//   SDK_EVAL_FILTER     — regex applied to case names (e.g. "01|02|07")
//   AVNI_SKILLS_PATH    — propagated to the spawned server
//
// Exit codes:
//   0 — all selected cases passed (or SKIPPED clean for no-key)
//   1 — any case failed

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { runCase, makeHttp } = require("./lib/runner.cjs");

// ─── ANSI helpers ──────────────────────────────────────────────────

const isTTY = !!process.stderr.isTTY;
function ansi(code, s) { return isTTY ? `\x1b[${code}m${s}\x1b[0m` : s; }
const red    = (s) => ansi(31, s);
const green  = (s) => ansi(32, s);
const yellow = (s) => ansi(33, s);
const cyan   = (s) => ansi(36, s);
const dim    = (s) => ansi(2, s);
const bold   = (s) => ansi(1, s);

function eprint(...args) { process.stderr.write(args.join(" ") + "\n"); }

// ─── env / config ──────────────────────────────────────────────────

const SDK_DIR = path.resolve(__dirname, "..", "..");
const CASES_DIR = path.join(__dirname, "cases");
const APIKEY = process.env.ANTHROPIC_API_KEY || "";
const BUDGET = Number(process.env.SDK_EVAL_BUDGET_USD || "5.00");
const FILTER = process.env.SDK_EVAL_FILTER ? new RegExp(process.env.SDK_EVAL_FILTER) : null;

// ─── case discovery ────────────────────────────────────────────────

function discoverCases() {
  const files = fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".cjs"))
    .sort();
  const cases = [];
  for (const f of files) {
    const fp = path.join(CASES_DIR, f);
    let mod;
    try {
      mod = require(fp);
    } catch (e) {
      eprint(red(`load failed: ${f} — ${e.message}`));
      process.exit(2);
    }
    if (!mod || !mod.name) {
      eprint(red(`load failed: ${f} — missing module.exports.name`));
      process.exit(2);
    }
    cases.push({ file: fp, def: mod });
  }
  return cases;
}

// ─── server lifecycle ──────────────────────────────────────────────

let activeProc = null;
process.on("SIGINT", () => { killActive("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { killActive("SIGTERM"); process.exit(143); });
process.on("exit", () => killActive("EXIT"));

function killActive(reason) {
  if (activeProc && !activeProc.killed) {
    try { activeProc.kill("SIGTERM"); } catch {}
  }
  activeProc = null;
}

function pickPort() {
  return 14000 + Math.floor(Math.random() * 1000);
}

async function waitForHealth(base, retries = 80) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy in time");
}

async function bootServer({ port, sessionsDir, envOverrides = {} }) {
  const env = {
    ...process.env,
    PORT: String(port),
    SDK_SESSIONS_DIR: sessionsDir,
    ...envOverrides,
  };
  // We pipe stdio to a log file so the harness output stays clean. On
  // failure we surface the log path.
  const logPath = path.join(os.tmpdir(), `avni-eval-${process.pid}-${port}.log`);
  const logFd = fs.openSync(logPath, "w");
  const proc = spawn("node", ["src/server.js"], {
    cwd: SDK_DIR,
    env,
    stdio: ["ignore", logFd, logFd],
  });
  activeProc = proc;
  const base = `http://localhost:${port}`;
  try {
    await waitForHealth(base);
  } catch (e) {
    eprint(red(`  server boot failed — see ${logPath}`));
    try { fs.closeSync(logFd); } catch {}
    throw e;
  }
  return { proc, base, logPath, sessionsDir };
}

function killServer(proc) {
  if (!proc || proc.killed) return;
  try { proc.kill("SIGTERM"); } catch {}
  activeProc = null;
}

// ─── main ──────────────────────────────────────────────────────────

async function main() {
  if (!APIKEY) {
    eprint(yellow("SKIPPED — ANTHROPIC_API_KEY not set. The eval harness is opt-in and costs money."));
    eprint(dim("  To run: ANTHROPIC_API_KEY=sk-ant-... npm run eval"));
    eprint(dim("  Budget knob: SDK_EVAL_BUDGET_USD=5.00 (default)"));
    eprint(dim("  Filter:     SDK_EVAL_FILTER='01|07' npm run eval"));
    process.stdout.write(JSON.stringify({
      status: "skipped",
      reason: "ANTHROPIC_API_KEY unset",
      cases: [],
      summary: { passed: 0, failed: 0, pending: 0, totalCost: 0, totalDuration: 0 },
    }, null, 2) + "\n");
    process.exit(0);
  }

  const allCases = discoverCases();
  const selected = FILTER ? allCases.filter((c) => FILTER.test(c.def.name)) : allCases;
  if (selected.length === 0) {
    eprint(red(`no cases matched filter ${FILTER}`));
    process.exit(1);
  }

  eprint(bold(`avni-skills-sdk LLM eval — ${selected.length} cases, budget $${BUDGET.toFixed(2)}`));
  eprint(dim(`  filter: ${FILTER ? FILTER.source : "(none)"}`));
  eprint("");

  const results = [];
  let runningCost = 0;
  let halted = false;

  for (const { file, def } of selected) {
    // Pending cases are reported as-is without booting a server.
    if (def.pending) {
      const r = await runCase({
        caseDef: def,
        http: null,
        apiKey: APIKEY,
        sessionsDir: null,
      });
      results.push(r);
      eprint(`  ${yellow("PEND")}  ${def.name.padEnd(36)} ${dim(def.pendingReason || "")}`);
      continue;
    }

    if (halted) {
      results.push({
        name: def.name, status: "skipped",
        skipReason: "budget exhausted",
        cost: 0, durationMs: 0, turnsUsed: 0,
      });
      eprint(`  ${dim("SKIP")}  ${def.name.padEnd(36)} ${dim("(budget halted)")}`);
      continue;
    }

    const port = pickPort();
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), `eval-sess-${def.name}-`));
    // Per-case env overrides (e.g. SDK_EXPORT_DIR for case 06)
    const tmpExtras = fs.mkdtempSync(path.join(os.tmpdir(), `eval-extras-${def.name}-`));
    const envOverrides = typeof def.envOverrides === "function"
      ? def.envOverrides({ tmpDir: tmpExtras })
      : (def.envOverrides || {});

    let server;
    try {
      server = await bootServer({ port, sessionsDir, envOverrides });
    } catch (e) {
      results.push({
        name: def.name, status: "fail",
        error: `server boot failed: ${e.message}`,
        cost: 0, durationMs: 0, turnsUsed: 0,
      });
      eprint(`  ${red("FAIL")}  ${def.name.padEnd(36)} server-boot-failed`);
      continue;
    }

    const http = makeHttp(server.base);
    let result;
    try {
      result = await runCase({
        caseDef: def, http, apiKey: APIKEY, sessionsDir, envOverrides, log: () => {},
      });
    } catch (e) {
      result = {
        name: def.name, status: "fail",
        error: `runner threw: ${e.message}`,
        cost: 0, durationMs: 0, turnsUsed: 0,
      };
    } finally {
      killServer(server.proc);
      // Clean ephemeral session dir
      try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(tmpExtras, { recursive: true, force: true }); } catch {}
    }

    // Re-run assertions IF the case relies on envOverrides (case 06 needs
    // it but the runner doesn't know — runner already invoked assertions,
    // and they read ctx.envOverrides via the result). Actually the runner
    // populates ctx — so case-06 assertions get the value via ctx.
    // (We patched this by passing envOverrides through the case file.)

    results.push(result);
    runningCost += (result.cost || 0);

    const tag = result.status === "pass"
      ? green("PASS")
      : result.status === "pending" ? yellow("PEND") : red("FAIL");
    const costStr = result.cost ? `$${result.cost.toFixed(4)}` : "$0.0000";
    const dur = result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : "?s";
    eprint(`  ${tag}  ${def.name.padEnd(36)} ${dim(costStr)}  ${dim(dur)} ${result.error ? red("— " + result.error.slice(0, 100)) : ""}`);

    if (runningCost > BUDGET) {
      halted = true;
      eprint(red(`  budget $${BUDGET.toFixed(2)} exceeded ($${runningCost.toFixed(4)}) — halting`));
    }
  }

  // ─── summary ─────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const pending = results.filter((r) => r.status === "pending").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalDuration = results.reduce((a, r) => a + (r.durationMs || 0), 0);

  eprint("");
  eprint(bold("─".repeat(72)));
  eprint(`  ${green(passed + " passed")}, ${red(failed + " failed")}, ${yellow(pending + " pending")}${skipped ? ", " + dim(skipped + " skipped") : ""}`);
  eprint(`  total cost: $${runningCost.toFixed(4)}  ·  total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  if (failed > 0) {
    eprint(red("\n  failures:"));
    for (const r of results.filter((r) => r.status === "fail")) {
      eprint(red(`    • ${r.name}`));
      eprint(`      ${dim(r.error || "(no message)")}`);
    }
  }
  eprint("");

  const report = {
    cases: results.map((r) => ({
      name: r.name,
      status: r.status,
      turnsUsed: r.turnsUsed || 0,
      cost: r.cost || 0,
      inputTokens: r.inputTokens || 0,
      outputTokens: r.outputTokens || 0,
      sessionId: r.sessionId || null,
      durationMs: r.durationMs || 0,
      error: r.error || undefined,
      pendingReason: r.pendingReason || undefined,
      skipReason: r.skipReason || undefined,
    })),
    summary: {
      passed, failed, pending, skipped,
      totalCost: Number(runningCost.toFixed(6)),
      totalDuration,
      budget: BUDGET,
      filter: FILTER ? FILTER.source : null,
    },
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  eprint(red(`unhandled error: ${e?.stack || e?.message || e}`));
  process.exit(2);
});
