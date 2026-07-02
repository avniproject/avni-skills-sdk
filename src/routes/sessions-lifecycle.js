// /v1/sessions/* — session lifecycle endpoints (Phase 3 + 4 base operations).
// Covers: create, list, get, file read, turns list, turn diff, revert, ZIP export, delete.
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
  //     SRS is attached (inline 'srs' field, optional 'forms'/'modelling' XLSX,
  //     and/or an 'srs_path' the agent can Read). The agent reads it via
  //     read_srs and optionally bootstraps via generate_baseline.
  // No LLM call required at create time — caller iterates later via /edit (WoO),
  // /apply-spec, or /messages (real agent, BYO key).
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
      if (mode === "agent" && !files.forms && !files.modelling && !fields.srs && !fields.srs_path) {
        return res.status(400).json({ error: "agent mode requires at least one SRS source: an 'srs' field (inline text/JSON), a 'forms'/'modelling' XLSX file, or an 'srs_path'" });
      }

      const result = sessions.createSession({
        mode,
        formsBuffer: files.forms?.buffer,
        formsFilename: files.forms?.filename,
        modellingBuffer: files.modelling?.buffer,
        modellingFilename: files.modelling?.filename,
        org: fields.org || "Bundle",
        srs: fields.srs,
        srsPath: fields.srs_path,
      });
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
      res.json({ ...meta, files: sessions.listFiles(req.params.id) });
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
