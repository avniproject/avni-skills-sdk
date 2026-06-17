#!/usr/bin/env node
// tests/discovery/run.cjs
//
// OBSERVE-ONLY discovery harness for avni-skills-sdk (design §4.4). Boots a
// fresh server per scenario on a random port + ephemeral SDK_SESSIONS_DIR with
// SDK_DISCOVERY_PROMPT=1 (so the slim outcome contract is in play), dispatches
// each scenario's TOOL-AGNOSTIC prompt, records a tool-usage histogram +
// flounder verdict, and writes per-scenario results JSONL under
// tests/discovery/results/. It throws ONLY on a scenario's safety floor.
//
// This clones the eval harness's boot/budget/SSE machinery (tests/eval/run.cjs)
// and REUSES tests/eval/lib + tests/discovery/lib.
//
// Cost-budgeted, opt-in — IDENTICAL gating to the eval harness:
//   • ANTHROPIC_API_KEY unset → exit 0 with a clear SKIPPED notice (no spend).
//   • SDK_EVAL_BUDGET_USD (default $5) caps total spend; halts after the
//     current scenario when exceeded.
//
// Env:
//   ANTHROPIC_API_KEY   — REQUIRED (else skipped clean — DO NOT run without it)
//   SDK_EVAL_BUDGET_USD — total spend cap across all scenarios (default 5.00)
//   SDK_DISCOVERY_FILTER— regex applied to scenario names (e.g. "d1|d5")
//   AVNI_SKILLS_PATH    — propagated to the spawned server
//
// Exit codes:
//   0 — all scenarios observed (or SKIPPED clean for no-key)
//   1 — a scenario hit a safety floor (PWNED / unauthorized commit / rm -rf)

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { runScenario, makeHttp } = require("./lib/discovery-runner.cjs");

// ─── ANSI helpers ──────────────────────────────────────────────────
const isTTY = !!process.stderr.isTTY;
function ansi(code, s) { return isTTY ? `\x1b[${code}m${s}\x1b[0m` : s; }
const red = (s) => ansi(31, s);
const green = (s) => ansi(32, s);
const yellow = (s) => ansi(33, s);
const cyan = (s) => ansi(36, s);
const dim = (s) => ansi(2, s);
const bold = (s) => ansi(1, s);
function eprint(...args) { process.stderr.write(args.join(" ") + "\n"); }

// ─── env / config ──────────────────────────────────────────────────
const SDK_DIR = path.resolve(__dirname, "..", "..");
const SCEN_DIR = path.join(__dirname, "scenarios");
const RESULTS_DIR = path.join(__dirname, "results");
const APIKEY = process.env.ANTHROPIC_API_KEY || "";
const BUDGET = Number(process.env.SDK_EVAL_BUDGET_USD || "5.00");
const FILTER = process.env.SDK_DISCOVERY_FILTER ? new RegExp(process.env.SDK_DISCOVERY_FILTER) : null;

// ─── scenario discovery ────────────────────────────────────────────
function discoverScenarios() {
  const files = fs.readdirSync(SCEN_DIR).filter((f) => /^d\d+.*\.cjs$/.test(f)).sort();
  const scenarios = [];
  for (const f of files) {
    const fp = path.join(SCEN_DIR, f);
    let mod;
    try { mod = require(fp); }
    catch (e) { eprint(red(`load failed: ${f} — ${e.message}`)); process.exit(2); }
    if (!mod || !mod.name) { eprint(red(`load failed: ${f} — missing module.exports.name`)); process.exit(2); }
    scenarios.push({ file: fp, def: mod });
  }
  return scenarios;
}

// ─── server lifecycle (cloned from eval/run.cjs) ───────────────────
let activeProc = null;
process.on("SIGINT", () => { killActive(); process.exit(130); });
process.on("SIGTERM", () => { killActive(); process.exit(143); });
process.on("exit", () => killActive());
function killActive() {
  if (activeProc && !activeProc.killed) { try { activeProc.kill("SIGTERM"); } catch {} }
  activeProc = null;
}
function pickPort() { return 15000 + Math.floor(Math.random() * 1000); }

async function waitForHealth(base, retries = 80) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy in time");
}

async function bootServer({ port, sessionsDir }) {
  const env = {
    ...process.env,
    PORT: String(port),
    SDK_SESSIONS_DIR: sessionsDir,
    // The whole point of discovery: measure tool-reach under the SLIM prompt.
    SDK_DISCOVERY_PROMPT: "1",
  };
  const logPath = path.join(os.tmpdir(), `avni-discovery-${process.pid}-${port}.log`);
  const logFd = fs.openSync(logPath, "w");
  const proc = spawn("node", ["src/server.js"], {
    cwd: SDK_DIR, env, stdio: ["ignore", logFd, logFd],
  });
  activeProc = proc;
  const base = `http://localhost:${port}`;
  try { await waitForHealth(base); }
  catch (e) {
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

// ─── results JSONL ──────────────────────────────────────────────────
function writeResultJsonl(result) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    scenario: result.name,
    status: result.status,
    histogram: result.histogram,
    flounder: result.flounder,
    turnsUsed: result.turnsUsed,
    tokensUsed: result.tokensUsed,
    cost: result.cost,
    validatorBefore: result.validatorBefore,
    validatorAfter: result.validatorAfter,
    durationMs: result.durationMs,
    error: result.error || undefined,
  }) + "\n";
  // One file per scenario (keyed by name) — append so reruns accumulate history.
  fs.appendFileSync(path.join(RESULTS_DIR, `${result.name}.jsonl`), line);
  // Plus a combined stream the report reads by default.
  fs.appendFileSync(path.join(RESULTS_DIR, "discovery.jsonl"), line);
}

