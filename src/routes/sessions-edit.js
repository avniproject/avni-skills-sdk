// Deterministic session edit endpoints:
//   POST /v1/sessions/:id/edit         Wizard-of-Oz: apply pre-supplied file edits as a turn
//   POST /v1/sessions/:id/apply-spec   Apply a YAML spec via the pipeline (materialise rules → patch → commit)
// Both bypass the LLM. The agent dispatch path lives in sessions-messages.js.

import fs from "node:fs";
import path from "node:path";
import * as sessions from "../sessions.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";
import { applySpec } from "../pipeline.js";

export function register(app) {
  // Apply a YAML spec onto the session's current bundle.
  // Body: { yaml: string, materialize?: boolean }
  // Reads the bundle dir into a file map, calls pipeline.applySpec (which parses
  // YAML, materialises declarative rules → JS, patches files, runs integrity
  // check), then commits the changed files as a turn. The structured diff,
  // integrity report, and rule-compilation audit go into the transcript so the
  // REPL's :diff command can render them.
  app.post("/v1/sessions/:id/apply-spec", async (req, res) => {
    try {
      const { yaml, materialize } = req.body || {};
      if (typeof yaml !== "string" || !yaml.trim()) {
        return res.status(400).json({ error: "yaml (string) required" });
      }
      const t0 = Date.now();
      const dir = sessions.bundleDir(req.params.id);

      // Read bundle dir → fileMap
      const fileMap = {};
      function walk(p, rel = "") {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          if (e.name === ".git" || e.name === ".claude") continue;
          const fp = path.join(p, e.name);
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(fp, r);
          else if (e.name.endsWith(".json")) {
            try { fileMap[r] = JSON.parse(fs.readFileSync(fp, "utf8")); }
            catch { /* skip un-parseable */ }
          }
        }
      }
      walk(dir);

      const result = applySpec({
        existingBundleFiles: fileMap,
        specYaml: yaml,
        materialize: materialize !== false,
      });

      // Convert filesChanged → edits map for commitTurn (stringify per file)
      const edits = {};
      for (const rel of result.filesChanged) {
        edits[rel] = JSON.stringify(result.patchedFiles[rel], null, 2);
      }
      let turn = null;
      if (Object.keys(edits).length > 0) {
        const summary = "applied spec: " +
          Object.entries(result.diff)
            .map(([f, ops]) => `${f}(+${ops.added?.length || 0}/~${ops.updated?.length || 0})`)
            .join(", ")
            .slice(0, 100);
        turn = sessions.commitTurn(req.params.id, summary, edits);
      }

      try {
        transcript.appendEvent(req.params.id, {
          kind: "turn_commit",
          source: "apply_spec",
          turn: turn?.turn,
          sha: turn?.sha,
          summary: `applySpec — ${result.filesChanged.length} files changed`,
          filesChanged: result.filesChanged,
          diff: result.diff,
          ruleCompilation: result.ruleCompilation,
          integrity: result.integrity,
        });
        steplog.logStep(req.params.id, {
          kind: "apply_spec",
          status: result.integrity.ok ? "ok" : "error",
          duration_ms: Date.now() - t0,
          meta: {
            filesChanged: result.filesChanged.length,
            rulesCompiled: result.ruleCompilation.compiled.length,
            ruleErrors: result.ruleCompilation.errors.length,
            integrityIssues: result.integrity.issues.length,
          },
        });
      } catch (logErr) {
        console.warn(`[/v1/sessions/${req.params.id}/apply-spec] log failed:`, logErr.message);
      }

      res.json({
        turn,
        diff: result.diff,
        diffSummary: result.diffSummary,
        filesChanged: result.filesChanged,
        ruleCompilation: result.ruleCompilation,
        integrity: result.integrity,
      });
    } catch (e) {
      res.status(400).json({ error: e.message, stack: e.stack });
    }
  });

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
