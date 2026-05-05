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
import { runAgent } from "./agent.js";
import * as sessions from "./sessions.js";

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
    res.setHeader("X-Bundle-Validation", JSON.stringify({
      errors: validation.errors.slice(0, 50),
      warnings: validation.warnings.slice(0, 20),
    }).slice(0, 4000));
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
    const result = sessions.commitTurn(req.params.id, summary, edits);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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

The current bundle was produced by the deterministic generator. The user wants you to refine it. After you finish, the server will:
  1. Run \`git status\` against the bundle dir
  2. Commit whatever you changed as a new turn
  3. Re-run the validator and report the delta

Rules:
  - Edit files in cwd directly via Edit/Write. DO NOT run \`git\` yourself — the server commits.
  - You can run the validator any time: \`node -e "import('./src/bundle.js')"\` IS NOT available; instead read the JSON yourself or rely on the post-turn validator delta you'll get back.
  - Keep changes minimal and surgical. Each turn should fix one issue.
  - If a fix needs human judgement (e.g. F2 cross-group concept reuse), explain your decision and apply it.

User instruction:
${prompt}`;

  let agentEvents = 0;
  try {
    sse("start", {
      ts: Date.now(),
      model: model || "claude-haiku-4-5-20251001",
      sessionId: req.params.id,
      cwd: bundleCwd,
    });
    for await (const ev of runAgent({
      prompt: sessionPrompt,
      apiKey,
      model,
      workspace: bundleCwd,
      systemPrompt: "You are an AVNI bundle editor. Use the skills in .claude/skills/ for guidance. Make minimal, correct edits.",
      abortController: ac,
    })) {
      agentEvents++;
      sse("agent", ev);
    }
    // Commit whatever the agent changed
    const turnSummary = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
    const turnResult = sessions.commitWorkspaceChanges(req.params.id, turnSummary);
    sse("turn", turnResult);
    sse("done", { ts: Date.now(), agentEvents });
  } catch (e) {
    console.error("[/v1/sessions/:id/messages] error:", e?.stack || e);
    sse("error", { message: e?.message || String(e), name: e?.name, clientClosed });
  } finally {
    res.end();
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