// ─── main ───────────────────────────────────────────────────────────
async function main() {
  if (!APIKEY) {
    eprint(yellow("SKIPPED — ANTHROPIC_API_KEY not set. The discovery harness is opt-in and costs money."));
    eprint(dim("  To run: ANTHROPIC_API_KEY=sk-ant-... SDK_EVAL_BUDGET_USD=5 npm run eval:discovery"));
    eprint(dim("  Filter: SDK_DISCOVERY_FILTER='d1|d5' npm run eval:discovery"));
    process.stdout.write(JSON.stringify({
      status: "skipped",
      reason: "ANTHROPIC_API_KEY unset",
      scenarios: [],
      summary: { observed: 0, failed: 0, totalCost: 0 },
    }, null, 2) + "\n");
    process.exit(0);
  }

  const all = discoverScenarios();
  const selected = FILTER ? all.filter((c) => FILTER.test(c.def.name)) : all;
  if (selected.length === 0) { eprint(red(`no scenarios matched filter ${FILTER}`)); process.exit(1); }

  eprint(bold(`avni-skills-sdk DISCOVERY (observe-only) — ${selected.length} scenarios, budget $${BUDGET.toFixed(2)}`));
  eprint(dim(`  SDK_DISCOVERY_PROMPT=1 (slim outcome contract) · filter: ${FILTER ? FILTER.source : "(none)"}`));
  eprint("");

  const results = [];
  let runningCost = 0;
  let halted = false;

  for (const { def } of selected) {
    if (halted) {
      eprint(`  ${dim("SKIP")}  ${def.name.padEnd(34)} ${dim("(budget halted)")}`);
      continue;
    }
    const port = pickPort();
    const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), `disc-sess-${def.name}-`));
    let server;
    try { server = await bootServer({ port, sessionsDir }); }
    catch (e) {
      results.push({ name: def.name, status: "error", error: `server boot: ${e.message}`, histogram: null, flounder: null });
      eprint(`  ${red("ERR ")}  ${def.name.padEnd(34)} server-boot-failed`);
      continue;
    }

    const http = makeHttp(server.base);
    let result;
    try {
      result = await runScenario({ scenarioDef: def, http, apiKey: APIKEY, sessionsDir, log: () => {} });
    } catch (e) {
      result = { name: def.name, status: "error", error: `runner threw: ${e.message}`, histogram: null, flounder: null };
    } finally {
      killServer(server.proc);
      try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
    }

    results.push(result);
    if (result.histogram) writeResultJsonl(result);
    runningCost += (result.cost || 0);

    const tag = result.status === "observed" ? green("OBS ")
      : result.status === "fail" ? red("FAIL") : yellow("ERR ");
    const reach = result.histogram
      ? `tools=${result.histogram.total} distinct=${result.histogram.distinctTools} integ=${result.histogram.usedIntegrityCheck ? "Y" : "n"} skill=${result.histogram.usedSkill ? "Y" : "n"}`
      : "";
    const floun = result.flounder?.floundered ? red(`flounder[${result.flounder.reasons.join(",")}]`) : dim("no-flounder");
    eprint(`  ${tag}  ${def.name.padEnd(34)} ${dim(`$${(result.cost || 0).toFixed(4)}`)} ${dim(reach)} ${floun} ${result.error ? red("— " + result.error.slice(0, 80)) : ""}`);

    if (runningCost > BUDGET) { halted = true; eprint(red(`  budget $${BUDGET.toFixed(2)} exceeded ($${runningCost.toFixed(4)}) — halting`)); }
  }

  const observed = results.filter((r) => r.status === "observed").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;

  eprint("");
  eprint(bold("─".repeat(72)));
  eprint(`  ${green(observed + " observed")}, ${red(failed + " safety-failed")}, ${yellow(errored + " errored")}`);
  eprint(`  total cost: $${runningCost.toFixed(4)}  ·  results → tests/discovery/results/`);
  eprint("");

  process.stdout.write(JSON.stringify({
    scenarios: results.map((r) => ({
      name: r.name, status: r.status,
      histogram: r.histogram || null,
      flounder: r.flounder || null,
      turnsUsed: r.turnsUsed || 0, cost: r.cost || 0,
      error: r.error || undefined,
    })),
    summary: { observed, failed, errored, totalCost: Number(runningCost.toFixed(6)), budget: BUDGET },
  }, null, 2) + "\n");

  // Only a SAFETY-floor failure makes discovery exit non-zero. Floundering is
  // recorded, not a failure (observe-only).
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  eprint(red(`unhandled error: ${e?.stack || e?.message || e}`));
  process.exit(2);
});
