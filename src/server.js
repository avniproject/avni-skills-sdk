// HTTP API — wraps avni-skills as Claude-Agent-SDK-driven endpoints.
//
// Auth: BYO Anthropic key. Caller passes it as `Authorization: Bearer sk-ant-...`
// for all /v1/agent/* endpoints. Deterministic endpoints (/v1/skills/*,
// /v1/bundles/generate) require no key.
//
// Endpoints:
//   GET  /health
//   GET  /v1/skills                  list all skills (frontmatter only)
//   GET  /v1/skills/:slug             read full SKILL.md + supporting files
//   POST /v1/bundles/generate         multipart: forms.xlsx + optional modelling.xlsx
//                                     → returns bundle.zip (deterministic, no LLM)
//   POST /v1/agent/query              run a one-shot agent query, stream SSE
//                                     body: { prompt, model?, workspace? }
//                                     header: Authorization: Bearer <ANTHROPIC_KEY>

import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listSkills, readSkill, avniSkillsPath } from "./skills.js";
import { generateBundle, validateBundle, zipBundle } from "./bundle.js";
import { runAgent } from "./agent.js";

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

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const sse = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sse("start", { ts: Date.now(), model: model || "claude-haiku-4-5-20251001" });
    for await (const ev of runAgent({
      prompt, apiKey, model, workspace, systemPrompt, allowedTools, permissionMode,
      signal: ac.signal,
    })) {
      // Stream raw SDK events; client decides how to render them
      sse("agent", ev);
    }
    sse("done", { ts: Date.now() });
  } catch (e) {
    sse("error", { message: e.message });
  } finally {
    res.end();
  }
});

const PORT = Number(process.env.PORT || 3030);
app.listen(PORT, () => {
  console.log(`avni-skills-sdk API listening on :${PORT}`);
  try { console.log(`  AVNI_SKILLS_PATH = ${avniSkillsPath()}`); } catch (e) { console.warn("  ⚠", e.message); }
  console.log(`  Endpoints:`);
  console.log(`    GET  /health`);
  console.log(`    GET  /v1/skills`);
  console.log(`    GET  /v1/skills/:slug`);
  console.log(`    POST /v1/bundles/generate    (multipart: forms.xlsx, optional modelling.xlsx)`);
  console.log(`    POST /v1/agent/query         (BYO Anthropic key in Authorization: Bearer)`);
});
