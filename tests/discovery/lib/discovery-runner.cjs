// tests/discovery/lib/discovery-runner.cjs
//
// Observe-only one-scenario driver for the discovery harness (design §4.4).
//
// REUSES the eval harness machinery rather than copying it:
//   - tests/eval/lib/runner.cjs  → makeHttp, dispatchPrompt, createSession
//   - tests/eval/lib/fixture.cjs → synthetic SRS builders + bundle poisoner
//   - tests/eval/lib/assertions.cjs → unauthorized-commit / git probes
//
// Difference from the eval runner: this one is OBSERVE-ONLY. It always records
// a tool-usage histogram + flounder verdict and RETURNS them (runCase returns
// `toolUses`, the design's explicit requirement). It throws ONLY when a
// scenario's `safetyFloor(ctx)` throws — i.e. injection produced PWNED, or a
// destructive prompt produced an unauthorized commit / rm -rf forms/. Tool
// reach is measured, never gated.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const evalRunner = require("../../eval/lib/runner.cjs");
// discovery-fixture re-exports the eval fixture builders + adds the location /
// scale / multi-form shapes the d1–d8 scenarios need (and exposes
// poisonBundleForCode via the eval fixture it wraps).
const fixture = require("./discovery-fixture.cjs");
const evalFixture = require("../../eval/lib/fixture.cjs");
const assertions = require("../../eval/lib/assertions.cjs");
const { makeHttp, dispatchPrompt } = evalRunner;
const { buildToolHistogram, detectFlounder, listToolUses } = require("./histogram.cjs");

// createSession is not exported individually by the eval runner in older
// builds; reuse the public one if present, else inline the same multipart POST.
async function createSession(http, { formsBuffer, modellingBuffer, org }) {
  if (typeof evalRunner.createSession === "function") {
    return evalRunner.createSession(http, { formsBuffer, modellingBuffer, org });
  }
  const fd = new FormData();
  fd.set("forms", new Blob([formsBuffer]), "forms.xlsx");
  if (modellingBuffer) fd.set("modelling", new Blob([modellingBuffer]), "modelling.xlsx");
  fd.set("org", org || "DiscoveryOrg");
  return http.postMultipart("/v1/sessions", fd);
}

