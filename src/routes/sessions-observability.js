// Memory + observability endpoints — JSONL readers + multi-agent diagnostics.
//   GET /v1/sessions/:id/transcript
//   GET /v1/sessions/:id/steps
//   GET /v1/sessions/:id/cost
//   GET /v1/sessions/:id/diagnostics
//
// All three JSONL files live at <session-dir>/{transcript,steps,cost}.jsonl,
// written by src/transcript.js, src/steplog.js, src/wallet.js.

import * as sessions from "../sessions.js";
import * as wallet from "../wallet.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";

export function register(app) {
  app.get("/v1/sessions/:id/transcript", (req, res) => {
    try {
      sessions.getSession(req.params.id); // 404 if session unknown
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const kinds = req.query.kinds ? String(req.query.kinds).split(",") : undefined;
      const events = transcript.readTranscript(req.params.id, { limit, kinds });
      res.json({ sessionId: req.params.id, count: events.length, events });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.get("/v1/sessions/:id/steps", (req, res) => {
    try {
      sessions.getSession(req.params.id);
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const kinds = req.query.kinds ? String(req.query.kinds).split(",") : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const steps = steplog.readSteps(req.params.id, { limit, kinds, status });
      const stats = steplog.stepStats(req.params.id);
      res.json({ sessionId: req.params.id, count: steps.length, stats, steps });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.get("/v1/sessions/:id/cost", (req, res) => {
    try {
      sessions.getSession(req.params.id);
      const w = wallet.getWallet(req.params.id);
      res.json({ sessionId: req.params.id, ...w });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  // GET /v1/sessions/:id/diagnostics
  //
  // Multi-agent failure-mode visibility. Walks transcript.jsonl + steps.jsonl
  // + cost.jsonl and surfaces *exactly* where the loop is failing. Designed
  // to answer "what broke and on which agent" without grep+jq pipelines.
  //
  // Reports six classes of failure:
  //   1. schema_errors        — agent didn't end with valid AGENT_OUTPUT_SCHEMA JSON
  //   2. circuit_breaks       — wallet aborted a turn mid-stream (events / cost / cap)
  //   3. agent_errors         — runAgent threw (network, API, timeout)
  //   4. validator_regressions — agent's edits made the validator state WORSE
  //   5. integrity_issues     — apply-spec found dangling references
  //   6. semantic_failures    — applied_fix with no changes; ask_user with no
  //                              ambiguities (semantic-guard violations)
  //
  // Plus aggregate breakdowns: per-agent turn counts, per-agent cost,
  // per-agent average duration, ambiguity-loop detection (consecutive
  // ask_user turns from the same agent).
  app.get("/v1/sessions/:id/diagnostics", (req, res) => {
    try {
      sessions.getSession(req.params.id);

      const turnCommits = transcript.readTranscript(req.params.id, { kinds: ["turn_commit"] });
      const steps = steplog.readSteps(req.params.id);
      const w = wallet.getWallet(req.params.id);

      // ── Per-agent aggregates
      const byAgent = {};
      for (const e of turnCommits) {
        const a = e.agent || e.source || "unspecified";
        if (!byAgent[a]) byAgent[a] = {
          agent: a, turns: 0,
          ok: 0, schema_error: 0, aborted: 0, error: 0,
          cost_usd: 0, input_tokens: 0, output_tokens: 0,
        };
        byAgent[a].turns += 1;
        byAgent[a].cost_usd += e.cost_usd || 0;
        byAgent[a].input_tokens += e.tokens?.in || 0;
        byAgent[a].output_tokens += e.tokens?.out || 0;
        if (e.aborted) byAgent[a].aborted += 1;
        else if ((e.schemaErrors || []).length > 0) byAgent[a].schema_error += 1;
        else byAgent[a].ok += 1;
      }
      for (const a of Object.values(byAgent)) a.cost_usd = Number(a.cost_usd.toFixed(6));

      // ── Failure category 1: schema_errors
      const schemaErrors = turnCommits
        .filter((e) => (e.schemaErrors || []).length > 0)
        .map((e) => ({
          turn: e.turn,
          agent: e.agent || e.source,
          errors: e.schemaErrors,
          ts: e.ts,
        }));

      // ── Failure category 2: circuit_breaks
      const circuitBreaks = turnCommits
        .filter((e) => e.aborted)
        .map((e) => ({
          turn: e.turn,
          agent: e.agent || e.source,
          reason: e.abortReason,
          cost_usd: e.cost_usd,
          ts: e.ts,
        }));

      // ── Failure category 3: agent_errors (from step log)
      const agentErrors = steps
        .filter((s) => s.kind === "agent_turn" && s.status === "error")
        .map((s) => ({
          turn: s.meta?.turn,
          agent: s.meta?.agent,
          error: s.error,
          duration_ms: s.duration_ms,
          ts: s.ts,
        }));

      // ── Failure category 4: validator_regressions
      // Compare validation.errors across consecutive turn_commits. A regression
      // is when a turn's validation state has MORE errors than the previous turn's.
      const validatorRegressions = [];
      for (let i = 1; i < turnCommits.length; i++) {
        const prev = turnCommits[i - 1];
        const curr = turnCommits[i];
        const prevErrors = prev.validation?.errors || 0;
        const currErrors = curr.validation?.errors || 0;
        if (currErrors > prevErrors) {
          validatorRegressions.push({
            turn: curr.turn,
            agent: curr.agent || curr.source,
            before: { errors: prevErrors, warnings: prev.validation?.warnings || 0 },
            after: { errors: currErrors, warnings: curr.validation?.warnings || 0 },
            delta: currErrors - prevErrors,
            ts: curr.ts,
          });
        }
      }

      // ── Failure category 5: integrity_issues (from apply-spec turns)
      const integrityIssues = turnCommits
        .filter((e) => e.integrity && !e.integrity.ok)
        .map((e) => ({
          turn: e.turn,
          agent: e.agent || e.source,
          issues: (e.integrity.issues || []).slice(0, 10),
          ts: e.ts,
        }));

      // ── Failure category 6: semantic_failures
      // The schema validator catches these as schema errors, but also surface
      // them separately so operators can spot agent-prompt regressions.
      const semanticFailures = [];
      for (const e of turnCommits) {
        const s = e.structured;
        if (!s) continue;
        if (s.intent === "applied_fix" && (!s.applied_changes || s.applied_changes.length === 0)) {
          semanticFailures.push({
            turn: e.turn, agent: e.agent || e.source,
            type: "applied_fix_with_no_changes",
            ts: e.ts,
          });
        }
        if (s.intent === "ask_user" && (!s.ambiguities || s.ambiguities.length === 0)) {
          semanticFailures.push({
            turn: e.turn, agent: e.agent || e.source,
            type: "ask_user_with_no_ambiguities",
            ts: e.ts,
          });
        }
      }

      // ── Ambiguity loop detection — N consecutive ask_user from same agent
      const ambiguityLoops = [];
      let runStart = -1;
      let runAgent = null;
      for (let i = 0; i <= turnCommits.length; i++) {
        const e = turnCommits[i];
        const isAsk = e?.structured?.intent === "ask_user";
        const a = e?.agent || e?.source;
        if (isAsk && a === runAgent) continue;          // extending current run
        if (isAsk && a !== runAgent) {                  // start of new run
          if (runStart >= 0 && i - runStart >= 3) {
            ambiguityLoops.push({
              agent: runAgent, turns: i - runStart,
              fromTurn: turnCommits[runStart].turn,
              toTurn: turnCommits[i - 1].turn,
            });
          }
          runStart = i; runAgent = a;
        } else {
          if (runStart >= 0 && i - runStart >= 3) {
            ambiguityLoops.push({
              agent: runAgent, turns: i - runStart,
              fromTurn: turnCommits[runStart].turn,
              toTurn: turnCommits[i - 1].turn,
            });
          }
          runStart = -1; runAgent = null;
        }
      }

      // ── Step-log durations per agent (p50 + p95 approx)
      const durations = {};
      for (const s of steps.filter((s) => s.kind === "agent_turn" && typeof s.duration_ms === "number")) {
        const a = s.meta?.agent || "unspecified";
        (durations[a] ||= []).push(s.duration_ms);
      }
      const durationStats = {};
      for (const [a, arr] of Object.entries(durations)) {
        arr.sort((x, y) => x - y);
        durationStats[a] = {
          count: arr.length,
          min_ms: arr[0],
          p50_ms: arr[Math.floor(arr.length * 0.5)],
          p95_ms: arr[Math.floor(arr.length * 0.95)] || arr.at(-1),
          max_ms: arr.at(-1),
        };
      }

      res.json({
        sessionId: req.params.id,
        summary: {
          totalTurns: turnCommits.length,
          byAgent: Object.values(byAgent),
          totalCostUsd: w.totalUsd,
          wallet: { totalUsd: w.totalUsd, remainingUsd: w.remainingUsd, capUsd: w.caps.hardCapUsd, byAgent: w.byAgent },
        },
        failures: {
          schemaErrors,
          circuitBreaks,
          agentErrors,
          validatorRegressions,
          integrityIssues,
          semanticFailures,
          ambiguityLoops,
        },
        durations: durationStats,
      });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}
