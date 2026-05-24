# Observability dashboard

**Shipped 2026-05-23 (Phase 6b · WS-dashboard)**

A live blessed-contrib TUI that renders per-agent stats, cost gauge, failure
counts, and a recent-steps tail. Designed to run in its own terminal window
alongside the REPL — so you can watch the multi-agent loop work in real
time without breaking the REPL's flow.

---

## Default: one command, side-by-side (RECOMMENDED)

Needs `tmux` (one-time `brew install tmux` on macOS, `sudo apt install tmux` on Debian).

```bash
npm start                                           # synthetic SRS demo
npm start -- --demo                                  # explicit
npm start -- --forms ./MyOrg-Forms.xlsx --org MyOrg # your own SRS
npm start -- --resume sess_xxxxxxxxxxxxxxxx          # come back to a session
```

This is the tmux-launcher (`scripts/repl-with-dashboard.sh`) bound to `npm start`. Layout: 60% left pane (REPL) + 40% right pane (dashboard). The right pane waits up to 60s for a fresh session to appear under `~/.avni-skills-sdk/sessions/` and auto-attaches.

Detach without quitting: `Ctrl-b d`. Re-attach: `tmux attach -t avni-sdk-<pid>` (the pid is from the launching process).

## Fallback: manual two-terminal (when tmux isn't installed)

`npm start` gracefully degrades — prints instructions and starts the REPL alone. Then:

In **terminal #1**:
```bash
npm run cli -- --demo
# → ✓ session sess_xxxxxxxxxxxxxxxx
```

In **terminal #2**:
```bash
npm run dashboard -- --session sess_xxxxxxxxxxxxxxxx
```

Works in any terminal that supports ANSI (iTerm2, Terminal.app, kitty, wezterm, Warp, etc.). Press `q` or `Ctrl-C` to exit the dashboard.

Layout: 60% left pane (REPL) + 40% right pane (dashboard). The right pane
waits up to 60s for a fresh session to appear under
`~/.avni-skills-sdk/sessions/` and auto-attaches.

Without tmux installed, the script falls back to single-pane mode with
clear instructions for manual two-window use.

---

## What you see

```
┌─ per-agent · turns / status / cost ┐ ┌─ wallet · $0.43 / $5.00 (8.6%) ──┐
│ agent           turns ok schema...  │ │ ████████░░░░░░░░░░░░░░░░░░░░░░░ │
│ spec              3   2    1   ...  │ │                                  │
│ bundle-config     5   5    0   ...  │ └──────────────────────────────────┘
│ review            1   1    0   ...  │ ┌─ session ────────────────────────┐
│                                     │ │ sess_5e471515b041…                │
└─────────────────────────────────────┘ │ turns: 9   cost: $0.43 / $5.00   │
                                       │ refresh: every 2000ms  press q…   │
                                       └──────────────────────────────────┘
┌─ failures by category ──────────────┐ ┌─ recent steps (tail) ─────────────┐
│       █                              │ │ 14:23:08 ✓ agent_turn    8421ms  │
│   █   █                              │ │ 14:23:01 ✓ commit          42ms  │
│ ▄ █ ▄ █ ▄ ▄ ▄                        │ │ 14:22:43 ✓ session_create  18ms  │
│ schema circuit agent regress…       │ │ 14:22:42 · validator_run  120ms  │
└─────────────────────────────────────┘ └──────────────────────────────────┘
```

Panel-by-panel:

- **Top-left — per-agent table.** Rows: one per agent that's run in this
  session. Columns: turns / ok / schema-error / aborted / cost. Adds rows
  as new agents dispatch.
- **Top-right (top) — cost gauge.** Wallet spend as a % of the $5 session
  cap. Green when under 80%, fills to 100% when capped out.
- **Top-right (bottom) — session summary.** Session id + totals +
  refresh-rate hint.
- **Bottom-left — failures bar.** Seven categories from `/diagnostics`:
  `schema_errors`, `circuit_breaks`, `agent_errors`, `validator_regressions`,
  `integrity_issues`, `semantic_failures`, `ambiguity_loops`. Bars grow
  as failures accumulate.
- **Bottom-right — recent steps tail.** Live tail of `steps.jsonl`:
  validator runs, agent turns, commits — with status icon + duration.

---

## Args

```
npm run dashboard -- --session <sid> [--port 3030] [--refresh 2000]
```

| Arg | Default | Notes |
|---|---|---|
| `--session` | (required) | The session id printed by the REPL on create / resume |
| `--port` | `3030` | The SDK server's HTTP port (default `process.env.PORT`) |
| `--refresh` | `2000` (ms) | Polling interval. Lower = more responsive + more HTTP load |

---

## What it polls

Three endpoints, all GET, all rate-tolerant:

```
GET /v1/sessions/:id/diagnostics    full failure-mode breakdown + per-agent
GET /v1/sessions/:id/cost            wallet + per-agent USD slice
GET /v1/sessions/:id/steps?limit=20  tail of steps.jsonl
```

If the server is down or unreachable, the dashboard surfaces `server
unreachable @ http://localhost:3030` in the summary box and keeps polling
— no crash, no exit.

---

## When to use which panel

| Question | Look at |
|---|---|
| "Which agent is doing the most work?" | top-left table — `turns` column |
| "Is the spec agent breaking the contract?" | top-left — `schema` column |
| "How fast am I burning budget?" | top-right gauge |
| "What just failed?" | bottom-left bar (which category went up) → drill into transcript |
| "What's the last 20 things the system did?" | bottom-right tail |

---

## Architecture

```
   REPL (terminal #1)                  Dashboard (terminal #2)
   ─────────────────                   ──────────────────────────
   npm run cli                         npm run dashboard --session $SID
        │                                       │
        ▼                                       ▼
   POST /messages                       fetch every 2000ms:
   POST /apply-spec        ┐             GET /diagnostics
   POST /agent-messages     │             GET /cost
        │                   ▼             GET /steps
        ▼            ┌─ server ─┐                │
   ┌─ session ─┐ ◄──┤ :3030    │ ◄──────────────┘
   │ bundle    │    └──────────┘
   │ transcript│         │
   │ steps     │         ▼
   │ cost      │    each writes to
   └───────────┘    the session's JSONL files
```

Read-only. The dashboard never mutates the bundle, the session, or the
wallet. Polling is fire-and-forget — a failed request just delays the
next refresh by 0ms (the next interval still fires).
