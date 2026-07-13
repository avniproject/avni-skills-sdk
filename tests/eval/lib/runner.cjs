// tests/eval/lib/runner.cjs
//
// One-case orchestrator. Spawned per case by tests/eval/run.cjs.
//
// Responsibilities:
//   1. Build the case's synthetic SRS fixture (xlsx buffers).
//   2. POST /v1/sessions multipart to create the session + first-pass bundle.
//   3. If the case wants to poison the bundle for a specific error code
//      (C5 / F2 / ...), mutate concepts.json/forms in place AFTER session
//      creation and commit a poisoning turn via /v1/sessions/:id/edit. The
//      validator state on disk reflects the poison from that point on.
//   4. POST /v1/sessions/:id/messages with the case's prompt, consume the
//      SSE stream, capture every `agent` event + the final `turn` + cost.
//   5. Build a `ctx` object and call case.assertions(ctx). Throws on failure.
//
// Does NOT manage server lifecycle — the parent (run.cjs) owns boot/kill.
// Does NOT enforce the global budget — the parent halts the run if needed.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const fixture = require("./fixture.cjs");
const assertions = require("./assertions.cjs");

// ─── tiny HTTP helpers (no external deps) ──────────────────────────

function makeHttp(base) {
  return {
    base,
    async getJson(p) {
      const r = await fetch(base + p);
      if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${await r.text()}`);
      return r.json();
    },
    async getText(p) {
      const r = await fetch(base + p);
      if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${await r.text()}`);
      return r.text();
    },
    async postJson(p, body, { headers = {} } = {}) {
      const r = await fetch(base + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`POST ${p} → ${r.status} ${await r.text()}`);
      return r.json();
    },
    async postMultipart(p, fd) {
      const r = await fetch(base + p, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`POST ${p} → ${r.status} ${await r.text()}`);
      return r.json();
    },
  };
}

async function createSession(http, { formsBuffer, modellingBuffer, org, mode }) {
  const fd = new FormData();
  fd.set("forms", new Blob([formsBuffer]), "forms.xlsx");
  if (modellingBuffer) fd.set("modelling", new Blob([modellingBuffer]), "modelling.xlsx");
  fd.set("org", org || "TestOrg");
  // story #12: mode:'agent' starts an EMPTY workspace with the SRS in input/;
  // default (omitted) is baseline (deterministic generator at turn 0).
  if (mode) fd.set("mode", mode);
  return http.postMultipart("/v1/sessions", fd);
}

