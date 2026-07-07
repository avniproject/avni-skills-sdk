#!/usr/bin/env node
// observability-dashboard.mjs — live blessed-contrib dashboard for a session.
//
// Polls /v1/sessions/:id/diagnostics + /cost + /steps every 2s and renders:
//   ┌─ per-agent stats ─┐ ┌─ cost gauge ─────┐
//   │ spec   3 turns…  │ │ $0.43 / $5.00     │
//   │ bundle 5 turns…  │ │ ████████░░░░ 8.6% │
//   └──────────────────┘ └──────────────────┘
//   ┌─ failures ───────┐ ┌─ recent steps ───┐
//   │ schema_errors: 1 │ │ ✓ agent_turn 12s │
//   │ regressions:   1 │ │ ✗ commit       42ms│
//   │ loops:         1 │ │ ✓ session_create…│
//   └──────────────────┘ └──────────────────┘
//
// Designed to live in its OWN terminal window/tab/pane alongside the REPL.
//   npm run dashboard -- --session sess_xxxxxxxxxxxxxxxx
//   npm run dashboard -- --session $SID --port 3030 --refresh 2000
//
// Press q or Ctrl-C to exit. Polling stops cleanly on exit.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// blessed + blessed-contrib are CJS only.
const blessed = require("blessed");
const contrib = require("blessed-contrib");

// ─── Args ───────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

import fs from "node:fs";
import path from "node:path";

const SID = arg("session");
const PORT = Number(arg("port", process.env.PORT || 3030));
const REFRESH_MS = Number(arg("refresh", 2000));
const BASE = `http://localhost:${PORT}`;

// Eval pass-rate + cost panel (story #13). Reads the per-case JSONL the eval
// runner appends when SDK_EVAL_RESULTS_JSONL is set (schema: one line per
// counted case: { runId, model, date, name, category, status, cost, durationMs }).
// API-free: this is a static file written by a prior budgeted eval run, never an
// LLM call. Resolution order: --eval-jsonl arg > SDK_EVAL_RESULTS_JSONL env >
// the conventional tests/eval/out/results.jsonl. Absent/empty → "no eval run yet".
const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EVAL_JSONL = arg("eval-jsonl",
  process.env.SDK_EVAL_RESULTS_JSONL || path.join(SDK_DIR, "tests", "eval", "out", "results.jsonl"));

if (!SID || !/^sess_[0-9a-f]{16}$/.test(SID)) {
  console.error(`
usage: node scripts/observability-dashboard.mjs --session <sess_xxxxxxxxxxxxxxxx> [--port 3030] [--refresh 2000]

Live dashboard for a session. Run in a separate terminal window/tab alongside
the REPL. Press q or Ctrl-C to exit.
`);
  process.exit(2);
}

// ─── Screen + grid layout ───────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: `avni-skills-sdk · ${SID.slice(0, 12)}…`,
});

const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// Top-left (6 cols × 6 rows): per-agent table
const agentTable = grid.set(0, 0, 6, 6, contrib.table, {
  keys: false,
  label: " per-agent ",
  columnSpacing: 2,
  // Tight widths so the table fits in narrow tmux panes (~40-60 cols).
  // (schema_error column retired in #11 — the relay it counted is gone.)
  columnWidth: [12, 5, 4, 6, 8],
  fg: "white",
  selectedFg: "white",
  selectedBg: "blue",
  interactive: false,
});

// Top-right (6 cols × 3 rows): cost gauge
const costGauge = grid.set(0, 6, 3, 6, contrib.gauge, {
  label: " wallet ",
  stroke: "green",
  fill: "white",
});

// Mid-right (6 cols × 3 rows): summary text.
// Use blessed.box (not contrib.log) so setContent REPLACES on each refresh
// rather than appending — otherwise the same lines pile up every 2s and the
// pane becomes unreadable. tags:true so {bold}/{red-fg} render styled.
const summaryBox = grid.set(3, 6, 3, 6, blessed.box, {
  label: " session ",
  tags: true,
  style: { fg: "cyan", border: { fg: "cyan" } },
  border: { type: "line" },
  padding: { left: 1, right: 1 },
});

// Bottom-left (6 cols × 6 rows): failures.
// Use a plain text box (not contrib.bar) — bar chart in a narrow pane
// overlays the value text on top of the label and corrupts both. A simple
// "label: count" listing is more readable AND highlights non-zero categories.
const failuresBox = grid.set(6, 0, 6, 6, blessed.box, {
  label: " failures ",
  tags: true,
  style: { fg: "white", border: { fg: "white" } },
  border: { type: "line" },
  padding: { left: 1, right: 1 },
});

