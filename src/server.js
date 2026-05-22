// HTTP API — wraps avni-skills as Claude-Agent-SDK-driven endpoints.
//
// Auth: BYO Anthropic key. Caller passes it as `Authorization: Bearer sk-ant-...`
// for all /v1/agent/* endpoints. Deterministic endpoints (/v1/skills/*,
// /v1/bundles/generate) require no key.
//
// Endpoints:
//   GET    /health
//   GET    /v1/skills                  list all skills (frontmatter only)
//   GET    /v1/skills/:slug             read full SKILL.md + supporting files
//   POST   /v1/bundles/generate         multipart: forms.xlsx + optional modelling.xlsx
//                                       → returns bundle.zip (deterministic, no LLM)
//   POST   /v1/agent/query              run a one-shot agent query, stream SSE
//                                       body: { prompt, model?, workspace? }
//                                       header: Authorization: Bearer <ANTHROPIC_KEY>
//
//   --- Phase 3: iterative editing sessions ---
//   POST   /v1/sessions                 multipart upload → first-pass bundle, returns id
//   GET    /v1/sessions                 list all sessions
//   GET    /v1/sessions/:id             metadata + validator state + file tree
//   GET    /v1/sessions/:id/files/*    read a file from the bundle
//   GET    /v1/sessions/:id/turns       list edit turns (each = a git commit)
//   GET    /v1/sessions/:id/turns/:n/diff   unified diff for a turn
//   POST   /v1/sessions/:id/edit        Wizard-of-Oz edit (no LLM): apply pre-supplied
//                                       file changes as a turn. Body: { summary, edits }
//   POST   /v1/sessions/:id/messages    agent-driven edit (BYO Anthropic key, SSE)
//   POST   /v1/sessions/:id/revert      { to_turn } — hard reset to that turn
//   GET    /v1/sessions/:id/zip         packaged ZIP of current state
//   DELETE /v1/sessions/:id             cleanup

