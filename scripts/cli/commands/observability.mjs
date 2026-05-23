// commands/observability.mjs — read-only views over the per-session JSONL
// surfaces wired in Phase 5a + Phase 6:
//   :transcript [N]   conversation memory (user/assistant/turn events)
//   :steps [N]        operational log (validator/workflow/agent-turn durations)
//   :cost              wallet snapshot + per-agent breakdown
//   :changes [N]       semantic per-file diff for turn N (default = last)
//   :diag              multi-agent failure visibility — schema breaks,
//                       circuit-breaks, validator regressions, etc.

import { bold, cyan, dim, green, red, yellow } from "../ui.mjs";

export function makeObservabilityCommands({ http }) {
  const { getJson } = http;

  async function cmdTranscript(sid, limitArg) {
    const limit = limitArg ? Math.max(1, Number(limitArg)) : 20;
    const data = await getJson(`/v1/sessions/${sid}/transcript?limit=${limit}`);
    if (!data.events || data.events.length === 0) {
      console.log(dim("  (no transcript events yet)"));
      return;
    }
    console.log(dim(`  showing last ${data.events.length} of ${data.count} event(s)`));
    for (const ev of data.events) {
      const ts = (ev.ts || "").replace("T", " ").replace(/\.\d+Z$/, "Z");
      const kind = ev.kind.padEnd(18);
      let detail = "";
      if (ev.kind === "user_message") detail = (ev.content || "").slice(0, 80);
      else if (ev.kind === "turn_commit") detail = `turn ${ev.turn} sha=${(ev.sha || "").slice(0, 8)} cost=$${(ev.cost_usd ?? 0).toFixed(4)} — ${(ev.summary || "").slice(0, 50)}`;
      else if (ev.kind === "system") detail = ev.action || "";
      else if (ev.kind === "assistant_message") detail = (ev.content || "").slice(0, 80);
      console.log(`  ${dim(ts)}  ${cyan(kind)} ${dim(detail)}`);
    }
  }

  async function cmdSteps(sid, limitArg) {
    const limit = limitArg ? Math.max(1, Number(limitArg)) : 20;
    const data = await getJson(`/v1/sessions/${sid}/steps?limit=${limit}`);
    if (!data.steps || data.steps.length === 0) {
      console.log(dim("  (no operational steps logged yet)"));
      return;
    }
    console.log(dim(`  showing last ${data.steps.length} of ${data.count} step(s); ${data.stats?.errors || 0} errors total`));
    for (const s of data.steps) {
      const ts = (s.ts || "").replace("T", " ").replace(/\.\d+Z$/, "Z");
      const statusIcon = s.status === "ok" ? green("✓") : s.status === "error" ? red("✗") : yellow("!");
      const ms = s.duration_ms != null ? `${s.duration_ms}ms` : "";
      const metaStr = s.meta ? Object.entries(s.meta).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(" ") : "";
      console.log(`  ${dim(ts)}  ${statusIcon} ${cyan(s.kind.padEnd(15))} ${dim(ms.padEnd(8))} ${dim(metaStr)}`);
    }
    if (data.stats?.avgMs) {
      console.log(dim("  avg ms by kind: " + Object.entries(data.stats.avgMs).map(([k, v]) => `${k}=${v}`).join("  ")));
    }
  }

  async function cmdCost(sid) {
    const w = await getJson(`/v1/sessions/${sid}/cost`);
    const pct = w.caps?.hardCapUsd ? (w.totalUsd / w.caps.hardCapUsd) * 100 : 0;
    console.log(`  ${dim("total spent")}   ${cyan("$" + w.totalUsd.toFixed(4))} ${dim(`of $${w.caps.hardCapUsd.toFixed(2)} cap`)} (${pct.toFixed(1)}%)`);
    console.log(`  ${dim("remaining")}     ${cyan("$" + w.remainingUsd.toFixed(4))}`);
    console.log(`  ${dim("turns recorded")} ${cyan(String(w.turnCount))}`);
    console.log(`  ${dim("input tokens")}  ${cyan(String(w.totalInputTokens))}`);
    console.log(`  ${dim("output tokens")} ${cyan(String(w.totalOutputTokens))}`);
    if (w.byAgent && Object.keys(w.byAgent).length > 0) {
      console.log("");
      console.log(dim("  per-agent breakdown:"));
      const rows = Object.entries(w.byAgent).sort(([, a], [, b]) => b.usd - a.usd);
      for (const [agent, r] of rows) {
        const pctAgent = w.totalUsd ? (r.usd / w.totalUsd) * 100 : 0;
        console.log(`    ${cyan(agent.padEnd(20))} ${dim("$")}${r.usd.toFixed(4).padStart(8)} ${dim("·")} ${String(r.turns).padStart(3)} turns ${dim("·")} ${pctAgent.toFixed(1).padStart(5)}%`);
      }
    }
    if (pct > 80) console.log(yellow(`  ⚠ ${pct.toFixed(0)}% of cap consumed — reset via POST /v1/sessions/${sid}/wallet/reset to continue.`));
  }

  async function cmdChanges(sid, turnArg) {
    const data = await getJson(`/v1/sessions/${sid}/transcript?kinds=turn_commit&limit=20`);
    const events = data.events || [];
    if (events.length === 0) {
      console.log(dim("  (no commits yet in this session)"));
      return;
    }
    let target;
    if (turnArg) {
      const n = Number(turnArg);
      target = events.find((e) => e.turn === n);
      if (!target) { console.log(red("  no transcript event for turn " + n)); return; }
    } else {
      target = events[events.length - 1];
    }
    console.log("  turn " + cyan(String(target.turn)) +
                " · " + dim(target.source || "?") +
                " · sha=" + dim((target.sha || "").slice(0, 8)));
    if (target.summary) console.log(dim("  summary: ") + target.summary);
    if (target.diff && Object.keys(target.diff).length > 0) {
      for (const [file, ops] of Object.entries(target.diff)) {
        const a = ops.added?.length || 0;
        const u = ops.updated?.length || 0;
        const r = ops.removed?.length || 0;
        console.log("  " + cyan(file) + ":  +" + a + "  ~" + u + "  -" + r);
        for (const e of (ops.added || []).slice(0, 5)) console.log("    " + green("+") + " " + (e.name || e.uuid));
        for (const e of (ops.updated || []).slice(0, 5)) {
          const fields = e.fields?.length ? dim(" (" + e.fields.slice(0, 3).join(",") + ")") : "";
          console.log("    " + yellow("~") + " " + (e.name || e.uuid) + fields);
        }
      }
    } else if (target.filesChanged?.length) {
      console.log(dim("  files changed (no structured diff captured):"));
      for (const f of target.filesChanged) console.log("    " + cyan(f));
    } else {
      console.log(dim("  (no file changes recorded)"));
    }
    if (target.integrity && !target.integrity.ok) {
      console.log(red("  integrity issues:"));
      for (const i of target.integrity.issues.slice(0, 5)) {
        console.log("    " + (i.severity === "error" ? red("✗") : yellow("!")) + " " + i.message);
      }
    }
  }

  async function cmdDiag(sid) {
    const d = await getJson(`/v1/sessions/${sid}/diagnostics`);
    const s = d.summary;
    const f = d.failures;

    console.log(dim("═══ summary ═══"));
    console.log(`  total turns:    ${cyan(String(s.totalTurns))}`);
    console.log(`  total cost:     ${cyan("$" + s.totalCostUsd.toFixed(4))} ${dim("of $" + s.wallet.capUsd.toFixed(2) + " cap")}`);
    if (s.byAgent.length > 0) {
      console.log(dim("  by agent:"));
      for (const a of s.byAgent) {
        const status = `${green(a.ok + "ok")}/${a.schema_error ? red(a.schema_error + "schema") : dim("0schema")}/${a.aborted ? yellow(a.aborted + "abort") : dim("0abort")}/${a.error ? red(a.error + "err") : dim("0err")}`;
        console.log(`    ${cyan(a.agent.padEnd(20))} ${String(a.turns).padStart(3)} turns · ${status} · $${a.cost_usd.toFixed(4)}`);
      }
    }
    console.log("");

    const total = (arr) => arr.length;
    const sum = total(f.schemaErrors) + total(f.circuitBreaks) + total(f.agentErrors) +
                total(f.validatorRegressions) + total(f.integrityIssues) + total(f.semanticFailures) + total(f.ambiguityLoops);
    if (sum === 0) {
      console.log(green("  ✓ no failures detected across the session"));
      return;
    }

    console.log(red("═══ failures ═══"));

    if (f.schemaErrors.length) {
      console.log(red(`  schema_errors (${f.schemaErrors.length}):`));
      for (const e of f.schemaErrors.slice(0, 5)) {
        console.log(`    ${red("✗")} turn ${e.turn} · ${cyan(e.agent)} · ${e.errors[0] || "(no message)"}`);
      }
    }
    if (f.circuitBreaks.length) {
      console.log(yellow(`  circuit_breaks (${f.circuitBreaks.length}):`));
      for (const e of f.circuitBreaks.slice(0, 5)) {
        console.log(`    ${yellow("!")} turn ${e.turn} · ${cyan(e.agent)} · ${e.reason} · $${(e.cost_usd || 0).toFixed(4)}`);
      }
    }
    if (f.agentErrors.length) {
      console.log(red(`  agent_errors (${f.agentErrors.length}):`));
      for (const e of f.agentErrors.slice(0, 5)) {
        console.log(`    ${red("✗")} turn ${e.turn} · ${cyan(e.agent)} · ${(e.error || "").slice(0, 80)}`);
      }
    }
    if (f.validatorRegressions.length) {
      console.log(red(`  validator_regressions (${f.validatorRegressions.length}):`));
      for (const e of f.validatorRegressions.slice(0, 5)) {
        console.log(`    ${red("↑")} turn ${e.turn} · ${cyan(e.agent)} · errors ${e.before.errors} → ${e.after.errors} (Δ +${e.delta})`);
      }
    }
    if (f.integrityIssues.length) {
      console.log(red(`  integrity_issues (${f.integrityIssues.length}):`));
      for (const e of f.integrityIssues.slice(0, 5)) {
        console.log(`    ${red("✗")} turn ${e.turn} · ${cyan(e.agent)} · ${e.issues.length} dangling refs`);
        for (const i of e.issues.slice(0, 2)) console.log(`       ${dim(i.message || i.field || "")}`);
      }
    }
    if (f.semanticFailures.length) {
      console.log(yellow(`  semantic_failures (${f.semanticFailures.length}):`));
      for (const e of f.semanticFailures.slice(0, 5)) {
        console.log(`    ${yellow("!")} turn ${e.turn} · ${cyan(e.agent)} · ${e.type}`);
      }
    }
    if (f.ambiguityLoops.length) {
      console.log(yellow(`  ambiguity_loops (${f.ambiguityLoops.length}):`));
      for (const l of f.ambiguityLoops.slice(0, 5)) {
        console.log(`    ${yellow("⟳")} ${cyan(l.agent)} · ${l.turns} consecutive ask_user (turn ${l.fromTurn} → ${l.toTurn})`);
      }
    }

    if (Object.keys(d.durations || {}).length > 0) {
      console.log("");
      console.log(dim("  durations (ms):"));
      for (const [agent, st] of Object.entries(d.durations)) {
        console.log(`    ${cyan(agent.padEnd(20))} count=${st.count} · p50=${st.p50_ms} · p95=${st.p95_ms} · max=${st.max_ms}`);
      }
    }
  }

  return { cmdTranscript, cmdSteps, cmdCost, cmdChanges, cmdDiag };
}
