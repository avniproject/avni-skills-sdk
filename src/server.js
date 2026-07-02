// HTTP API — wraps avni-skills as Claude-Agent-SDK-driven endpoints.
//
// This file is the bootstrap: Express init + CORS + route mounting + listen.
// Endpoint handlers live in `src/routes/`; see `src/routes/index.js` for the
// full module map.
//
// Auth: BYO Anthropic key. Caller passes it as `Authorization: Bearer sk-ant-...`
// for all /v1/agent/* and /v1/sessions/:id/{messages,evaluate}
// endpoints. Deterministic endpoints (/v1/skills/*, /v1/bundles/generate,
// /v1/sessions/:id/{edit,rules,...}) require no key.
//
// Endpoints (complete list registered by src/routes/index.js):
//   GET    /health
//   GET    /v1/skills                   list all skills (frontmatter only)
//   GET    /v1/skills/:slug             read full SKILL.md + supporting files
//   POST   /v1/bundles/generate         multipart: forms.xlsx + optional modelling.xlsx
//                                        → returns bundle.zip (deterministic, no LLM)
//   POST   /v1/agent/query              run a one-shot agent query, stream SSE
//                                        body: { prompt, model?, workspace? }
//                                        header: Authorization: Bearer <ANTHROPIC_KEY>
//
//   --- Phase 3+: iterative editing sessions ---
//   POST   /v1/sessions                 multipart upload → first-pass bundle, returns id
//   GET    /v1/sessions                 list all sessions
//   GET    /v1/sessions/:id             metadata + validator state + file tree
//   GET    /v1/sessions/:id/files/*     read a file from the bundle
//   GET    /v1/sessions/:id/turns       list edit turns (each = a git commit)
//   GET    /v1/sessions/:id/turns/:n/diff  unified diff for a turn
//   POST   /v1/sessions/:id/edit        Wizard-of-Oz edit (no LLM): apply pre-supplied
//                                        file changes as a turn. Body: { summary, edits }
//   POST   /v1/sessions/:id/messages    agent edit (BYO key, SSE, single linear agent)
//                                        (YAML-spec application: spec_apply MCP tool, not a route)
//   GET    /v1/sessions/:id/{transcript,steps,cost,diagnostics}  observability
//   GET    /v1/sessions/:id/rules                                rules-brain readers
//   GET    /v1/sessions/:id/rules/validation
//   PUT    /v1/sessions/:id/rules                                rules-brain writer
//   GET    /v1/sessions/:id/summary                              deterministic summary
//   POST   /v1/sessions/:id/evaluate                             LLM evaluator (BYO key)
//   GET    /v1/sessions/:id/wallet                               wallet snapshot
//   POST   /v1/sessions/:id/wallet/reset                         bump hard cap
//   POST   /v1/sessions/:id/revert      { to_turn } — hard reset to that turn
//   GET    /v1/sessions/:id/zip         packaged ZIP of current state
//   DELETE /v1/sessions/:id             cleanup

import express from "express";
import { avniSkillsPath } from "./skills.js";
import { mountRoutes } from "./routes/index.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { logger } from "./logging.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS — open by default; tighten in deploy if needed
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Expose-Headers", "X-Bundle-Errors, X-Bundle-Warnings");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// H5 — per-IP rate limit. Defaults: 60 req/min, 30 burst. Override with
// SDK_RATE_LIMIT_TOKENS_PER_MIN / SDK_RATE_LIMIT_BURST env vars.
// Cheap read-only endpoints are skipped so a tool polling /health doesn't
// eat into the budget legitimate /messages calls need.
app.use(rateLimit({
  tokensPerMinute: Number(process.env.SDK_RATE_LIMIT_TOKENS_PER_MIN || 60),
  burst: Number(process.env.SDK_RATE_LIMIT_BURST || 30),
  // Rate-limit MUTATIONS only. The REPL banner fires 6 reads in parallel
  // on session create; the dashboard polls 3 endpoints every 2 s; :diff /
  // :files / :transcript / :steps / :cost are all bursty. None of those
  // can be abused (they're idempotent + per-session-scoped). Reads being
  // rate-limited caused cosmetic "?" in the banner on freshly-booted
  // servers (see issue surfaced 2026-05-27).
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || req.path === "/health",
}));

mountRoutes(app);

const PORT = Number(process.env.PORT || 3030);
app.listen(PORT, () => {
  logger.info({ event: "server.listen", port: PORT }, `avni-skills-sdk API listening on :${PORT}`);
  console.log(`avni-skills-sdk API listening on :${PORT}`);
  try { console.log(`  AVNI_SKILLS_PATH = ${avniSkillsPath()}`); } catch (e) { logger.warn({ event: "skills.path.missing", err: e.message }, e.message); }
  console.log(`  Endpoints:`);
  console.log(`    GET    /health`);
  console.log(`    GET    /v1/skills`);
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
