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
  label: " per-agent ",
  columnSpacing: 2,
  // Tight widths so the table fits in narrow tmux panes (~40-60 cols).
  columnWidth: [12, 5, 4, 6, 5, 8],
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

// Bottom-right (6 cols × 6 rows): recent steps tail.
// tags:true so the {gray-fg}/{green-fg}/{red-fg} icons render styled.
const stepsLog = grid.set(6, 6, 6, 6, contrib.log, {
  label: " recent steps ",
  tags: true,
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

  // ── Failures text listing — non-zero categories highlighted red.
  if (diag?.failures) {
    const f = diag.failures;
    const items = [
      ["schema errors",     f.schemaErrors.length],
      ["circuit breaks",    f.circuitBreaks.length],
      ["agent errors",      f.agentErrors.length],
      ["validator regress", f.validatorRegressions.length],
      ["integrity issues",  f.integrityIssues.length],
      ["semantic failures", f.semanticFailures.length],
      ["ambiguity loops",   f.ambiguityLoops.length],
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
