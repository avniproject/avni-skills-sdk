// Bundle-level introspection endpoints + wallet controls.
//   GET  /v1/sessions/:id/summary       deterministic, free, instant
//   POST /v1/sessions/:id/evaluate      LLM evaluator (BYO key, ~$0.05–$0.20)
//   GET  /v1/sessions/:id/wallet        current wallet snapshot
//   POST /v1/sessions/:id/wallet/reset  bump hard cap by `multiplier`

import * as sessions from "../sessions.js";
import * as wallet from "../wallet.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";
import { summarizeBundle } from "../agents/summarizer.js";
import { evaluateBundle } from "../agents/evaluator.js";

export function register(app) {
  // Deterministic summary: free, instant. Returns entity counts, anomalies,
  // rule stats. Hooks: agent + CLI both consume this to give the user a
  // quick "what's in the bundle?" view.
  app.get("/v1/sessions/:id/summary", (req, res) => {
    try {
      const dir = sessions.bundleDir(req.params.id);
      res.json(summarizeBundle(dir));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  // LLM evaluator: BYO key, ~$0.05-0.20 per call. Surfaces semantic gaps
  // the deterministic summary can't catch.
  app.post("/v1/sessions/:id/evaluate", async (req, res) => {
    const auth = req.headers.authorization || "";
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) return res.status(401).json({ error: "Authorization: Bearer <ANTHROPIC_API_KEY> required" });
    const apiKey = m[1].trim();
    const startedAt = Date.now();
    try {
      const dir = sessions.bundleDir(req.params.id);
      // Pre-dispatch wallet check
      wallet.preDispatchCheck(req.params.id);
      const model = req.body?.model || "claude-haiku-4-5-20251001";
      // Bug B3: every wallet-spending endpoint must write a matching
      // transcript event — otherwise cost.jsonl carries entries with no
      // transcript twin and the audit log diverges.
      try {
        transcript.appendEvent(req.params.id, { kind: "evaluator_run", source: "/evaluate", model });
      } catch {}
      const result = await evaluateBundle({ bundleDir: dir, apiKey, model });
      // Record cost in wallet so it counts against the session cap
      const turn = wallet.startTurn(req.params.id);
      turn.recordResult({
        usd: result.costUsd || 0,
        inputTokens: result.usage?.input_tokens || 0,
        outputTokens: result.usage?.output_tokens || 0,
      });
      try {
        transcript.appendEvent(req.params.id, {
          kind: "evaluator_result",
          source: "/evaluate",
          model,
          cost_usd: result.costUsd || 0,
          tokens: { in: result.usage?.input_tokens || 0, out: result.usage?.output_tokens || 0 },
        });
        steplog.logStep(req.params.id, {
          kind: "evaluator_run",
          status: "ok",
          duration_ms: Date.now() - startedAt,
          meta: {
            model,
            cost_usd: Number((result.costUsd || 0).toFixed(6)),
            input_tokens: result.usage?.input_tokens || 0,
            output_tokens: result.usage?.output_tokens || 0,
          },
        });
      } catch {}
      res.json({ ...result, wallet: wallet.getWallet(req.params.id) });
    } catch (e) {
      try {
        steplog.logStep(req.params.id, {
          kind: "evaluator_run",
          status: "error",
          duration_ms: Date.now() - startedAt,
          error: e?.message || String(e),
        });
      } catch {}
      res.status(e.status || 500).json({ error: e.message, code: e.code });
    }
  });

  app.get("/v1/sessions/:id/wallet", (req, res) => {
    try {
      // Validate session exists by attempting to resolve its bundle dir
      sessions.bundleDir(req.params.id);
      res.json(wallet.getWallet(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.post("/v1/sessions/:id/wallet/reset", (req, res) => {
    try {
      sessions.bundleDir(req.params.id);
      const mul = Number(req.body?.multiplier) || 1;
      const updated = wallet.resetCap(req.params.id, mul);
      res.json({ ok: true, wallet: updated });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}