// Bottom-right, top half (6 cols × 3 rows): recent steps tail.
// tags:true so the {gray-fg}/{green-fg}/{red-fg} icons render styled.
const stepsLog = grid.set(6, 6, 3, 6, contrib.log, {
  label: " recent steps ",
  tags: true,
  fg: "white",
  selectedFg: "white",
  bufferLength: 200,
});

// Bottom-right, bottom half (6 cols × 3 rows): eval pass-rate + cost panel.
// Static read of the eval results JSONL (story #13) — API-free.
const evalBox = grid.set(9, 6, 3, 6, blessed.box, {
  label: " eval ",
  tags: true,
  style: { fg: "white", border: { fg: "white" } },
  border: { type: "line" },
  padding: { left: 1, right: 1 },
});

// ─── Polling + rendering ────────────────────────────────────────────
let lastStepCount = 0;
let pollHandle = null;

async function fetchJson(p) {
  try {
    const r = await fetch(BASE + p);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function fmtUsd(n) { return "$" + (n || 0).toFixed(4); }
function fmtMs(n) { return n == null ? "?" : `${n}ms`; }
function pad(s, w) { s = String(s); return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length); }

// ─── Eval results reader (story #13) — API-free, static file ─────────
// Parses the JSONL and returns, for the LATEST release, per-model
// { pass, total, cost }, plus how many releases the file holds. Returns null
// when the file is absent/empty/unparseable (caller shows "no eval run yet").
function readEvalResults(jsonlPath) {
  let raw;
  try { raw = fs.readFileSync(jsonlPath, "utf8"); } catch { return null; }
  const rows = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  if (rows.length === 0) return null;

  // A "release" = one runId (fallback to date). Pick the latest by date then runId.
  const releaseKey = (r) => r.runId || r.date || "unknown";
  const releases = [...new Set(rows.map(releaseKey))];
  const sortStr = (r) => `${r.date || ""}|${r.runId || ""}`;
  const latestRow = rows.reduce((a, b) => (sortStr(b) > sortStr(a) ? b : a), rows[0]);
  const latestKey = releaseKey(latestRow);
  const latestRows = rows.filter((r) => releaseKey(r) === latestKey);

  const byModel = {};
  for (const r of latestRows) {
    const m = r.model || "unspecified";
    if (!byModel[m]) byModel[m] = { pass: 0, total: 0, cost: 0 };
    byModel[m].total += 1;
    if (r.status === "pass") byModel[m].pass += 1;
    byModel[m].cost += r.cost || 0;
  }
  return {
    latestKey,
    latestDate: latestRow.date || null,
    releaseCount: releases.length,
    byModel,
  };
}

async function refresh() {
  const [diag, cost, steps] = await Promise.all([
    fetchJson(`/v1/sessions/${SID}/diagnostics`),
    fetchJson(`/v1/sessions/${SID}/cost`),
    fetchJson(`/v1/sessions/${SID}/steps?limit=20`),
  ]);

  // ── Summary box (top-right text). setContent REPLACES, doesn't append.
  if (!diag) {
    summaryBox.setContent(
      `{red-fg}server unreachable{/}\n` +
      `  @ ${BASE}\n\n` +
      `  start the REPL with\n` +
      `  {bold}npm start{/} in the\n` +
      `  left pane.`
    );
  } else {
    const s = diag.summary;
    summaryBox.setContent(
      `{bold}${SID}{/}\n` +
      `turns:  ${s.totalTurns}\n` +
      `cost:   ${fmtUsd(s.totalCostUsd)} / $${s.wallet.capUsd.toFixed(2)}\n` +
      `tokens: in ${s.wallet.byAgent ? Object.values(s.wallet.byAgent).reduce((a, x) => a + (x.inputTokens || 0), 0) : 0} · out ${s.wallet.byAgent ? Object.values(s.wallet.byAgent).reduce((a, x) => a + (x.outputTokens || 0), 0) : 0}\n` +
      `\n{gray-fg}refresh ${REFRESH_MS}ms · press q to exit{/}`
    );
  }

  // ── Per-agent stats table
  if (diag?.summary?.byAgent) {
    const rows = diag.summary.byAgent.map((a) => [
      a.agent,
      String(a.turns),
      String(a.ok),
      String(a.aborted || 0),
      fmtUsd(a.cost_usd),
    ]);
    if (rows.length === 0) rows.push(["(no agent turns yet)", "", "", "", ""]);
    agentTable.setData({
      headers: ["agent", "turns", "ok", "abort", "cost"],
      data: rows,
    });
  }

  // ── Cost gauge
  if (cost) {
    const pct = cost.caps?.hardCapUsd ? (cost.totalUsd / cost.caps.hardCapUsd) * 100 : 0;
    costGauge.setPercent(Math.min(100, Math.round(pct)));
    costGauge.setLabel(` wallet · ${fmtUsd(cost.totalUsd)} / $${cost.caps.hardCapUsd.toFixed(2)} (${pct.toFixed(1)}%) `);
  }

  // ── Failures text listing — non-zero categories highlighted red.
  if (diag?.failures) {
    const f = diag.failures;
    // (schema_errors category retired in #11.) Guard each with `|| []` so a
    // future route trim can never crash the panel.
    const items = [
      ["circuit breaks",    (f.circuitBreaks || []).length],
      ["agent errors",      (f.agentErrors || []).length],
      ["validator regress", (f.validatorRegressions || []).length],
      ["integrity issues",  (f.integrityIssues || []).length],
      ["semantic failures", (f.semanticFailures || []).length],
      ["ambiguity loops",   (f.ambiguityLoops || []).length],
    ];
    const lines = items.map(([label, n]) => {
      const tag = n > 0 ? `{red-fg}{bold}${String(n).padStart(3)}{/}` : `{gray-fg}${String(n).padStart(3)}{/}`;
      return `${tag}  ${label}`;
    });
    const total = items.reduce((a, [, n]) => a + n, 0);
    lines.unshift(total > 0 ? `{red-fg}${total} total failure(s){/}` : `{green-fg}no failures yet{/}`);
    lines.splice(1, 0, "");
    failuresBox.setContent(lines.join("\n"));
  }

  // ── Eval pass-rate + cost panel (static JSONL read; API-free).
  {
    const ev = readEvalResults(EVAL_JSONL);
    if (!ev) {
      evalBox.setContent(
        `{gray-fg}no eval run yet{/}\n\n` +
        `  looked in:\n` +
        `  {gray-fg}${EVAL_JSONL.replace(SDK_DIR + "/", "")}{/}\n\n` +
        `  run a budgeted sweep with\n` +
        `  {bold}SDK_EVAL_RESULTS_JSONL=<path> npm run eval{/}`
      );
    } else {
      const models = Object.entries(ev.byModel).sort((a, b) => a[0].localeCompare(b[0]));
      let tPass = 0, tTotal = 0, tCost = 0;
      const lines = [
        `{bold}latest run{/} ${ev.latestDate || ev.latestKey}` +
          (ev.releaseCount > 1 ? ` {gray-fg}(+${ev.releaseCount - 1} older){/}` : ""),
        "",
      ];
      for (const [m, s] of models) {
        tPass += s.pass; tTotal += s.total; tCost += s.cost;
        const pct = s.total ? Math.round((s.pass / s.total) * 100) : 0;
        const tag = pct === 100 ? "{green-fg}" : pct >= 70 ? "{yellow-fg}" : "{red-fg}";
        const label = m.replace(/^claude-/, "");
        lines.push(`${tag}${String(s.pass)}/${String(s.total)} ${String(pct).padStart(3)}%{/}  ${pad(label, 20)} ${fmtUsd(s.cost)}`);
      }
      const tPct = tTotal ? Math.round((tPass / tTotal) * 100) : 0;
      lines.push("");
      lines.push(`{bold}total{/} ${tPass}/${tTotal} (${tPct}%) · ${fmtUsd(tCost)}`);
      evalBox.setContent(lines.join("\n"));
    }
  }

  // ── Steps log (tail only the new entries since last poll). Tight format
  // for narrow tmux panes: HH:MM:SS · icon · kind · duration.
  if (steps?.steps) {
    const list = steps.steps;
    const newOnes = list.slice(lastStepCount);
    for (const s of newOnes) {
      const ts = (s.ts || "").replace("T", " ").slice(11, 19);
      const icon = s.status === "ok" ? "{green-fg}✓{/}" :
                   s.status === "error" ? "{red-fg}✗{/}" :
                   s.status === "aborted" ? "{yellow-fg}!{/}" :
                   s.status === "schema_error" ? "{red-fg}{bold}!{/}" :
                   "{cyan-fg}·{/}";
      stepsLog.log(`{gray-fg}${ts}{/} ${icon} ${pad(s.kind, 12)} ${pad(fmtMs(s.duration_ms), 7)}`);
    }
    lastStepCount = list.length;
  }

  screen.render();
}

// ─── Exit handling ──────────────────────────────────────────────────
function shutdown() {
  if (pollHandle) clearInterval(pollHandle);
  screen.destroy();
  process.exit(0);
}
screen.key(["q", "C-c"], shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// First render + start polling.
refresh().then(() => {
  pollHandle = setInterval(refresh, REFRESH_MS);
  screen.render();
});
