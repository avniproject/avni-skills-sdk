// Agent-driven session edits (LLM dispatch + SSE + commit + wallet + observability).
//   POST /v1/sessions/:id/messages          Phase-4 legacy agent (open allowed tools, full system prompt inline)
//   POST /v1/sessions/:id/agent-messages    WS5 multi-agent dispatch (spec/bundle-config/review), structured-output contract
// Both: BYO Anthropic key. Server commits whatever the agent changed in the
// session's bundle cwd as a new turn after the SSE stream ends; wallet
// circuit-breaker can abort mid-stream.

import * as sessions from "../sessions.js";
import * as wallet from "../wallet.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";
import { runAgent, BUNDLE_HARD_RULES } from "../agent.js";
import { routePrompt } from "../router.js";
import { AGENTS_BY_NAME, listAgentNames } from "../agents/index.js";
import { parseAgentOutput, validateAgentOutput } from "../agent-output-schema.js";

export function register(app) {
  // Agent-driven edit (Phase 4). BYO Anthropic key.
  //
  // The agent's cwd is the session's bundle dir, with avni-skills staged at
  // `.claude/skills/` (gitignored). The agent reads bundle files, runs the
  // validator if it wants, and applies edits via Read/Edit/Write. After the
  // agent's turn ends, we commit whatever changed in the working tree as a
  // new session turn — git is the authoritative diff source.
  //
  // Body: { prompt: string, model?: string }
  // Header: Authorization: Bearer <ANTHROPIC_API_KEY>
  // Streams SSE: same shape as /v1/agent/query, plus a final `turn` event.
  app.post("/v1/sessions/:id/messages", async (req, res) => {
    const auth = req.headers.authorization || "";
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) {
      return res.status(401).json({ error: "Authorization: Bearer <ANTHROPIC_API_KEY> required" });
    }
    const apiKey = m[1].trim();
    const { prompt, model } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required in request body" });

    let bundleCwd;
    try {
      bundleCwd = sessions.bundleDir(req.params.id);
      sessions.ensureSessionSkillsStaged(req.params.id);
    } catch (e) {
      return res.status(404).json({ error: e.message });
    }

    // Wallet pre-dispatch check — refuse before spawning the agent if the
    // session has already exceeded its cost cap.
    try {
      wallet.preDispatchCheck(req.params.id);
    } catch (e) {
      return res.status(e.status || 402).json({
        error: e.message,
        code: e.code,
        wallet: wallet.getWallet(req.params.id),
      });
    }
    const turnMeter = wallet.startTurn(req.params.id);
    const turnStartedAt = Date.now();
    try {
      transcript.appendEvent(req.params.id, { kind: "user_message", content: prompt, model });
    } catch (logErr) {
      console.warn(`[/v1/sessions/${req.params.id}/messages] transcript seed failed:`, logErr.message);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const ac = new AbortController();
    let clientClosed = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientClosed = true;
        ac.abort();
      }
    });

    const sse = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sessionPrompt = `You are editing an AVNI bundle inside a session workspace.

Workspace layout (your cwd):
  ./                  — bundle files you can read + edit (concepts.json, forms/*.json, formMappings.json, ...)
  ./.claude/skills/   — the AVNI knowledge base (16 skills). Read SKILL.md files here for guidance.

Workflow:
  - Edit files in cwd directly via Edit/Write. DO NOT run \`git\` yourself — the server commits whatever you changed as a new turn after your run ends, then re-runs the validator and reports the delta.
  - Keep changes minimal and surgical. Each turn should fix one specific issue or address one specific user request.
  - For semantic decisions (e.g. F2 cross-group concept reuse), explain your reasoning before applying.
  - When stuck, READ the skill files (\`.claude/skills/<name>/SKILL.md\`) — that's the canonical AVNI knowledge base. Don't guess at AVNI conventions.

${BUNDLE_HARD_RULES}

User instruction:
${prompt}`;

    // Route: respect explicit `model` from caller, otherwise auto-route based
    // on the prompt's content (concept dedup / schema → sonnet; everything else
    // → haiku). The routing decision is sent on the `start` SSE event so the
    // user can see which model + why.
    const routed = routePrompt(prompt, { explicit: model });
    const effectiveModel = routed.model;

    let agentEvents = 0;
    let runningCostUsd = 0;
    let runningInputTokens = 0;
    let runningOutputTokens = 0;
    let circuitBreakReason = null;
    try {
      sse("start", {
        ts: Date.now(),
        model: effectiveModel,
        modelAlias: routed.modelAlias,
        routingReason: routed.reason,
        sessionId: req.params.id,
        cwd: bundleCwd,
      });
      for await (const ev of runAgent({
        prompt: sessionPrompt,
        apiKey,
        model: effectiveModel,
        workspace: bundleCwd,
        // Curated: 7 load-bearing skills for bundle authoring, down from 17.
        // Off-topic skills (mobile-testing, support tickets, metabase, etc.)
        // remain readable via /v1/skills/:slug but aren't pre-loaded into the
        // agent's context. See src/skills.js LOAD_BEARING_BUNDLE_SKILLS.
        skillScope: "bundle-authoring",
        systemPrompt: `You are an AVNI bundle editor inside a session workspace.

YOUR CWD IS ALREADY AN AVNI BUNDLE.
An SRS spreadsheet has ALREADY been processed by the deterministic generator into a working bundle in your cwd. There is NO spreadsheet to ask about. Do not ask the user to "share the data" — it is already on disk as JSON.

WHAT'S IN CWD (always run \`ls\` first if you're unsure):
  • concepts.json            — concept definitions (the entire concept dictionary)
  • subjectTypes.json        — subject (individual/household/group) definitions
  • programs.json            — program definitions (may be empty if SRS had no Modelling-sheet programs)
  • encounterTypes.json      — encounter type definitions
  • formMappings.json        — links forms to subject types / programs / encounter types
  • forms/*.json             — one file per form, with formElementGroups → formElements
  • organisationConfig.json  — org-level config
  • operational{SubjectTypes,Programs,EncounterTypes}.json — operational layer (must mirror master entities)
  • groupPrivilege.json, groups.json, addressLevelTypes.json — supporting
  • .claude/skills/<name>/   — 17 SKILL.md knowledge files. ALWAYS consult the relevant one before non-trivial edits. New skill: rules-author for any rule field.

WHAT TO DO ON VAGUE PROMPTS:
If the user says something open-ended like "look at the bundle" or "what should I fix?", DO NOT ask back. Instead:
  1. Run \`ls\` and Read the validator-relevant files (concepts.json, formMappings.json, a couple of forms)
  2. Run the bundle validator yourself via the appropriate skill if needed (it shows F2/F5/C3 error codes)
  3. Propose 2–3 concrete next actions with file paths and line numbers, in priority order
  4. Make ONE atomic edit if the action is clear and reversible

WHAT TO DO ON SPECIFIC PROMPTS:
For "fix the F2 error", "add a rule on form X", "rename concept Y" — go straight to Read + Edit/Write. No clarifying questions unless the file path is ambiguous.

RULES (decisionRule, visitScheduleRule, validationRule, formElement.rule, eligibility, summary):
Consult .claude/skills/rules-author/SKILL.md first. The body must wrap as \`({params, imports}) => {...}\`. Only \`imports.{rulesConfig,common,lodash,moment,motherCalculations,log,models}\` are injected. NEVER \`imports.globalFn\` — not portable. UUIDs in rule strings must exist in concepts.json (or be the form/encounter UUID itself).

The server commits whatever you changed as a new turn (git diff is the source of truth). The Layer-4 rules validator runs on every turn — codes R1-R6 will surface in the user's feedback.

${BUNDLE_HARD_RULES}`,
        abortController: ac,
      })) {
        agentEvents++;
        sse("agent", ev);
        // Track running cost from result events (Claude Agent SDK emits a
        // `result` event with total_cost_usd). Mid-stream abort check fires
        // every event so we don't have to wait for the SDK to emit usage.
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
      // Commit whatever the agent changed (even on abort — partial work is still recorded)
      const turnSummary = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
      const turnResult = await sessions.commitWorkspaceChanges(req.params.id, turnSummary);
      // Record cost + tokens in the wallet ledger
      const walletSnapshot = turnMeter.recordResult({
        usd: runningCostUsd,
        inputTokens: runningInputTokens,
        outputTokens: runningOutputTokens,
        aborted: !!circuitBreakReason,
        abortReason: circuitBreakReason,
      });
      sse("turn", { ...turnResult, wallet: walletSnapshot, aborted: !!circuitBreakReason, abortReason: circuitBreakReason });
      sse("done", { ts: Date.now(), agentEvents, wallet: walletSnapshot });
      try {
        transcript.appendEvent(req.params.id, {
          kind: "turn_commit",
          source: "agent",
          turn: turnResult.turn,
          sha: turnResult.sha,
          summary: turnSummary,
          validation: turnResult.validation,
          cost_usd: runningCostUsd,
          tokens: { in: runningInputTokens, out: runningOutputTokens },
          model: effectiveModel,
          aborted: !!circuitBreakReason,
          abortReason: circuitBreakReason,
        });
        steplog.logStep(req.params.id, {
          kind: "agent_turn",
          status: circuitBreakReason ? "aborted" : "ok",
          duration_ms: Date.now() - turnStartedAt,
          meta: {
            turn: turnResult.turn, sha: turnResult.sha, model: effectiveModel,
            cost_usd: Number(runningCostUsd.toFixed(6)),
            input_tokens: runningInputTokens, output_tokens: runningOutputTokens,
            events: agentEvents, abortReason: circuitBreakReason,
          },
        });
      } catch (logErr) {
        console.warn(`[/v1/sessions/${req.params.id}/messages] turn log failed:`, logErr.message);
      }
    } catch (e) {
      console.error("[/v1/sessions/:id/messages] error:", e?.stack || e);
      sse("error", { message: e?.message || String(e), name: e?.name, clientClosed });
      try {
        steplog.logStep(req.params.id, {
          kind: "agent_turn",
          status: "error",
          duration_ms: Date.now() - turnStartedAt,
          error: e?.message || String(e),
        });
      } catch {}
    } finally {
      res.end();
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // /v1/sessions/:id/agent-messages — WS5 multi-agent live dispatch
  // ───────────────────────────────────────────────────────────────────
  // Body: { agent: "spec" | "bundle-config" | "review",
  //         prompt: string,
  //         model?: string }
  // Header: Authorization: Bearer <ANTHROPIC_API_KEY>
  //
  // Routes to one of the three specialised agents. Each carries its own
  // system prompt + allowed-tools + skillScope (from src/agents/) and is
  // constrained to end every response with a fenced ```json``` block
  // matching AGENT_OUTPUT_SCHEMA. The server validates that contract after
  // the stream ends; an invalid response is surfaced as `structured_output_error`
  // SSE event with the parser errors, but the workspace turn is still committed
  // (the agent may have done useful work even when the contract is broken).
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
