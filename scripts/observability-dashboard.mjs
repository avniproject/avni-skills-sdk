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

const SID = arg("session");
const PORT = Number(arg("port", process.env.PORT || 3030));
const REFRESH_MS = Number(arg("refresh", 2000));
const BASE = `http://localhost:${PORT}`;

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
  label: " per-agent · turns / status / cost ",
  columnSpacing: 2,
  columnWidth: [16, 6, 6, 6, 6, 9],
  fg: "white",
  selectedFg: "white",
  selectedBg: "blue",
  interactive: false,
});

// Top-right (6 cols × 3 rows): cost gauge
const costGauge = grid.set(0, 6, 3, 6, contrib.gauge, {
  label: " wallet · % of $5 cap consumed ",
  stroke: "green",
  fill: "white",
});

// Mid-right (6 cols × 3 rows): summary text
const summaryBox = grid.set(3, 6, 3, 6, contrib.log, {
  label: " session ",
  fg: "cyan",
  selectedFg: "cyan",
  bufferLength: 50,
});

// Bottom-left (6 cols × 6 rows): failures by category
const failureBar = grid.set(6, 0, 6, 6, contrib.bar, {
  label: " failures by category ",
  barWidth: 5,
  barSpacing: 4,
  xOffset: 2,
  maxHeight: 9,
  barBgColor: "red",
});

// Bottom-right (6 cols × 6 rows): recent steps tail
const stepsLog = grid.set(6, 6, 6, 6, contrib.log, {
  label: " recent steps (steps.jsonl tail) ",
  fg: "white",
  selectedFg: "white",
  bufferLength: 200,
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

async function refresh() {
  const [diag, cost, steps] = await Promise.all([
    fetchJson(`/v1/sessions/${SID}/diagnostics`),
    fetchJson(`/v1/sessions/${SID}/cost`),
    fetchJson(`/v1/sessions/${SID}/steps?limit=20`),
  ]);

  // ── Summary box (top-right text)
  summaryBox.setContent("");
  if (!diag) {
    summaryBox.log(`{red-fg}server unreachable @ ${BASE}{/}`);
  } else {
    const s = diag.summary;
    summaryBox.log(`{bold}${SID.slice(0, 16)}{/}…`);
    summaryBox.log(`turns: ${s.totalTurns}   cost: ${fmtUsd(s.totalCostUsd)} / $${s.wallet.capUsd.toFixed(2)}`);
    summaryBox.log(`refresh: every ${REFRESH_MS}ms     press q to exit`);
  }

  // ── Per-agent stats table
  if (diag?.summary?.byAgent) {
    const rows = diag.summary.byAgent.map((a) => [
      a.agent,
      String(a.turns),
      String(a.ok),
      String(a.schema_error || 0),
      String(a.aborted || 0),
      fmtUsd(a.cost_usd),
    ]);
    if (rows.length === 0) rows.push(["(no agent turns yet)", "", "", "", "", ""]);
    agentTable.setData({
      headers: ["agent", "turns", "ok", "schema", "abort", "cost"],
      data: rows,
    });
  }

  // ── Cost gauge
  if (cost) {
    const pct = cost.caps?.hardCapUsd ? (cost.totalUsd / cost.caps.hardCapUsd) * 100 : 0;
    costGauge.setPercent(Math.min(100, Math.round(pct)));
    costGauge.setLabel(` wallet · ${fmtUsd(cost.totalUsd)} / $${cost.caps.hardCapUsd.toFixed(2)} (${pct.toFixed(1)}%) `);
  }

  // ── Failures bar
  if (diag?.failures) {
    const f = diag.failures;
    failureBar.setData({
      titles: ["schema", "circuit", "agent.err", "regress", "integ", "semantic", "loops"],
      data: [
        f.schemaErrors.length,
        f.circuitBreaks.length,
        f.agentErrors.length,
        f.validatorRegressions.length,
        f.integrityIssues.length,
        f.semanticFailures.length,
        f.ambiguityLoops.length,
      ],
    });
  }

  // ── Steps log (tail only the new entries since last poll)
  if (steps?.steps) {
    const list = steps.steps;
    const newOnes = list.slice(lastStepCount);
    for (const s of newOnes) {
      const ts = (s.ts || "").replace("T", " ").slice(11, 19);
      const icon = s.status === "ok" ? "{green-fg}✓{/}" :
                   s.status === "error" ? "{red-fg}✗{/}" :
                   s.status === "aborted" ? "{yellow-fg}!{/}" :
                   s.status === "schema_error" ? "{red-fg}{bold}✗{/}" :
                   "{cyan-fg}·{/}";
      const meta = s.meta ? Object.entries(s.meta).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(" ") : "";
      stepsLog.log(`{gray-fg}${ts}{/} ${icon} ${pad(s.kind, 14)} ${pad(fmtMs(s.duration_ms), 7)} {gray-fg}${meta}{/}`);
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
