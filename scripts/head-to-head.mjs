#!/usr/bin/env node
// head-to-head.mjs — baseline (deterministic generator) vs agent (authored-from-
// SRS) comparison harness for a directory of real SRSes (story #12).
//
// For every SRS in --srs-dir it runs BOTH pipelines against the SAME input and
// reports, per SRS and per arm:
//   • validator-errors-at-rest  (GET /v1/sessions/:id → validationAtCurrent.errors)
//   • integrity findings         (validationAtCurrent.integrity — the server-only
//                                 traps FE_CONCEPT_NOT_OBJECT / ALT_INVALID_NAME /
//                                 dangling REQUIRED refs the validator misses)
//   • cost (USD)                 (agent arm only — baseline is deterministic, $0)
//   • wall-clock (ms)
//
//   Arm A — baseline: POST /v1/sessions (mode omitted) → the deterministic
//           SRS→bundle generator runs at turn 0. No LLM. Cost $0.
//   Arm B — agent:    POST /v1/sessions (mode=agent) → EMPTY workspace + the SRS
//           persisted under input/; then POST /v1/sessions/:id/messages with an
//           authoring prompt so the agent authors the bundle from the SRS.
//
// ── COST / GATING ────────────────────────────────────────────────────
// The AGENT arm spends real tokens. This harness is API-gated and DEFERRED: it
// SKIPS cleanly (exit 0, {status:"skipped"}) unless BOTH are present:
//   • ANTHROPIC_API_KEY   (BYO key — never pass on the CLI; export it)
//   • --srs-dir <dir>     with at least one *Forms*.xlsx inside
// A real run needs real, private SRSes (never commit them) + a budget. Structure
// is complete; only the paid EXECUTION is deferred. Do NOT wire this into CI.
//
// ── USAGE ────────────────────────────────────────────────────────────
//   export ANTHROPIC_API_KEY='sk-ant-...'
//   AVNI_SKILLS_PATH=~/code/avni-skills \
//     node scripts/head-to-head.mjs --srs-dir ~/private/srs --out ./h2h-report.json
//
// SRS-dir layout: one *Forms*.xlsx per SRS; an optional *Modelling*.xlsx sharing
// the same filename prefix is paired automatically. The prefix (with the
// Forms/Modelling token stripped) becomes the org label.
//
// Env / flags:
//   --srs-dir <dir>     directory of SRS spreadsheets (required for a real run)
//   --out <path>        write the JSON report here (default: stdout only)
//   --port <n>          server port (default: random high port)
//   --budget <usd>      abort the run once cumulative agent cost exceeds this (default 20)
//   --model <id>        pin the agent arm's model (default: server matrix selection)
//   --max-turns <n>     informational only; per-turn caps live server-side (wallet)
//   --timeout-ms <n>    per-dispatch timeout (default 300000)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ─── args ────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}
const SRS_DIR = arg("srs-dir", process.env.SDK_H2H_SRS_DIR || "");
const OUT = arg("out", "");
const PORT = Number(arg("port", 15000 + Math.floor(Math.random() * 1000)));
const BUDGET = Number(arg("budget", process.env.SDK_H2H_BUDGET_USD || "20"));
const MODEL = arg("model", "") || undefined;
const TIMEOUT_MS = Number(arg("timeout-ms", "300000"));
const APIKEY = process.env.ANTHROPIC_API_KEY || "";
const BASE = `http://localhost:${PORT}`;

const AUTHORING_PROMPT =
  "This is an EMPTY agent-mode workspace — there is no bundle yet. Read the uploaded " +
  "SRS with bundle_read_srs (the spreadsheets live in ../input/), then author a " +
  "complete, uploadable AVNI bundle from it. You may bootstrap with " +
  "bundle_generate_baseline and refine. Finish only when BOTH the validator and the " +
  "integrity check report zero errors.";

// ─── SRS discovery + pairing ─────────────────────────────────────────
function discoverSrsPairs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const xlsx = entries.filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
  const forms = xlsx.filter((f) => /forms?/i.test(f));
  const pairs = [];
  for (const f of forms) {
    const prefix = f.replace(/\.xlsx$/i, "").replace(/[_\- ]*forms?.*/i, "").trim();
    const modelling = xlsx.find(
      (m) => /modell?ing/i.test(m) && m.replace(/\.xlsx$/i, "").replace(/[_\- ]*modell?ing.*/i, "").trim() === prefix,
    );
    pairs.push({
      org: prefix || f.replace(/\.xlsx$/i, ""),
      formsPath: path.join(dir, f),
      modellingPath: modelling ? path.join(dir, modelling) : null,
    });
  }
  return pairs;
}

