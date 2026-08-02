// /v1/sessions/* — session lifecycle endpoints (Phase 3 + 4 base operations).
// Covers: create, list, get, file read, turns list, turn diff, revert, scrub,
// ZIP export, delete.
// Excludes: edits (sessions-edit.js), agent dispatch (sessions-messages.js), observability
// (sessions-observability.js), rules (sessions-rules.js), summary/evaluate (sessions-summary-evaluate.js).

import fs from "node:fs";
import * as sessions from "../sessions.js";
import * as transcript from "../transcript.js";
import * as steplog from "../steplog.js";
import { readMultipart } from "../middleware/multipart.js";

export function register(app) {
  // Create a new session.
  //   • mode=baseline (DEFAULT): from an SRS upload. Runs the deterministic
  //     generator as turn 0. Requires the 'forms' file. Byte-for-byte unchanged.
  //   • mode=agent (story #12): from requirements. The bundle starts empty; the
  //     SRS is attached as a 'forms'/'modelling' XLSX (kept in input/, read via
  //     bundle_read_srs) and/or an inline 'srs' field. NO external path is
  //     accepted (LFI closure). The agent reads the SRS via bundle_read_srs and
  //     optionally bootstraps via bundle_generate_baseline.
  // No LLM call required at create time — caller iterates later via /edit (WoO)
  // or /messages (real agent, BYO key; the agent applies YAML specs in-process
  // via the spec_apply MCP tool — the /apply-spec route was retired in #11).
  app.post("/v1/sessions", async (req, res) => {
    try {
      const ct = req.headers["content-type"] || "";
      if (!ct.includes("multipart/form-data")) {
        return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
      }
      const { fields, files } = await readMultipart(req);
      const mode = fields.mode === "agent" ? "agent" : "baseline";
      if (mode === "baseline" && !files.forms) {
        return res.status(400).json({ error: "missing 'forms' file (Forms.xlsx)" });
      }
      if (mode === "agent" && !files.forms && !files.modelling && !fields.srs) {
        return res.status(400).json({ error: "agent mode requires at least one SRS source: a 'forms'/'modelling' XLSX file (read via bundle_read_srs), or an 'srs' field (inline text/JSON)" });
      }

      const result = sessions.createSession({
        mode,
        formsBuffer: files.forms?.buffer,
        formsFilename: files.forms?.filename,
        modellingBuffer: files.modelling?.buffer,
        modellingFilename: files.modelling?.filename,
        org: fields.org || "Bundle",
        srs: fields.srs,
      });

      // Turn-0 prose scrub (baseline mode only — the deterministic generator
      // is the only create-time path that can emit a prose-as-entity stray
      // straight from the uploaded SRS; agent mode starts empty). Gated via
      // SDK_PROSE_SCRUB (default on; "off" disables, "ai" also runs the
      // AI-judged pass). Best-effort: scrubSessionBundle/scrubProse never
      // throw internally, but a git failure could — never block session
      // creation on it.
      if (mode === "baseline" && process.env.SDK_PROSE_SCRUB !== "off") {
        try {
          await sessions.scrubSessionBundle(result.sessionId, { ai: process.env.SDK_PROSE_SCRUB === "ai" });
        } catch (e) {
          console.warn("[/v1/sessions] prose scrub failed:", e.message);
        }
      }

      // Seed transcript + step log with the creation event.
      try {
        transcript.appendEvent(result.sessionId, {
          kind: "system",
          action: "session_created",
          mode,
          org: fields.org || "Bundle",
          validation: result.validation,
        });
        steplog.logStep(result.sessionId, {
          kind: "session_create",
          meta: { mode, org: fields.org || "Bundle", errors: result.validation?.errors ?? 0 },
        });
      } catch (logErr) {
        // Logging must not fail the create call. Worst case the session has no
        // seed transcript; downstream readers tolerate empty files.
        console.warn("[/v1/sessions] log seed failed:", logErr.message);
      }
      res.status(201).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/v1/sessions", (_req, res) => {
    try { res.json({ sessions: sessions.listSessions() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/v1/sessions/:id", (req, res) => {
    try {
      const meta = sessions.getSession(req.params.id);
      // `uncommitted` exposes work stranded by a turn that never finished (killed
      // mid-stream, so the server never committed). Without it a resume shows
      // meta's turn/validation over a working tree that may hold a half-applied
      // edit — including one that left the bundle worse than it started.
      // Never fatal: a git failure must not 500 an otherwise-readable session.
      let uncommitted = [];
      try { uncommitted = sessions.uncommittedChanges(req.params.id); } catch { /* report clean-ish rather than fail */ }
      res.json({ ...meta, files: sessions.listFiles(req.params.id), uncommitted });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.get("/v1/sessions/:id/files/*", (req, res) => {
    try {
      const rel = req.params[0];
      const content = sessions.readFile(req.params.id, rel);
      res.setHeader("Content-Type", rel.endsWith(".json") ? "application/json" : "text/plain");
      res.send(content);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.get("/v1/sessions/:id/turns", (req, res) => {
    try { res.json({ turns: sessions.listTurns(req.params.id) }); }
    catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.get("/v1/sessions/:id/turns/:n/diff", (req, res) => {
    try {
      const diff = sessions.diffTurn(req.params.id, Number(req.params.n));
      res.setHeader("Content-Type", "text/plain");
      res.send(diff);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.post("/v1/sessions/:id/revert", (req, res) => {
    try {
      const toTurn = req.body?.to_turn;
      if (toTurn === undefined) return res.status(400).json({ error: "to_turn required" });
      const meta = sessions.revertToTurn(req.params.id, Number(toTurn));
      res.json(meta);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // On-demand prose scrub — reruns sessions.scrubSessionBundle() against the
  // current bundle state (same engine as the turn-0 create-time pass). Deterministic
  // by default; ?ai=1 also runs the AI-judged pass (requires ANTHROPIC_API_KEY).
  // Used by the `:scrub` REPL command. Never throws internally (see
  // scrubSessionBundle's doc comment) short of a git failure, which lands here.
  app.post("/v1/sessions/:id/scrub", async (req, res) => {
    try {
      sessions.getSession(req.params.id); // 404 on an unknown session, like sibling routes
      const r = await sessions.scrubSessionBundle(req.params.id, { ai: req.query.ai === "1" });
      res.status(200).json(r);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.get("/v1/sessions/:id/zip", async (req, res) => {
    try {
      const meta = sessions.getSession(req.params.id);
      const { zipPath } = await sessions.zipBundle(req.params.id);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${meta.org}.zip"`);
      res.setHeader("X-Bundle-Validation", JSON.stringify(meta.validationAtCurrent).slice(0, 4000));
      fs.createReadStream(zipPath).pipe(res);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.delete("/v1/sessions/:id", (req, res) => {
    try {
      sessions.deleteSession(req.params.id);
      res.status(204).end();
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}
