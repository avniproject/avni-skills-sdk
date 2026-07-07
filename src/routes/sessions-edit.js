// Deterministic session edit endpoint:
//   POST /v1/sessions/:id/edit         Wizard-of-Oz: apply pre-supplied file edits as a turn
// Bypasses the LLM. The agent dispatch path lives in sessions-messages.js.
//
// The former POST /:id/apply-spec route was retired in story #11 — the
// deterministic YAML-spec surface now lives as the in-process MCP tools
// `spec_apply` / `spec_emit` (see src/agents/bundle-mcp-server.js) which the
// agent calls directly. `POST /:id/edit` survives (eval runner + demo depend
// on it) as the LLM-free backout path.

import * as sessions from "../sessions.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";

export function register(app) {
  // Wizard-of-Oz edit — apply pre-supplied file edits as a turn.
  // Body: { summary: string, edits: { "path/in/bundle.json": "new content", ... } }
  // Set a path's value to null to delete that file.
  // No LLM call. Used to test the session machinery end-to-end without burning
  // tokens (and for any external agent that wants to drive edits directly).
  app.post("/v1/sessions/:id/edit", (req, res) => {
    try {
      const { summary, edits } = req.body || {};
      if (!summary) return res.status(400).json({ error: "summary required" });
      if (!edits || typeof edits !== "object") return res.status(400).json({ error: "edits required (object)" });
      const t0 = Date.now();
      const result = sessions.commitTurn(req.params.id, summary, edits);
      try {
        transcript.appendEvent(req.params.id, {
          kind: "turn_commit",
          source: "wizard_of_oz",
          turn: result.turn,
          sha: result.sha,
          summary,
          filesChanged: Object.keys(edits),
          validation: result.validation,
        });
        steplog.logStep(req.params.id, {
          kind: "commit",
          duration_ms: Date.now() - t0,
          status: result.validation?.valid === false ? "ok" : "ok", // commit succeeded; validation state is meta
          meta: { turn: result.turn, sha: result.sha, source: "wizard_of_oz", filesChanged: Object.keys(edits).length, errors: result.validation?.errors ?? 0 },
        });
      } catch (logErr) {
        console.warn(`[/v1/sessions/${req.params.id}/edit] log failed:`, logErr.message);
      }
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