// ─── skip gate (deferred until key + SRS dir present) ────────────────
function skip(reason) {
  const report = { status: "skipped", reason, generatedAt: null };
  process.stderr.write(
    `SKIPPED — ${reason}\n` +
    `  head-to-head is API-gated + needs real SRSes. To run:\n` +
    `    export ANTHROPIC_API_KEY='sk-ant-...'\n` +
    `    AVNI_SKILLS_PATH=~/code/avni-skills node scripts/head-to-head.mjs --srs-dir <dir>\n`,
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

if (!APIKEY) skip("requires ANTHROPIC_API_KEY + SRS dir (ANTHROPIC_API_KEY unset)");
if (!SRS_DIR) skip("requires ANTHROPIC_API_KEY + SRS dir (--srs-dir not provided)");
const PAIRS = discoverSrsPairs(SRS_DIR);
if (PAIRS.length === 0) skip(`requires ANTHROPIC_API_KEY + SRS dir (no *Forms*.xlsx found in ${SRS_DIR})`);

// ─── tiny HTTP helpers ───────────────────────────────────────────────
async function getJson(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function createSession({ formsPath, modellingPath, org, mode }) {
  const fd = new FormData();
  fd.set("forms", new Blob([fs.readFileSync(formsPath)]), "forms.xlsx");
  if (modellingPath) fd.set("modelling", new Blob([fs.readFileSync(modellingPath)]), "modelling.xlsx");
  fd.set("org", org || "H2HOrg");
  if (mode) fd.set("mode", mode);
  const r = await fetch(BASE + "/v1/sessions", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`create session → ${r.status} ${await r.text()}`);
  return r.json();
}
async function dispatch(sid, prompt) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let costUsd = 0;
  try {
    const response = await fetch(`${BASE}/v1/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${APIKEY}` },
      body: JSON.stringify({ prompt, model: MODEL }),
      signal: ac.signal,
    });
    if (!response.ok) throw new Error(`dispatch HTTP ${response.status}: ${await response.text()}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const evName = (block.match(/^event:\s*(.*)$/m) || [, ""])[1];
        const dataLine = (block.match(/^data:\s*([\s\S]*)$/m) || [, "{}"])[1];
        let data; try { data = JSON.parse(dataLine); } catch { continue; }
        if (evName === "agent" && data.type === "result" && typeof data.total_cost_usd === "number") {
          costUsd = data.total_cost_usd;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { costUsd };
}

// Extract validator + integrity at rest from the session metadata.
function metrics(meta) {
  const v = meta.validationAtCurrent || meta.validation || {};
  const integ = v.integrity || null;
  const integrityFindings = integ
    ? (typeof integ.errorCount === "number"
        ? integ.errorCount
        : Array.isArray(integ.findings)
          ? integ.findings.filter((f) => f.severity === "error").length
          : 0)
    : null;
  return {
    validatorErrors: v.errors ?? null,
    validatorWarnings: v.warnings ?? null,
    integrityOk: integ ? integ.ok : null,
    integrityErrorFindings: integrityFindings,
    integrityCounts: integ ? (integ.counts || null) : null,
  };
}

// ─── server lifecycle ────────────────────────────────────────────────
let serverProc = null;
function killServer() { if (serverProc && !serverProc.killed) { try { serverProc.kill("SIGTERM"); } catch {} } }
process.on("SIGINT", () => { killServer(); process.exit(130); });
process.on("SIGTERM", () => { killServer(); process.exit(143); });
process.on("exit", killServer);

async function waitForHealth(retries = 80) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy in time");
}
async function bootServer(sessionsDir) {
  const logPath = path.join(os.tmpdir(), `avni-h2h-${process.pid}-${PORT}.log`);
  const logFd = fs.openSync(logPath, "w");
  serverProc = spawn("node", ["src/server.js"], {
    cwd: SDK_DIR,
    env: { ...process.env, PORT: String(PORT), SDK_SESSIONS_DIR: sessionsDir },
    stdio: ["ignore", logFd, logFd],
  });
  await waitForHealth();
  return logPath;
}

// ─── one SRS through one arm ─────────────────────────────────────────
async function runArm(pair, mode) {
  const t0 = Date.now();
  const sess = await createSession({ ...pair, mode: mode === "agent" ? "agent" : undefined });
  let cost = 0;
  if (mode === "agent") {
    const d = await dispatch(sess.sessionId, AUTHORING_PROMPT);
    cost = d.costUsd;
  }
  const meta = await getJson(`/v1/sessions/${sess.sessionId}`);
  return {
    arm: mode,
    sessionId: sess.sessionId,
    ...metrics(meta),
    costUsd: Number(cost.toFixed(6)),
    wallClockMs: Date.now() - t0,
  };
}

// ─── main ────────────────────────────────────────────────────────────
(async () => {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "avni-h2h-sessions-"));
  const logPath = await bootServer(sessionsDir);
  process.stderr.write(`head-to-head: ${PAIRS.length} SRS(es), budget $${BUDGET.toFixed(2)} · server ${BASE}\n`);

  const rows = [];
  let cumulativeCost = 0;
  for (const pair of PAIRS) {
    process.stderr.write(`\n▸ ${pair.org}\n`);
    const row = { org: pair.org, forms: path.basename(pair.formsPath), baseline: null, agent: null, error: null };
    try {
      row.baseline = await runArm(pair, "baseline");
      process.stderr.write(`   baseline: ${row.baseline.validatorErrors} validator err · integrity ${row.baseline.integrityOk} · ${row.baseline.wallClockMs}ms\n`);
      if (cumulativeCost < BUDGET) {
        row.agent = await runArm(pair, "agent");
        cumulativeCost += row.agent.costUsd;
        process.stderr.write(`   agent:    ${row.agent.validatorErrors} validator err · integrity ${row.agent.integrityOk} · $${row.agent.costUsd.toFixed(4)} · ${row.agent.wallClockMs}ms\n`);
      } else {
        row.agent = { arm: "agent", skipped: true, reason: "budget exhausted" };
        process.stderr.write(`   agent:    SKIPPED (budget $${BUDGET.toFixed(2)} exhausted)\n`);
      }
    } catch (e) {
      row.error = e.message;
      process.stderr.write(`   ERROR: ${e.message}\n`);
    }
    rows.push(row);
  }

  killServer();

  const report = {
    status: "ran",
    generatedAt: new Date().toISOString(),
    srsDir: SRS_DIR,
    count: PAIRS.length,
    budgetUsd: BUDGET,
    totalAgentCostUsd: Number(cumulativeCost.toFixed(6)),
    model: MODEL || "(server matrix selection)",
    serverLog: logPath,
    rows,
  };
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    process.stderr.write(`\nreport → ${OUT}\n`);
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
})().catch((e) => {
  killServer();
  process.stderr.write(`head-to-head failed: ${e.stack || e.message}\n`);
  process.exit(1);
});