import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listSkills, readSkill, avniSkillsPath } from "./skills.js";
import { generateBundle, validateBundle, zipBundle } from "./bundle.js";
import { runAgent, BUNDLE_HARD_RULES } from "./agent.js";
import * as sessions from "./sessions.js";
import * as wallet from "./wallet.js";
import { routePrompt } from "./router.js";
import { summarizeBundle } from "./agents/summarizer.js";
import { evaluateBundle } from "./agents/evaluator.js";
import * as transcript from "./transcript.js";
import * as steplog from "./steplog.js";
import { applySpec } from "./pipeline.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS — open by default; tighten in deploy if needed
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Expose-Headers", "X-Bundle-Errors, X-Bundle-Warnings");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Multipart parser — small, focused; avoids pulling in busboy/multer for two fields
function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const buf = Buffer.concat(chunks);
        const ct = req.headers["content-type"] || "";
        const m = ct.match(/boundary=(?:"?)([^";]+)/);
        if (!m) return reject(new Error("no boundary in Content-Type"));
        const boundary = "--" + m[1];
        const parts = buf.toString("binary").split(boundary).slice(1, -1);
        const fields = {}, files = {};
        for (const part of parts) {
          const idx = part.indexOf("\r\n\r\n");
          if (idx < 0) continue;
          const headers = part.slice(0, idx);
          const body = Buffer.from(part.slice(idx + 4, -2), "binary");
          const nameMatch = headers.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const name = nameMatch[1];
          const filenameMatch = headers.match(/filename="([^"]*)"/);
          if (filenameMatch && filenameMatch[1]) {
            files[name] = { filename: filenameMatch[1], buffer: body };
          } else {
            fields[name] = body.toString("utf8").trim();
          }
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ───────────────────────────────────────────────────────────────────
// /health
// ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  try {
    res.json({ ok: true, avniSkillsPath: avniSkillsPath(), nodeVersion: process.version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// /v1/skills — list & read skill metadata (deterministic, no LLM)
// ───────────────────────────────────────────────────────────────────
app.get("/v1/skills", (_req, res) => {
  try { res.json({ skills: listSkills() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/v1/skills/:slug", (req, res) => {
  try {
    const skill = readSkill(req.params.slug);
    if (!skill) return res.status(404).json({ error: "skill not found" });
    res.json(skill);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────────────
// /v1/bundles/generate — deterministic generator (no LLM, no API key)
// ───────────────────────────────────────────────────────────────────
app.post("/v1/bundles/generate", async (req, res) => {
  try {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Content-Type must be multipart/form-data with 'forms' file" });
    }
    const { fields, files } = await readMultipart(req);
    if (!files.forms) return res.status(400).json({ error: "missing 'forms' file (Forms.xlsx)" });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "avni-gen-"));
    const formsPath = path.join(tmpDir, "forms.xlsx");
    fs.writeFileSync(formsPath, files.forms.buffer);
    let modellingPath = null;
    if (files.modelling) {
      modellingPath = path.join(tmpDir, "modelling.xlsx");
      fs.writeFileSync(modellingPath, files.modelling.buffer);
    }

    const org = fields.org || "Bundle";
    const out = path.join(tmpDir, "out");
    generateBundle({ formsPath, modellingPath, org, outDir: out });

    const validation = validateBundle(out);
    const zipPath = path.join(tmpDir, `${org}.zip`);
    await zipBundle(out, zipPath);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${org}.zip"`);
    res.setHeader("X-Bundle-Errors", String(validation.errors.length));
    res.setHeader("X-Bundle-Warnings", String(validation.warnings.length));
    // HTTP headers can't contain CR/LF or bytes outside printable ASCII —
    // strip them defensively so a single funky validator message can't 500
    // the whole response (real Astitva errors hit this in practice).
    const headerSafe = (s) => s.replace(/[^\x20-\x7E]/g, " ");
    res.setHeader("X-Bundle-Validation", headerSafe(JSON.stringify({
      errors: validation.errors.slice(0, 50),
      warnings: validation.warnings.slice(0, 20),
    })).slice(0, 4000));
    fs.createReadStream(zipPath).pipe(res).on("close", () => {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// /v1/agent/query — Claude Agent SDK with skills auto-loaded
// SSE stream of agent events. BYO Anthropic API key required.
// ───────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────
// /v1/sessions/* — Phase 3 iterative editing
// ───────────────────────────────────────────────────────────────────

// Create a new session from an SRS upload. Runs the deterministic generator
// as turn 0. No LLM call required — caller can iterate later via /edit (WoO)
// or /messages (real agent, BYO key).
app.post("/v1/sessions", async (req, res) => {
  try {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    }
    const { fields, files } = await readMultipart(req);
    if (!files.forms) return res.status(400).json({ error: "missing 'forms' file (Forms.xlsx)" });

    const result = sessions.createSession({
      formsBuffer: files.forms.buffer,
      formsFilename: files.forms.filename,
      modellingBuffer: files.modelling?.buffer,
      modellingFilename: files.modelling?.filename,
      org: fields.org || "Bundle",
    });
    // Seed transcript + step log with the creation event.
    try {
      transcript.appendEvent(result.sessionId, {
        kind: "system",
        action: "session_created",
        org: fields.org || "Bundle",
        validation: result.validation,
      });
      steplog.logStep(result.sessionId, {
        kind: "session_create",
        meta: { org: fields.org || "Bundle", errors: result.validation?.errors ?? 0 },
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

// ─── Memory + observability endpoints (transcript/steps/cost) ───────────────
// All three are JSONL files under <session-dir>/{transcript,steps,cost}.jsonl
// written by the helpers in src/transcript.js, src/steplog.js, src/wallet.js.

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

// ─── Rules endpoints (rules-brain) ─────────────────────────────────────────
// GET /v1/sessions/:id/rules
//   List every populated rule in the session's bundle, classified by type +
//   carrier entity. Useful for tooling/UIs that want a global rule view.
//
// GET /v1/sessions/:id/rules/validation
//   Run the Layer-4 static validator across every rule body in the bundle.
//   Returns { errors[], warnings[], byFile, summary }.
//
// PUT /v1/sessions/:id/rules
//   Body: { summary, updates: [ { file, field, ir?, js? }, ... ], formType? }
//   For each update:
//     - if `ir` is supplied: compile via rules-config DeclarativeRuleHolder
//       (Layer 3) → JS, then set the field.
//     - else `js` is supplied: set the field directly.
//   Then commit as a new turn (same path as /edit).
import * as rulesCompile from "./rules-brain/compile.js";
import { validateBundleRules as runRulesValidator } from "./rules-brain/validate.js";
import fs2 from "node:fs";
import path2 from "node:path";

app.get("/v1/sessions/:id/rules", (req, res) => {
  try {
    const dir = sessions.bundleDir(req.params.id);
    const rules = listAllRulesInBundle(dir);
    res.json({ sessionId: req.params.id, count: rules.length, rules });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/v1/sessions/:id/rules/validation", async (req, res) => {
  try {
    const dir = sessions.bundleDir(req.params.id);
    const result = await runRulesValidator(dir);
    const summary = {
      errors: result.errors.length,
      warnings: result.warnings.length,
      filesAffected: Object.keys(result.byFile).length,
    };
    res.json({ sessionId: req.params.id, summary, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/v1/sessions/:id/rules", (req, res) => {
  try {
    const { summary, updates, formType } = req.body || {};
    if (!summary) return res.status(400).json({ error: "summary required" });
    if (!Array.isArray(updates) || updates.length === 0) return res.status(400).json({ error: "updates[] required" });
    const dir = sessions.bundleDir(req.params.id);
    const edits = {}; // file relPath → new content
    const compiled = []; // log of what we did
    for (const u of updates) {
      const fp = path2.join(dir, u.file);
      if (!fp.startsWith(dir + path2.sep)) return res.status(400).json({ error: `path traversal: ${u.file}` });
      if (!fs2.existsSync(fp)) return res.status(400).json({ error: `file not found: ${u.file}` });
      const json = JSON.parse(fs2.readFileSync(fp, "utf8"));
      const field = u.field;
      let js = u.js;
      if (u.ir) {
        const fieldPath = `${guessCarrier(u.file)}.${field}`;
        const r = rulesCompile.compileByField(u.ir, fieldPath, { formType });
        if (r.error) return res.status(400).json({ error: `compile failed for ${u.file}#${field}: ${r.error}` });
        js = r.js || "";
      }
      if (typeof js !== "string") return res.status(400).json({ error: `${u.file}#${field}: ir or js required` });
      // Apply field on the JSON. If the file is an array (e.g. concepts.json
      // shaped lists), this caller pattern doesn't apply — keep it simple
      // and only patch object-shaped bundle JSONs.
      if (Array.isArray(json)) return res.status(400).json({ error: `${u.file}: array-shaped JSON not supported by this endpoint` });
      json[field] = js;
      edits[u.file] = JSON.stringify(json, null, 2);
      compiled.push({ file: u.file, field, mode: u.ir ? "ir" : "js", bytes: js.length });
    }
    const turn = sessions.commitTurn(req.params.id, summary, edits);
    res.json({ ...turn, compiled });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function guessCarrier(relPath) {
  if (relPath.startsWith("forms/")) return "form";
  if (relPath.endsWith("encounterTypes.json")) return "encounterType";
  if (relPath.endsWith("programs.json")) return "program";
  if (relPath.endsWith("subjectTypes.json")) return "subjectType";
  if (relPath.endsWith("organisationConfig.json")) return "organisationConfig";
  return "unknown";
}

function listAllRulesInBundle(dir) {
  const out = [];
  const fs = fs2;
  const path = path2;
  const FORM_FIELDS = ["decisionRule", "visitScheduleRule", "validationRule", "checklistsRule", "editFormRule"];
  const formsDir = path.join(dir, "forms");
  if (fs.existsSync(formsDir)) {
    for (const fn of fs.readdirSync(formsDir)) {
      if (!fn.endsWith(".json")) continue;
      const fp = path.join(formsDir, fn);
      let f; try { f = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
      for (const fld of FORM_FIELDS) {
        if (typeof f[fld] === "string" && f[fld].trim()) {
          out.push({ file: `forms/${fn}`, entity: "form", entityName: f.name, field: fld, bytes: f[fld].length });
        }
      }
      for (const g of (f.formElementGroups || [])) {
        for (const el of (g.formElements || [])) {
          if (typeof el.rule === "string" && el.rule.trim()) {
            out.push({ file: `forms/${fn}`, entity: "formElement", entityName: el.name, field: "rule", bytes: el.rule.length });
          }
        }
      }
    }
  }
  const scan = (file, fields, entity) => {
    const fp = path.join(dir, file);
    if (!fs.existsSync(fp)) return;
    let arr; try { arr = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return; }
    if (!Array.isArray(arr)) arr = [arr];
    for (const it of arr) for (const f of fields) {
      if (typeof it[f] === "string" && it[f].trim()) {
        out.push({ file, entity, entityName: it.name, field: f, bytes: it[f].length });
      }
    }
  };
  scan("encounterTypes.json", ["encounterEligibilityCheckRule"], "encounterType");
  scan("programs.json", ["enrolmentEligibilityCheckRule", "manualEnrolmentEligibilityCheckRule", "enrolmentSummaryRule"], "program");
  scan("subjectTypes.json", ["subjectSummaryRule"], "subjectType");
  scan("organisationConfig.json", ["worklistUpdationRule"], "organisationConfig");
  return out;
}

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
  try {
    const dir = sessions.bundleDir(req.params.id);
    // Pre-dispatch wallet check
    wallet.preDispatchCheck(req.params.id);
    const model = req.body?.model || "claude-haiku-4-5-20251001";
    const result = await evaluateBundle({ bundleDir: dir, apiKey, model });
    // Record cost in wallet so it counts against the session cap
    const turn = wallet.startTurn(req.params.id);
    turn.recordResult({
      usd: result.costUsd || 0,
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
    });
    res.json({ ...result, wallet: wallet.getWallet(req.params.id) });
  } catch (e) {
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
    const { zipPath, bytes } = await sessions.zipBundle(req.params.id);
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

const PORT = Number(process.env.PORT || 3030);
app.listen(PORT, () => {
  console.log(`avni-skills-sdk API listening on :${PORT}`);
  try { console.log(`  AVNI_SKILLS_PATH = ${avniSkillsPath()}`); } catch (e) { console.warn("  ⚠", e.message); }
  console.log(`  Endpoints:`);
  console.log(`    GET  /health`);
  console.log(`    GET  /v1/skills`);
  console.log(`    GET    /v1/skills/:slug`);
  console.log(`    POST   /v1/bundles/generate    (multipart: forms.xlsx, optional modelling.xlsx)`);
  console.log(`    POST   /v1/agent/query         (BYO Anthropic key in Authorization: Bearer)`);
  console.log(`    POST   /v1/sessions             (multipart upload → first-pass bundle, returns id)`);
  console.log(`    GET    /v1/sessions             (list all sessions)`);
  console.log(`    GET    /v1/sessions/:id          (metadata + file tree)`);
  console.log(`    GET    /v1/sessions/:id/files/* (read a file)`);
  console.log(`    GET    /v1/sessions/:id/turns    (list edit turns)`);
  console.log(`    GET    /v1/sessions/:id/turns/:n/diff`);
  console.log(`    POST   /v1/sessions/:id/edit     (Wizard-of-Oz: apply pre-supplied edits as a turn)`);
  console.log(`    POST   /v1/sessions/:id/messages (BYO Anthropic key — agent computes edits, commits as turn)`);
  console.log(`    POST   /v1/sessions/:id/revert   ({ to_turn })`);
  console.log(`    GET    /v1/sessions/:id/zip      (final ZIP)`);
  console.log(`    DELETE /v1/sessions/:id          (cleanup)`);
});
