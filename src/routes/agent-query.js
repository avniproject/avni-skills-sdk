// POST /v1/agent/query — Claude Agent SDK one-shot query, SSE stream.
// BYO Anthropic key in Authorization: Bearer <ANTHROPIC_API_KEY>.

import { runAgent } from "../agent.js";

export function register(app) {
  app.post("/v1/agent/query", async (req, res) => {
    const auth = req.headers.authorization || "";
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) {
      return res.status(401).json({ error: "Authorization: Bearer <ANTHROPIC_API_KEY> required" });
    }
    const apiKey = m[1].trim();
    const { prompt, model, workspace, systemPrompt, allowedTools, permissionMode } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required in request body" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Abort the agent only if the CLIENT disconnects from the response stream.
    // Do NOT listen on req.on("close") — that fires when the request *body*
    // stream finishes reading (i.e. immediately after Express reads our small
    // JSON body), and would abort the agent before it even spawned.
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

    try {
      sse("start", { ts: Date.now(), model: model || "claude-haiku-4-5-20251001" });
      for await (const ev of runAgent({
        prompt, apiKey, model, workspace, systemPrompt, allowedTools, permissionMode,
        abortController: ac,
      })) {
        sse("agent", ev);
      }
      sse("done", { ts: Date.now() });
    } catch (e) {
      // Diagnostic log to server stdout — helps debug "aborted" mysteries
      console.error("[/v1/agent/query] error:", e?.stack || e);
      sse("error", {
        message: e?.message || String(e),
        name: e?.name,
        clientClosed,
      });
    } finally {
      res.end();
    }
  });
}