// ─── one-scenario driver ────────────────────────────────────────────
//
// A discovery scenario module shape (tests/discovery/scenarios/d*.cjs):
//   {
//     name: "d1-cold-srs-authoring",
//     description: "...",
//     setupFixture: ({ fixture }) => ({ formsBuffer, modellingBuffer?, org? }),
//     poison?: "C5" | "F2" | ...,          // optional, via fixture.poisonBundleForCode
//     prompt: "...",                        // MUST NOT name a tool (observe-only)
//     timeoutMs?, model?,
//     safetyFloor?: (ctx) => void           // throws ONLY on a safety violation
//   }
//
// Returns:
//   { name, status: "observed"|"fail"|"error",
//     toolUses, histogram, flounder, turnsUsed, cost, durationMs, ... }
async function runScenario({ scenarioDef, http, apiKey, sessionsDir, log = () => {} }) {
  const start = Date.now();

  if (typeof scenarioDef.setupFixture !== "function") {
    return errResult(scenarioDef, "scenario missing setupFixture()", start);
  }

  // 1. Build fixture
  let fx;
  try {
    fx = scenarioDef.setupFixture({ fixture });
  } catch (e) {
    return errResult(scenarioDef, `setupFixture threw: ${e.message}`, start);
  }
  const { formsBuffer, modellingBuffer, org = "DiscoveryOrg" } = fx;
  if (!formsBuffer) return errResult(scenarioDef, "setupFixture didn't return formsBuffer", start);

  // 2. Create session
  let session;
  try {
    session = await createSession(http, { formsBuffer, modellingBuffer, org });
  } catch (e) {
    return errResult(scenarioDef, `create session failed: ${e.message}`, start);
  }
  const sid = session.sessionId;
  const bundleDir = path.join(sessionsDir, sid, "bundle");

  // 3. Optional poison (e.g. d2 Durga corruption-repair) — reuse the eval
  // poisoner, then commit the poison as a Wizard-of-Oz /edit turn so the
  // server's validator state reflects it.
  if (scenarioDef.poison) {
    try {
      const meta = evalFixture.poisonBundleForCode(bundleDir, scenarioDef.poison);
      await applyPoisonEdit(http, sid, bundleDir, `discovery: seed ${scenarioDef.poison}`);
      fx.poisonMeta = meta;
    } catch (e) {
      return errResult(scenarioDef, `poison ${scenarioDef.poison} failed: ${e.message}`, start);
    }
  }

  // 4. Snapshot pre-dispatch HEAD (for the destructive-refusal safety floor).
  const preDispatchSha = gitHead(bundleDir);

  // Capture validator state BEFORE for no-validator-progress flounder signal.
  let validatorBefore = null;
  try {
    const meta = await http.getJson(`/v1/sessions/${sid}`);
    validatorBefore = (meta.validationAtCurrent || meta.validation || {}).errors ?? null;
  } catch { /* best effort */ }

  // 5. Dispatch the (tool-agnostic) prompt.
  let dispatch;
  try {
    dispatch = await dispatchPrompt({
      http, sid,
      prompt: scenarioDef.prompt,
      apiKey,
      model: scenarioDef.model,
      timeoutMs: scenarioDef.timeoutMs || 240_000,
    });
  } catch (e) {
    return errResult(scenarioDef, `dispatch failed: ${e.message}`, start, { sid });
  }

  // 6. Build the observation: tool-uses, histogram, flounder verdict.
  const toolUses = listToolUses(dispatch.agentEvents);
  const histogram = buildToolHistogram(dispatch.agentEvents);

  let validatorAfter = null;
  try {
    const meta = await http.getJson(`/v1/sessions/${sid}`);
    validatorAfter = (meta.validationAtCurrent || meta.validation || {}).errors ?? null;
  } catch { /* best effort */ }

  const tokensUsed = (dispatch.inputTokens || 0) + (dispatch.outputTokens || 0);
  const turnsUsed = dispatch.turnEvent?.turn || 0;
  const flounder = detectFlounder({
    agentEvents: dispatch.agentEvents,
    tokensUsed,
    turnsUsed,
    validatorProgress:
      validatorBefore != null && validatorAfter != null
        ? { before: validatorBefore, after: validatorAfter }
        : null,
  });

  // 7. Safety floor — the ONLY thing that can fail a discovery scenario.
  const ctx = {
    sessionId: sid,
    bundleDir,
    preDispatchSha,
    agentEvents: dispatch.agentEvents,
    toolUses,
    histogram,
    flounder,
    assertions,
    async getTranscript() { return http.getJson(`/v1/sessions/${sid}/transcript`); },
    joinAssistantText: assertions.joinAssistantText,
  };

  let safetyError = null;
  if (typeof scenarioDef.safetyFloor === "function") {
    try {
      await scenarioDef.safetyFloor(ctx);
    } catch (e) {
      safetyError = e;
    }
  }

  const durationMs = Date.now() - start;
  const base = {
    name: scenarioDef.name,
    description: scenarioDef.description || "",
    sessionId: sid,
    toolUses,
    histogram,
    flounder,
    turnsUsed,
    tokensUsed,
    cost: dispatch.costUsd || 0,
    inputTokens: dispatch.inputTokens || 0,
    outputTokens: dispatch.outputTokens || 0,
    validatorBefore,
    validatorAfter,
    durationMs,
  };

  if (safetyError) {
    return { ...base, status: "fail", error: safetyError.message };
  }
  return { ...base, status: "observed" };
}

// ─── helpers ────────────────────────────────────────────────────────

function gitHead(bundleDir) {
  try {
    const { execFileSync } = require("node:child_process");
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: bundleDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return null; }
}

// Commit whatever the poisoner changed on disk via the Wizard-of-Oz /edit
// route, so the server's validator state reflects the poison. Mirrors the eval
// runner's private applyPoison.
async function applyPoisonEdit(http, sid, bundleDir, summary) {
  const { execFileSync } = require("node:child_process");
  const out = execFileSync("git", ["status", "--porcelain", "-z"], {
    cwd: bundleDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const edits = {};
  for (const entry of out.split("\0").filter((e) => e.length >= 4)) {
    const rel = entry.slice(3);
    const fp = path.join(bundleDir, rel);
    edits[rel] = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : null;
  }
  if (Object.keys(edits).length === 0) return null;
  return http.postJson(`/v1/sessions/${sid}/edit`, { summary, edits });
}

function errResult(scenarioDef, message, start, extra = {}) {
  return {
    name: scenarioDef.name,
    status: "error",
    error: message,
    toolUses: [],
    histogram: buildToolHistogram([]),
    flounder: { floundered: false, reasons: [], signals: {} },
    turnsUsed: 0,
    cost: 0,
    durationMs: Date.now() - start,
    sessionId: extra.sid,
  };
}

module.exports = { runScenario, makeHttp, createSession };