// Apply pre-supplied edits as a Wizard-of-Oz turn (no LLM). Used to commit
// a "poisoned" version of the bundle that exhibits a specific validator
// error code.
async function applyPoison(http, sid, bundleDirOnDisk, summary) {
  // Read everything that diverges from HEAD, ship it as { path → content }.
  // We compute the working diff by re-reading the on-disk files and posting
  // them all; the server will git add and commit.
  // But /edit needs a content map — we use git to find what changed.
  const { execFileSync } = require("node:child_process");
  const out = execFileSync("git", ["status", "--porcelain", "-z"], {
    cwd: bundleDirOnDisk, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const edits = {};
  for (const entry of out.split("\0").filter((e) => e.length >= 4)) {
    const rel = entry.slice(3);
    const fp = path.join(bundleDirOnDisk, rel);
    edits[rel] = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : null;
  }
  if (Object.keys(edits).length === 0) return null;
  return http.postJson(`/v1/sessions/${sid}/edit`, { summary, edits });
}

// ─── SSE stream consumer for /messages ─────────────────────────────

async function dispatchPrompt({ http, sid, prompt, apiKey, model, timeoutMs }) {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(`${http.base}/v1/sessions/${sid}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt, model }),
      signal: ac.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw new Error(`dispatch fetch failed: ${e.message}`);
  }
  if (!response.ok) {
    if (timer) clearTimeout(timer);
    throw new Error(`dispatch HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const agentEvents = [];
  let turnEvent = null;
  let doneEvent = null;
  let errorEvent = null;
  let costUsd = 0;
  let inputTokens = 0, outputTokens = 0;
  let lastEventTs = Date.now();
  // Story #13: the server's `start` SSE event reports the model selectModel()
  // actually chose (respecting SDK_MODEL / caller model / matrix). Capturing it
  // lets the model-matrix regenerator attribute each case result to a model.
  let serverModel = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const evName = (block.match(/^event:\s*(.*)$/m) || [, ""])[1];
      const dataLine = (block.match(/^data:\s*([\s\S]*)$/m) || [, "{}"])[1];
      let data;
      try { data = JSON.parse(dataLine); } catch { continue; }
      lastEventTs = Date.now();
      if (evName === "start") {
        if (data && typeof data.model === "string") serverModel = data.model;
      } else if (evName === "agent") {
        agentEvents.push(data);
        if (data.type === "result" && typeof data.total_cost_usd === "number") {
          costUsd = data.total_cost_usd;
          if (data.usage) {
            inputTokens = data.usage.input_tokens || inputTokens;
            outputTokens = data.usage.output_tokens || outputTokens;
          }
        }
      } else if (evName === "turn") {
        turnEvent = data;
      } else if (evName === "done") {
        doneEvent = data;
      } else if (evName === "error") {
        errorEvent = data;
      } else if (evName === "circuit-break") {
        // Wallet aborted — surface as an error condition the case can see
        errorEvent = { circuitBreak: true, ...data };
      }
    }
  }
  if (timer) clearTimeout(timer);
  return {
    agentEvents,
    turnEvent,
    doneEvent,
    errorEvent,
    costUsd,
    inputTokens,
    outputTokens,
    lastEventTs,
    serverModel,
  };
}

// ─── one-case driver ───────────────────────────────────────────────

async function runCase({ caseDef, http, apiKey, sessionsDir, envOverrides = {}, evalModel = "", log = () => {} }) {
  const start = Date.now();
  if (caseDef.pending) {
    return {
      name: caseDef.name,
      category: caseDef.category || null,
      status: "pending",
      pendingReason: caseDef.pendingReason || "not yet implemented",
      durationMs: Date.now() - start,
      cost: 0,
      turnsUsed: 0,
    };
  }

  if (typeof caseDef.setupFixture !== "function") {
    return errResult(caseDef, "case missing setupFixture()", start);
  }
  if (typeof caseDef.assertions !== "function") {
    return errResult(caseDef, "case missing assertions()", start);
  }

  // 1. Build fixture
  let fx;
  try {
    fx = caseDef.setupFixture({ fixture });
  } catch (e) {
    return errResult(caseDef, `setupFixture threw: ${e.message}`, start);
  }
  const { formsBuffer, modellingBuffer, org = "TestOrg" } = fx;
  if (!formsBuffer) return errResult(caseDef, "setupFixture didn't return formsBuffer", start);
  // story #12: a case may pin the session mode ('agent' | 'baseline'); default baseline.
  const sessionMode = caseDef.mode || fx.mode;

  // 2. Create session
  let session;
  try {
    session = await createSession(http, { formsBuffer, modellingBuffer, org, mode: sessionMode });
  } catch (e) {
    return errResult(caseDef, `create session failed: ${e.message}`, start);
  }
  const sid = session.sessionId;
  const bundleDir = path.join(sessionsDir, sid, "bundle");
  log(`  session ${sid} created (turn 0, errors=${session.validation?.errors || 0})`);

  // 3. Optional poison step — mutate the bundle on disk + commit via /edit
  if (caseDef.poison) {
    try {
      const poisonMeta = fixture.poisonBundleForCode(bundleDir, caseDef.poison);
      const applied = await applyPoison(http, sid, bundleDir, `eval: seed ${caseDef.poison}`);
      log(`  poisoned with ${caseDef.poison} (turn now ${applied?.turn})`);
      fx.poisonMeta = poisonMeta;
    } catch (e) {
      return errResult(caseDef, `poison ${caseDef.poison} failed: ${e.message}`, start);
    }
  }

  // 4. Snapshot pre-dispatch state for assertions
  const preDispatchSha = (() => {
    try {
      const { execFileSync } = require("node:child_process");
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: bundleDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch { return null; }
  })();

  // Pre-dispatch validator snapshot — the BASELINE. Cases assert on the DELTA
  // the agent is responsible for (assertNoValidatorRegression), so inherent
  // fixture/brain-version errors that predate the turn never cause a false fail.
  let baselineValidator = { errors: 0, warnings: 0, groups: {} };
  try {
    const meta = await http.getJson(`/v1/sessions/${sid}`);
    baselineValidator = meta.validationAtCurrent || meta.validation || baselineValidator;
  } catch { /* best-effort — leave the empty baseline */ }

  // 5. Dispatch the prompt. FIX 3 (#13 review): a per-case `caseDef.model` is an
  // EXPLICIT per-request pin (e.g. a frontier-only case) and must WIN over the
  // run-wide SDK_EVAL_MODEL (evalModel) — otherwise a broad `SDK_EVAL_MODEL=haiku`
  // sweep silently contaminates a case that pinned a frontier model. SDK_EVAL_MODEL
  // still pins every case that does NOT set its own model. Absent both, the server
  // selects via the matrix and the chosen model is captured from the `start`
  // event (dispatch.serverModel).
  const dispatchModel = caseDef.model || evalModel || undefined;
  let dispatch;
  try {
    dispatch = await dispatchPrompt({
      http, sid,
      prompt: caseDef.prompt,
      apiKey,
      model: dispatchModel,
      timeoutMs: caseDef.timeoutMs || Number(process.env.SDK_EVAL_TIMEOUT_MS) || 180_000,
    });
  } catch (e) {
    return errResult(caseDef, `dispatch failed: ${e.message}`, start, {
      sid, bundleDir,
    });
  }

  if (dispatch.errorEvent) {
    return errResult(
      caseDef,
      `agent emitted error event: ${JSON.stringify(dispatch.errorEvent)}`,
      start,
      { sid, bundleDir, dispatch },
    );
  }

  // 6. Build the assertion context + invoke
  let validatorCache = null;
  let transcriptCache = null;
  // MAJ-7: a case's assertions() may make its OWN in-process AI calls (e.g. a
  // standalone reviewBundle/reviewSpec) whose spend the chat-turn's
  // dispatch.costUsd never sees. recordReviewCost() lets the case add that spend
  // to the case's reported cost so run.cjs's running-cost budget gate AND the
  // per-case maxCostUsd guard both account for it. Default 0 → identical
  // behaviour for every existing case that never calls it.
  let extraCostUsd = 0;
  const ctx = {
    sessionId: sid,
    sessionMeta: session.meta,
    bundleDir,
    fixture,
    fx,
    http,
    agentEvents: dispatch.agentEvents,
    turnEvent: dispatch.turnEvent,
    doneEvent: dispatch.doneEvent,
    costUsd: dispatch.costUsd,
    inputTokens: dispatch.inputTokens,
    outputTokens: dispatch.outputTokens,
    preDispatchSha,
    baselineValidator,
    assertions,
    envOverrides,
    async getValidator() {
      if (validatorCache) return validatorCache;
      const meta = await http.getJson(`/v1/sessions/${sid}`);
      validatorCache = meta.validationAtCurrent || meta.validation || {
        errors: 0, warnings: 0, groups: {},
      };
      return validatorCache;
    },
    async getTranscript() {
      if (transcriptCache) return transcriptCache;
      transcriptCache = await http.getJson(`/v1/sessions/${sid}/transcript`);
      return transcriptCache;
    },
    async getCost() {
      return http.getJson(`/v1/sessions/${sid}/cost`);
    },
    async getMeta() {
      return http.getJson(`/v1/sessions/${sid}`);
    },
    getBundlePath() { return bundleDir; },
    // MAJ-7 — accumulate a case's own in-assertion AI spend into the reported cost.
    recordReviewCost(usd) { if (typeof usd === "number" && isFinite(usd) && usd > 0) extraCostUsd += usd; },
  };

  let assertErr = null;
  try {
    await caseDef.assertions(ctx);
  } catch (e) {
    assertErr = e;
  }

  // MAJ-7: the reported cost is the chat turn PLUS any in-assertion review spend.
  const totalCostUsd = dispatch.costUsd + extraCostUsd;

  // Cost guard runs LAST regardless — even if assertions passed, blowing
  // the per-case budget is a fail-flag. Bounds the FULL case spend (chat +
  // in-assertion review), not just the chat turn.
  if (!assertErr && typeof caseDef.maxCostUsd === "number") {
    try {
      assertions.assertCostUnder(totalCostUsd, caseDef.maxCostUsd, { label: caseDef.name });
    } catch (e) {
      assertErr = e;
    }
  }

  const durationMs = Date.now() - start;
  const usedModel = dispatch.serverModel || dispatchModel || null;
  if (assertErr) {
    return {
      name: caseDef.name,
      category: caseDef.category || null,
      model: usedModel,
      status: "fail",
      error: assertErr.message,
      stack: assertErr.stack,
      turnsUsed: dispatch.turnEvent?.turn ? (dispatch.turnEvent.noChanges ? 0 : 1) : 0,
      cost: totalCostUsd,
      inputTokens: dispatch.inputTokens,
      outputTokens: dispatch.outputTokens,
      sessionId: sid,
      durationMs,
    };
  }

  return {
    name: caseDef.name,
    category: caseDef.category || null,
    model: usedModel,
    status: "pass",
    turnsUsed: dispatch.turnEvent?.noChanges ? 0 : 1,
    cost: totalCostUsd,
    inputTokens: dispatch.inputTokens,
    outputTokens: dispatch.outputTokens,
    sessionId: sid,
    durationMs,
  };
}

function errResult(caseDef, message, start, extra = {}) {
  return {
    name: caseDef.name,
    category: caseDef.category || null,
    model: extra.dispatch?.serverModel || null,
    status: "fail",
    error: message,
    turnsUsed: 0,
    cost: extra.dispatch?.costUsd || 0,
    inputTokens: extra.dispatch?.inputTokens || 0,
    outputTokens: extra.dispatch?.outputTokens || 0,
    sessionId: extra.sid,
    durationMs: Date.now() - start,
  };
}

module.exports = { runCase, makeHttp, createSession, dispatchPrompt };
