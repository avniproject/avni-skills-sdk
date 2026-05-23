// Multi-agent live dispatch (WS5 endpoint).
//   POST /v1/sessions/:id/agent-messages    body: { agent, prompt, model? }
// Routes the prompt to one of the three structured-output agents
// (spec / bundle-config / review) per src/agents/. Each agent's response
// MUST end with a fenced ```json``` block matching AGENT_OUTPUT_SCHEMA;
// the server parses + validates the contract after the stream ends.
// Schema-broken responses still commit any workspace changes the agent
// made — the agent may have done useful work even when the contract is
// broken (surfaced as `structured_output_error` SSE event).

import * as sessions from "../sessions.js";
import * as wallet from "../wallet.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";
import { runAgent } from "../agent.js";
import { routePrompt } from "../router.js";
import { AGENTS_BY_NAME, listAgentNames } from "../agents/index.js";
import { parseAgentOutput, validateAgentOutput } from "../agent-output-schema.js";

export function register(app) {
  app.post("/v1/sessions/:id/agent-messages", async (req, res) => {
    const auth = req.headers.authorization || "";
    const am = auth.match(/^Bearer\s+(.+)$/);
    if (!am) return res.status(401).json({ error: "Authorization: Bearer <ANTHROPIC_API_KEY> required" });
    const apiKey = am[1].trim();

    const { agent: agentName, prompt, model } = req.body || {};
    if (!agentName || typeof agentName !== "string") {
      return res.status(400).json({ error: "agent (string) required — one of: " + listAgentNames().join(", ") });
    }
    const agentCfg = AGENTS_BY_NAME[agentName];
    if (!agentCfg) {
      return res.status(400).json({ error: `unknown agent "${agentName}" — must be one of: ${listAgentNames().join(", ")}` });
    }
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt (string) required" });
    }

    let bundleCwd;
    try {
      bundleCwd = sessions.bundleDir(req.params.id);
      sessions.ensureSessionSkillsStaged(req.params.id);
    } catch (e) {
      return res.status(404).json({ error: e.message });
    }

    try { wallet.preDispatchCheck(req.params.id); }
    catch (e) {
      return res.status(e.status || 402).json({ error: e.message, code: e.code, wallet: wallet.getWallet(req.params.id) });
    }

    const turnMeter = wallet.startTurn(req.params.id);
    const turnStartedAt = Date.now();
    try {
      transcript.appendEvent(req.params.id, { kind: "user_message", content: prompt, model, agent: agentName });
    } catch {}

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const ac = new AbortController();
    let clientClosed = false;
    res.on("close", () => {
      if (!res.writableEnded) { clientClosed = true; ac.abort(); }
    });
    const sse = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Routing decision broadcast at the start so the client can render which
    // agent is handling which turn.
    const routed = routePrompt(prompt, { explicit: model });
    const effectiveModel = routed.model;
    sse("agent_routing", {
      ts: Date.now(),
      agent: agentName,
      model: effectiveModel,
      modelAlias: routed.modelAlias,
      routingReason: routed.reason,
      sessionId: req.params.id,
      cwd: bundleCwd,
      skillScope: agentCfg.skillScope,
      allowedTools: agentCfg.allowedTools,
    });

    // Compose final agent prompt: agent's system prompt + bundle context + user prompt
    const composedPrompt = `${agentCfg.systemPrompt}

---

Bundle workspace context (your cwd):
  - This is an Avni bundle session. Read JSON files directly via Read.
  - For deterministic patches: POST a YAML spec to /v1/sessions/${req.params.id}/apply-spec via Bash + curl. The pipeline parses YAML, materialises declarative rules → JS, patches the live bundle (preserving UUIDs), returns a structured diff + integrity report.
  - For exploratory edits: Read + Edit specific files. Server commits whatever you change as a new turn.

User instruction:
${prompt}`;

    // Stream + accumulate assistant text for post-stream contract validation.
    let agentEvents = 0;
    let runningCostUsd = 0;
    let runningInputTokens = 0;
    let runningOutputTokens = 0;
    let circuitBreakReason = null;
    let assistantText = "";

    try {
      for await (const ev of runAgent({
        prompt: composedPrompt,
        apiKey,
        model: effectiveModel,
        workspace: bundleCwd,
        systemPrompt: agentCfg.systemPrompt,
        allowedTools: agentCfg.allowedTools,
        skillScope: agentCfg.skillScope,
        abortController: ac,
      })) {
        agentEvents++;
        sse("agent", ev);
        // Accumulate text from assistant messages — we'll parse the trailing
        // fenced ```json``` block after the stream ends.
        if (ev?.type === "assistant" && ev.message?.content) {
          for (const block of ev.message.content) {
            if (block.type === "text" && typeof block.text === "string") {
              assistantText += block.text;
            }
          }
        }
        if (ev?.type === "result" && typeof ev.total_cost_usd === "number") {
          runningCostUsd = ev.total_cost_usd;
          if (ev.usage) {
            runningInputTokens  = ev.usage.input_tokens  || runningInputTokens;
            runningOutputTokens = ev.usage.output_tokens || runningOutputTokens;
          }
        }
        const verdict = turnMeter.shouldAbort(agentEvents, runningCostUsd);
        if (verdict?.abort) {
          sse("circuit-break", verdict);
          ac.abort();
          circuitBreakReason = verdict.reason;
          break;
        }
      }

      // ── Post-stream: parse + validate the structured output contract.
      const parsed = parseAgentOutput(assistantText);
      let structured = null;
      let schemaErrors = [];
      if (parsed.errors.length > 0) {
        schemaErrors = parsed.errors;
        sse("structured_output_error", {
          errors: parsed.errors,
          rawTextLength: assistantText.length,
        });
      } else {
        const v = validateAgentOutput(parsed.json);
        if (!v.ok) {
          schemaErrors = v.errors;
          sse("structured_output_error", {
            errors: v.errors,
            jsonAttempt: parsed.json,
          });
        } else {
          structured = parsed.json;
          sse("structured_output", structured);
        }
      }

      // Commit whatever the agent changed (even on abort or schema break).
      const turnSummary = `${agentName}: ${prompt.replace(/\s+/g, " ").trim().slice(0, 80)}`;
      const turnResult = await sessions.commitWorkspaceChanges(req.params.id, turnSummary);
      const walletSnapshot = turnMeter.recordResult({
        usd: runningCostUsd,
        inputTokens: runningInputTokens,
        outputTokens: runningOutputTokens,
        aborted: !!circuitBreakReason,
        abortReason: circuitBreakReason,
        agent: agentName,
      });

      sse("turn", { ...turnResult, wallet: walletSnapshot, aborted: !!circuitBreakReason, abortReason: circuitBreakReason });
      sse("done", {
        ts: Date.now(),
        agentEvents,
        wallet: walletSnapshot,
        structured,
        schemaErrors,
        schemaOk: schemaErrors.length === 0,
      });

      try {
        transcript.appendEvent(req.params.id, {
          kind: "turn_commit",
          source: "agent_messages",
          agent: agentName,
          turn: turnResult.turn,
          sha: turnResult.sha,
          summary: turnSummary,
          validation: turnResult.validation,
          cost_usd: runningCostUsd,
          tokens: { in: runningInputTokens, out: runningOutputTokens },
          model: effectiveModel,
          aborted: !!circuitBreakReason,
          abortReason: circuitBreakReason,
          structured,
          schemaErrors,
        });
        steplog.logStep(req.params.id, {
          kind: "agent_turn",
          status: circuitBreakReason ? "aborted" : (schemaErrors.length > 0 ? "schema_error" : "ok"),
          duration_ms: Date.now() - turnStartedAt,
          meta: {
            agent: agentName,
            turn: turnResult.turn, sha: turnResult.sha, model: effectiveModel,
            cost_usd: Number(runningCostUsd.toFixed(6)),
            input_tokens: runningInputTokens, output_tokens: runningOutputTokens,
            events: agentEvents,
            schemaOk: schemaErrors.length === 0,
            abortReason: circuitBreakReason,
          },
        });
      } catch (logErr) {
        console.warn(`[/v1/sessions/${req.params.id}/agent-messages] log failed:`, logErr.message);
      }
    } catch (e) {
      console.error(`[/v1/sessions/:id/agent-messages] error:`, e?.stack || e);
      sse("error", { message: e?.message || String(e), name: e?.name, clientClosed });
      try {
        steplog.logStep(req.params.id, {
          kind: "agent_turn", status: "error",
          duration_ms: Date.now() - turnStartedAt,
          error: e?.message || String(e),
        });
      } catch {}
    } finally {
      res.end();
    }
  });
}
