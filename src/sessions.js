// Session-backed iterative bundle workspace.
//
// Each session is a filesystem dir containing a git repo. Every edit is
// committed as a turn. The session_id is opaque; sessions live under
// $SDK_SESSIONS_DIR (default: ~/.avni-skills-sdk/sessions — durable across
// reboots; macOS purges $TMPDIR which previously wiped demo sessions).
//
// We shell out to `git` rather than pull in simple-git — fewer deps, simpler
// reasoning. Git is available everywhere we'd deploy this.
//
// Public API:
//   createSession({ formsBuffer, formsFilename, modellingBuffer?, modellingFilename?, org? })
//     → { sessionId, meta, validation }
//   getSession(sessionId) → meta + current bundle file tree
//   listFiles(sessionId) → relative file paths
//   readFile(sessionId, relPath) → string
//   listTurns(sessionId) → [{ turn, sha, summary, ts, validatorState }]
//   diffTurn(sessionId, turn) → unified diff string
//   commitTurn(sessionId, summary, edits) → { turn, sha, validation }
//     where edits = { "path/inside/bundle.json": "new content", ... }
//   revertToTurn(sessionId, turn) → { current_turn, validation }
//   zipBundle(sessionId, zipPath?) → { zipPath, bytes }
//   deleteSession(sessionId)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { generateBundle, validateBundle, zipBundle as zipBundleDir } from "./bundle.js";
import { ensureSkillsStagedAt } from "./workspace.js";
import { validateBundleRules } from "./rules-brain/validate.js";
import { detectConceptCollisions, formatViolationMessage } from "./rules-brain/concept-gate.js";
import { runBundleIntegrityCheck, buildCrlScopingCtx, findReferencesOnDir } from "./agents/bundle-mcp-server.js";
// Phase 4 — the CRL per-change gate. crlGate/reviewSpec are only ever called
// inside function bodies below (never at module top-level), so the
// sessions.js → crl/review.js → bundle-mcp-server.js import graph stays a clean
// (function-body-only) cycle. See src/crl/review.js for the CRIT-1 key-guard
// that makes a keyless gate a no-op rather than a throw.
import { crlGate, reviewSpec } from "./crl/review.js";
// Phase 3 — the deterministic completeness floor (the "production-ready 🎉 while
// half-built" gate). Pure function of the bundle dir, no LLM; folded into the
// per-turn preamble so the agent can't claim done while it's red.
import { completenessFloor } from "./completeness.js";
// Prose cleanup — deterministic (+ opt-in AI) prune of prose-as-entity strays
// (see src/crl/prose-scrub.js). Wired at turn 0 (createSession, baseline mode)
// via the create route, and exposed here as scrubSessionBundle() for reuse by
// the :scrub command.
import { scrubProse } from "./crl/prose-scrub.js";
// O-2 — Live Spec View (spec-sync step). Pure filesystem + emit; this module
// owns none of git/gate — commitWorkspaceChanges below calls it and owns the
// commit + gate call itself, mirroring the CRL gate's own separation.
import { syncSpecView } from "./spec-view/sync.js";

const SESSIONS_DIR = process.env.SDK_SESSIONS_DIR || path.join(os.homedir(), ".avni-skills-sdk", "sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Cache of currentValidatorStateText() results keyed by sessionId. Entry shape:
// { sha: <HEAD git SHA at compute time>, text: <rendered preamble>, ts: <epoch ms> }.
// Invalidation is implicit: commitWorkspaceChanges()/commitTurn()/revertToTurn()
// all change HEAD, so the next read sees a SHA mismatch and recomputes.
const VALIDATOR_CACHE = new Map();

// Test-only escape hatch. The cache is keyed by HEAD SHA so it's correct
// across real flows, but test fixtures recycle session IDs across cases.
export function _resetValidatorCache() {
  VALIDATOR_CACHE.clear();
}

function newId() {
  return "sess_" + crypto.randomBytes(8).toString("hex");
}

function sessionPath(id) {
  if (!/^sess_[0-9a-f]{16}$/.test(id)) throw new Error("invalid session_id");
  const p = path.join(SESSIONS_DIR, id);
  if (!fs.existsSync(p)) throw new Error(`session not found: ${id}`);
  return p;
}

function git(cwd, ...args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`git ${args.join(" ")} failed: ${(e.stderr || e.message).slice(0, 300)}`);
  }
}

function readMeta(id) {
  const p = path.join(sessionPath(id), "meta.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeMeta(id, meta) {
  fs.writeFileSync(path.join(sessionPath(id), "meta.json"), JSON.stringify(meta, null, 2));
}

function summariseValidation(dir) {
  const r = validateBundle(dir);
  // Group errors by class for a tight summary
  const groups = {};
  for (const e of r.errors) {
    const k = (e.match(/^([A-Z][0-9]+)/) || ["?"])[0];
    groups[k] = (groups[k] || 0) + 1;
  }
  return { valid: r.valid, errors: r.errors.length, warnings: r.warnings.length, groups };
}

// FIX 1(a) — the INTEGRITY GATE, iteration-friendly half.
//
// `runBundleIntegrityCheck` had ZERO callers on the commit/inject path, so the
// two server-only traps (FE_CONCEPT_NOT_OBJECT / Durga + ALT_INVALID_NAME /
// Astitva, plus dangling REQUIRED refs) were tool+prose only — never a gate.
// This runs the deterministic integrity check and FOLDS its severity:error
// findings INTO the per-turn validation state so they surface to the agent
// every turn exactly like validator errors (closing the "validator shows 0,
// agent thinks done" hole). It does NOT hard-revert — the agent iterates.
//
// Returns a tight, structured summary; NEVER throws (a brain-graph load failure
// degrades to a null/empty integrity result so the validator half still works).
function summariseIntegrity(dir) {
  try {
    const { ok, findings } = runBundleIntegrityCheck(dir);
    const errorFindings = findings.filter((f) => f.severity === "error");
    const warningFindings = findings.filter((f) => f.severity === "warning");
    const counts = {};
    for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
    return {
      ok,
      errorCount: errorFindings.length,
      warningCount: warningFindings.length,
      counts,
      findings,
    };
  } catch (e) {
    // Fail-safe: integrity unavailable ⇒ don't block the validator half. `ok:null`
    // signals "not evaluated" so callers don't treat it as clean.
    return { ok: null, errorCount: 0, warningCount: 0, counts: {}, findings: [], error: e.message };
  }
}

// Combine the validator summary with the deterministic integrity summary into a
// single per-turn validation object. Back-compat: keeps `valid`/`errors`/
// `warnings`/`groups` (existing consumers rely on these), folding integrity
// severity:error into `valid`+`errors` so a bundle that is validator-clean but
// integrity-dirty is correctly reported NOT valid. The integrity detail is kept
// clearly labeled under `integrity` so the two sources never blur together.
function summariseValidationWithIntegrity(dir) {
  const v = summariseValidation(dir);
  const integrity = summariseIntegrity(dir);
  const groups = { ...v.groups };
  for (const [code, n] of Object.entries(integrity.counts)) {
    groups[code] = (groups[code] || 0) + n;
  }
  return {
    // integrity.ok === null (not evaluated) must NOT flip a valid bundle invalid.
    valid: v.valid && integrity.ok !== false,
    errors: v.errors + integrity.errorCount,
    warnings: v.warnings + integrity.warningCount,
    groups,
    integrity,
  };
}

// Run the Layer-4 rules validator across the bundle's rule fields.
// Returns a tight summary suitable for inclusion in turn output.
async function summariseRules(dir) {
  try {
    const r = await validateBundleRules(dir);
    const codes = {};
    for (const e of r.errors)   codes[e.code] = (codes[e.code] || 0) + 1;
    for (const w of r.warnings) codes[w.code] = (codes[w.code] || 0) + 1;
    return {
      valid: r.errors.length === 0,
      errors: r.errors.length,
      warnings: r.warnings.length,
      codes,
      filesAffected: Object.keys(r.byFile).length,
    };
  } catch {
    return { valid: true, errors: 0, warnings: 0, codes: {}, filesAffected: 0 };
  }
}

// ───────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────

/**
 * Create a session.
 *
 * Two modes (story #12):
 *   • "baseline" (DEFAULT) — the existing behaviour, byte-for-byte unchanged: runs
 *     the deterministic generator on the uploaded SRS and commits the
 *     first-pass bundle as turn 0. `formsBuffer` is required.
 *   • "agent" — the session is created AROUND an SRS (requirements) instead of
 *     an uploaded bundle. The bundle dir starts empty; the SRS is persisted so
 *     the agent can read it (bundle_read_srs) and optionally bootstrap a
 *     deterministic baseline (bundle_generate_baseline), then refine to clean.
 *
 * @param {Object} args
 * @param {Buffer}  [args.formsBuffer]       Forms.xlsx (required in baseline mode; optional generator input in agent mode)
 * @param {string}  [args.formsFilename]
 * @param {Buffer}  [args.modellingBuffer]   Modelling.xlsx (optional generator input)
 * @param {string}  [args.modellingFilename]
 * @param {string}  [args.org="Bundle"]
 * @param {"baseline"|"agent"} [args.mode="baseline"]
 * @param {string|Object} [args.srs]         agent-mode SRS as inline text or JSON (string or already-parsed object)
 */
export function createSession({ formsBuffer, formsFilename, modellingBuffer, modellingFilename, org = "Bundle", mode = "baseline", srs }) {
  if (mode === "agent") {
    return createAgentSession({ formsBuffer, modellingBuffer, org, srs });
  }
  if (mode !== "baseline") {
    throw new Error(`unknown session mode: ${JSON.stringify(mode)} (expected "baseline" or "agent")`);
  }
  // ─── BASELINE MODE (default) — behaviour below is unchanged from before #12 ───
  if (!formsBuffer) throw new Error("formsBuffer required");

  const id = newId();
  const dir = path.join(SESSIONS_DIR, id);
  const inputDir = path.join(dir, "input");
  const bundleDir = path.join(dir, "bundle");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  const formsPath = path.join(inputDir, formsFilename || "forms.xlsx");
  fs.writeFileSync(formsPath, formsBuffer);
  let modellingPath = null;
  if (modellingBuffer) {
    modellingPath = path.join(inputDir, modellingFilename || "modelling.xlsx");
    fs.writeFileSync(modellingPath, modellingBuffer);
  }

  // Run the deterministic generator into bundleDir
  generateBundle({ formsPath, modellingPath, org, outDir: bundleDir });

  // .gitignore — keep agent-staging artifacts out of the bundle's git history
  // and out of the final ZIP. We stage `.claude/skills/` symlinks here when
  // running Phase 4 messages, but those are not part of the bundle.
  fs.writeFileSync(path.join(bundleDir, ".gitignore"), ".claude/\n");

  // Init git in bundleDir, commit turn 0
  git(bundleDir, "init", "-b", "main");
  git(bundleDir, "config", "user.email", "agent@avni-skills-sdk");
  git(bundleDir, "config", "user.name", "avni-skills-sdk");
  git(bundleDir, "add", "-A");
  git(bundleDir, "commit", "-m", "turn 0: deterministic first-pass bundle");

  const validation = summariseValidation(bundleDir);

  const meta = {
    sessionId: id,
    org,
    mode: "baseline",
    createdAt: new Date().toISOString(),
    inputs: {
      forms: path.basename(formsPath),
      modelling: modellingPath ? path.basename(modellingPath) : null,
    },
    currentTurn: 0,
    validationAtCurrent: validation,
  };
  writeMeta(id, meta);

  return { sessionId: id, meta, validation };
}

// ─── agent mode (story #12) ─────────────────────────────────────────
//
// An agent-mode session is built AROUND requirements (an SRS), not an uploaded
// bundle. Unlike baseline mode, we do NOT run the deterministic generator at create
// time — the generator is DEMOTED from the pipeline to an agent-callable tool
// (bundle_generate_baseline). The bundle dir starts empty (only .gitignore, so
// git has a HEAD to commit turns against); the agent reads the SRS
// (bundle_read_srs), optionally bootstraps a baseline, then refines to clean.
//
// The SRS/Excel binaries are persisted under <session>/input/ (a SIBLING of
// <session>/bundle/, kept OUT of git) so the tools (which run with cwd =
// <session>/bundle) can reach them as ../input/ — the same sibling-access
// pattern bundle_export_to_path uses to read ../meta.json.
function createAgentSession({ formsBuffer, modellingBuffer, org, srs }) {
  const id = newId();
  const dir = path.join(SESSIONS_DIR, id);
  const inputDir = path.join(dir, "input");
  const bDir = path.join(dir, "bundle");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(bDir, { recursive: true });

  // Persist the SRS in whatever form(s) the caller supplied under input/. All
  // are optional; an agent session may start from pure prose, from structured
  // JSON, from XLSX generator inputs, or any combination. NO external path is
  // accepted (LFI closure, MAJOR-1) — everything read later is the session's own
  // input/ dir.
  const srsMeta = { kind: "none", files: {}, hasGeneratorInputs: false };

  if (typeof srs === "string" && srs.trim()) {
    // Inline SRS text. Store as JSON when it parses to an object/array, else raw.
    let parsed = null;
    try { parsed = JSON.parse(srs); } catch { /* not JSON — treat as prose */ }
    if (parsed !== null && typeof parsed === "object") {
      fs.writeFileSync(path.join(inputDir, "srs.json"), JSON.stringify(parsed, null, 2));
      srsMeta.files.json = "input/srs.json";
      srsMeta.kind = "json";
    } else {
      fs.writeFileSync(path.join(inputDir, "srs.txt"), srs);
      srsMeta.files.text = "input/srs.txt";
      srsMeta.kind = "text";
    }
  } else if (srs && typeof srs === "object") {
    // Already-parsed structured SRS object.
    fs.writeFileSync(path.join(inputDir, "srs.json"), JSON.stringify(srs, null, 2));
    srsMeta.files.json = "input/srs.json";
    srsMeta.kind = "json";
  }

  if (formsBuffer) {
    fs.writeFileSync(path.join(inputDir, "forms.xlsx"), formsBuffer);
    srsMeta.files.forms = "input/forms.xlsx";
    srsMeta.hasGeneratorInputs = true;
    if (srsMeta.kind === "none") srsMeta.kind = "xlsx";
  }
  if (modellingBuffer) {
    fs.writeFileSync(path.join(inputDir, "modelling.xlsx"), modellingBuffer);
    srsMeta.files.modelling = "input/modelling.xlsx";
  }

  // .gitignore keeps the input/ binaries + agent-staging artifacts out of the
  // bundle git history, and gives git a first tracked file so turn 0 is a real
  // (near-empty) commit against which later turns diff.
  fs.writeFileSync(path.join(bDir, ".gitignore"), ".claude/\ninput/\n");
  git(bDir, "init", "-b", "main");
  git(bDir, "config", "user.email", "agent@avni-skills-sdk");
  git(bDir, "config", "user.name", "avni-skills-sdk");
  git(bDir, "add", "-A");
  git(bDir, "commit", "-m", "turn 0: empty workspace (agent mode)");

  // Agent-mode sentinel (story #12 gotcha): the empty workspace is the EXPECTED
  // starting point, not a defect. Do NOT run the raw validator here — it would
  // record a dozen "Missing required file" errors in meta and scare the agent on
  // turn 1. Record an explicit empty-workspace marker instead.
  const validation = { valid: false, errors: 0, warnings: 0, groups: {}, emptyWorkspace: true };

  const meta = {
    sessionId: id,
    org: org || "Bundle",
    mode: "agent",
    createdAt: new Date().toISOString(),
    srs: srsMeta,
    currentTurn: 0,
    validationAtCurrent: validation,
  };
  writeMeta(id, meta);

  return { sessionId: id, meta, validation };
}

export function getSession(id) {
  const meta = readMeta(id);
  return meta;
}

// Session mode (story #12). Absent on pre-#12 sessions → "baseline" (the historical
// default), so old sessions and the byte-identical baseline path are unaffected.
export function getSessionMode(id) {
  try { return readMeta(id).mode === "agent" ? "agent" : "baseline"; }
  catch { return "baseline"; }
}

// Persist the Claude Agent SDK's internal session id on first dispatch so
// subsequent turns can pass `resume: <id>` to query() and inherit the full
// prior transcript (user + assistant + tool_use + tool_result). The SDK
// stores the underlying JSONL at ~/.claude/projects/<encoded-cwd>/<id>.jsonl
// — keyed by cwd, which we hold stable per session.
export function setSdkSessionId(id, sdkSessionId) {
  if (!sdkSessionId || typeof sdkSessionId !== "string") return;
  const meta = readMeta(id);
  if (meta.sdkSessionId === sdkSessionId) return; // already set, no-op
  meta.sdkSessionId = sdkSessionId;
  writeMeta(id, meta);
}

export function getSdkSessionId(id) {
  const meta = readMeta(id);
  return meta.sdkSessionId || null;
}

// Agent-mode empty-workspace sentinel (story #12 gotcha). Before authorship
// begins the bundle dir is intentionally empty; the raw validator would report a
// dozen "Missing required file" errors and turn 1 would burn "fixing" emptiness.
// This sentinel is injected INSTEAD so the agent knows the empty state is the
// expected starting point, not a defect list.
export const AGENT_EMPTY_WORKSPACE_SENTINEL =
  "CURRENT VALIDATOR + INTEGRITY STATE (server-truth): AGENT MODE — the workspace is EMPTY (no bundle authored yet). " +
  "This is the EXPECTED starting point, NOT a set of errors to fix: do NOT treat missing bundle files as validator " +
  "defects and do NOT spend this turn 'fixing' emptiness. Read the requirements with mcp__avni-bundle__bundle_read_srs " +
  "(the uploaded spreadsheet(s) live in ../input/), then author the bundle — optionally bootstrap with " +
  "mcp__avni-bundle__bundle_generate_baseline. The real validator + integrity state is reported normally once you have " +
  "authored files.";

// True when an agent-mode bundle dir holds no authored content yet (only git
// bookkeeping / .gitignore / staged skills). Used to gate the sentinel above.
function agentWorkspaceIsEmpty(dir) {
  try {
    const ignore = new Set([".git", ".gitignore", ".claude"]);
    return !fs.readdirSync(dir).some((n) => !ignore.has(n));
  } catch {
    return true;
  }
}

// Build a human-readable preamble describing the bundle's CURRENT validator
// state, suitable for prepending to every per-turn agent prompt. Stops the
// agent from re-discovering the error (one cold turn = ~$0.15) and from
// hallucinating wrong codes ("C3" when it's actually C5). Capped at 8 errors
// + 5 warnings so it never bloats the prompt.
export function currentValidatorStateText(id) {
  // Cache by HEAD SHA. On 1000-concept bundles the full validator is
  // non-trivial; the per-turn prompt dispatch path calls this on every turn.
  // SHA equality is the right cache key: any agent commit (or revert) changes
  // HEAD, so the next read recomputes naturally — no manual invalidation.
  let bundleDir, headSha;
  try {
    bundleDir = path.join(sessionPath(id), "bundle");
    headSha = git(bundleDir, "rev-parse", "HEAD").trim();
  } catch (e) {
    return "";
  }
  const cached = VALIDATOR_CACHE.get(id);
  if (cached && cached.sha === headSha) return cached.text;

  // Agent-mode empty-workspace sentinel (story #12 gotcha) — flows through the
  // per-turn injection (currentValidatorStateText), not just the create
  // response, so turn 1 doesn't see a dozen missing-file "errors".
  let sessionMode;
  try { sessionMode = readMeta(id).mode; } catch { sessionMode = undefined; }
  if (sessionMode === "agent" && agentWorkspaceIsEmpty(bundleDir)) {
    VALIDATOR_CACHE.set(id, { sha: headSha, text: AGENT_EMPTY_WORKSPACE_SENTINEL, ts: Date.now() });
    return AGENT_EMPTY_WORKSPACE_SENTINEL;
  }

  let r;
  try {
    r = validateBundle(bundleDir);
  } catch (e) {
    return "";
  }
  // FIX 1(a): also fold the deterministic INTEGRITY findings into the injected
  // state so integrity errors surface to the agent every turn exactly like
  // validator errors. Kept clearly LABELED and separate from the validator
  // section so the two sources never blur. Never throws (summariseIntegrity
  // fail-safes to an empty result).
  const integrity = summariseIntegrity(bundleDir);
  const integrityErrors = integrity.findings.filter((f) => f.severity === "error");
  const integrityWarnings = integrity.findings.filter((f) => f.severity === "warning");

  // Phase 4 — durable cross-session CRL state. Read straight from meta, NOT
  // recomputed here: crlGate already ran once, inside commitWorkspaceChanges,
  // for the turn that produced the current HEAD. This is what lets a bundle
  // resumed cold (fresh SDK session, or resumed months later) see the last
  // review-layer outcome — including a still-unresolved HITL escalation, or that
  // the gate was deliberately disabled — instead of re-litigating it or silently
  // losing it.
  let crl = null;
  try { crl = readMeta(id).crlAtCurrent || null; } catch { crl = null; }

  // Phase 3 — deterministic completeness floor. Fresh per turn (like integrity);
  // never throws. A red floor means the bundle is semantically half-built even
  // if the validator/integrity/CRL are clean — so it must block a "done" claim.
  let completeness;
  try { completeness = completenessFloor(bundleDir); }
  catch (e) { completeness = { green: false, evaluated: false, findings: [], error: e.message }; }
  const completenessClean = completeness.evaluated && completeness.green;

  const validatorClean = r.valid && r.warnings.length === 0;
  const integrityClean = integrityErrors.length === 0 && integrityWarnings.length === 0;
  // A bundle can be validator-clean AND integrity-clean yet still carry an
  // unresolved CRL finding (a stray prose-form, an orphan concept, a pending
  // HITL escalation) — or the gate may simply not have been evaluated
  // (SDK_CRL_GATE=off, or a CRL-layer failure). Either way the "fully clean"
  // shortcut below must not hide that.
  const crlClean = !crl || crl.pass === true;

  let text;
  if (validatorClean && integrityClean && crlClean && completenessClean) {
    text = "CURRENT VALIDATOR + INTEGRITY + COMPLETENESS STATE (server-truth): ✓ bundle is clean — no validator errors, no integrity errors, no warnings, CRL review passed, completeness floor green.";
  } else {
    const lines = ["CURRENT VALIDATOR + INTEGRITY STATE (server-truth — do not re-discover, do not guess error codes, do not fabricate codes):"];
    // ── validator section ──
    if (r.errors.length || r.warnings.length) {
      lines.push("  VALIDATOR:");
      if (r.errors.length) {
        lines.push(`    errors (${r.errors.length}):`);
        for (const e of r.errors.slice(0, 8)) lines.push(`      • ${e}`);
        if (r.errors.length > 8) lines.push(`      … and ${r.errors.length - 8} more`);
      }
      if (r.warnings.length) {
        lines.push(`    warnings (${r.warnings.length}):`);
        for (const w of r.warnings.slice(0, 5)) lines.push(`      • ${w}`);
        if (r.warnings.length > 5) lines.push(`      … and ${r.warnings.length - 5} more`);
      }
    } else {
      lines.push("  VALIDATOR: ✓ clean.");
    }
    // ── integrity section (FE_CONCEPT_NOT_OBJECT / ALT_INVALID_NAME / dangling refs) ──
    if (integrityErrors.length || integrityWarnings.length) {
      lines.push("  INTEGRITY (data-integrity checks the validator does NOT catch — a clean validator does NOT mean a clean upload):");
      if (integrityErrors.length) {
        lines.push(`    errors (${integrityErrors.length}):`);
        for (const f of integrityErrors.slice(0, 8)) lines.push(`      • [${f.code}] ${f.file} ${f.locator} — ${f.message}`);
        if (integrityErrors.length > 8) lines.push(`      … and ${integrityErrors.length - 8} more`);
      }
      if (integrityWarnings.length) {
        lines.push(`    warnings (${integrityWarnings.length}):`);
        for (const f of integrityWarnings.slice(0, 5)) lines.push(`      • [${f.code}] ${f.file} ${f.locator} — ${f.message}`);
        if (integrityWarnings.length > 5) lines.push(`      … and ${integrityWarnings.length - 5} more`);
      }
    } else if (integrity.ok !== null) {
      lines.push("  INTEGRITY: ✓ clean.");
    }
    // ── CRL section (Phase 4 — durable per-change gate result) ──
    if (crl) {
      lines.push("  CRL (compliance-guided review — last per-change gate result):");
      if (crl.pass === null) {
        if (crl.disabled) {
          lines.push("    disabled (SDK_CRL_GATE=off) — not evaluated this turn.");
        } else {
          lines.push(`    unknown — CRL did not run last turn (${crl.error || "unavailable"}). Not evaluated; do not treat as clean.`);
        }
      } else if (crl.escalated) {
        const reason = (crl.review && crl.review.escalate && crl.review.escalate.reason) || "unspecified";
        lines.push(`    ESCALATED (HITL pause) after ${crl.retries} retr${crl.retries === 1 ? "y" : "ies"}: ${reason}`);
        lines.push("    Surface this to the user and get their call before proceeding — do not guess a resolution.");
      } else if (crl.pass === false) {
        lines.push("    findings present — call mcp__avni-bundle__bundle_review for detail before continuing.");
      } else {
        lines.push("    ✓ clean — deterministic + AI-judged review passed.");
      }
    }
    // ── COMPLETENESS section (Phase 3 — deterministic semantic-build floor) ──
    if (!completeness.evaluated) {
      lines.push("  COMPLETENESS: unknown — floor could not be evaluated. Not clean; do not treat as done.");
    } else if (completeness.findings.length) {
      lines.push("  COMPLETENESS (deterministic semantic-build floor — a clean validator does NOT mean the bundle is built):");
      lines.push(`    findings (${completeness.findings.length}):`);
      for (const f of completeness.findings.slice(0, 8)) lines.push(`      • [${f.code}] ${f.entity} — ${f.message}`);
      if (completeness.findings.length > 8) lines.push(`      … and ${completeness.findings.length - 8} more`);
    } else {
      lines.push("  COMPLETENESS: ✓ floor green (no prose-as-entity leaks, forms present, content forms carry fields).");
    }
    lines.push("");
    lines.push("If the user says \"what is the error?\" or \"fix the error\", refer to the items above verbatim. Validator codes are real (C-class = concepts, F-class = forms/formMappings, R-class = rules, G-class = enums); integrity codes (FE_CONCEPT_NOT_OBJECT, ALT_INVALID_NAME, MISSING_REQUIRED_REF, DANGLING_REF) are the server-only traps; completeness codes (PROSE_AS_ENTITY, NO_FORMS, FORM_NO_ELEMENTS) are the semantic-build floor. Use them exactly as shown. Do not invent a code that is not in this list. The bundle is NOT ready to export — and you MUST NOT tell the user it is \"done\", \"production-ready\", or \"ready to export\" — until the VALIDATOR, INTEGRITY, and COMPLETENESS sections are all error-free AND any CRL escalation above has been resolved with the user. A red COMPLETENESS floor means the bundle is still half-built; surface those findings and keep working, do not downgrade them to \"optional\".");
    text = lines.join("\n");
  }
  VALIDATOR_CACHE.set(id, { sha: headSha, text, ts: Date.now() });
  return text;
}

export function listFiles(id) {
  const dir = path.join(sessionPath(id), "bundle");
  const out = [];
  function walk(p, rel = "") {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const fp = path.join(p, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(fp, r);
      else out.push(r);
    }
  }
  walk(dir);
  return out.sort();
}

export function readFile(id, relPath) {
  // prevent path traversal
  if (relPath.includes("..")) throw new Error("invalid path");
  const dir = path.join(sessionPath(id), "bundle");
  const fp = path.join(dir, relPath);
  if (!fp.startsWith(dir + path.sep)) throw new Error("invalid path");
  if (!fs.existsSync(fp)) throw new Error("file not found");
  return fs.readFileSync(fp, "utf8");
}

export function listTurns(id) {
  const dir = path.join(sessionPath(id), "bundle");
  const log = git(dir, "log", "--reverse", "--pretty=format:%H%x09%s%x09%cI");
  const turns = [];
  for (const line of log.split("\n").filter(Boolean)) {
    const [sha, summary, ts] = line.split("\t");
    const m = summary.match(/^turn (\d+):\s*(.*)$/);
    turns.push({
      turn: m ? Number(m[1]) : turns.length,
      sha: sha.slice(0, 12),
      summary: m ? m[2] : summary,
      ts,
    });
  }
  return turns;
}

export function diffTurn(id, turn) {
  const dir = path.join(sessionPath(id), "bundle");
  const log = git(dir, "log", `--pretty=format:%H%x09%s`).split("\n");
  const target = log.find((l) => l.split("\t")[1].startsWith(`turn ${turn}:`));
  if (!target) throw new Error(`turn ${turn} not found`);
  const sha = target.split("\t")[0];
  // Diff vs previous commit
  try {
    return git(dir, "diff", `${sha}^`, sha);
  } catch {
    // No parent (turn 0) — diff against empty tree
    return git(dir, "show", sha);
  }
}

/**
 * Commit a new turn with the given file edits applied.
 * @param {string} id sessionId
 * @param {string} summary one-line turn summary
 * @param {Object<string,string>} edits relative-path → new file content (UTF-8 string).
 *   Set value to `null` to delete the file.
 */
export function commitTurn(id, summary, edits) {
  const dir = path.join(sessionPath(id), "bundle");
  for (const [rel, content] of Object.entries(edits || {})) {
    if (rel.includes("..")) throw new Error("invalid path");
    const fp = path.join(dir, rel);
    if (!fp.startsWith(dir + path.sep)) throw new Error("invalid path");
    if (content === null) {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } else {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content);
    }
  }
  // Bump turn counter
  const meta = readMeta(id);
  const newTurn = meta.currentTurn + 1;
  git(dir, "add", "-A");
  // Allow no-op (no edits) for symmetry, but require message
  try {
    git(dir, "commit", "--allow-empty", "-m", `turn ${newTurn}: ${summary}`);
  } catch (e) {
    throw new Error(`commit failed: ${e.message}`);
  }
  const sha = git(dir, "rev-parse", "HEAD").trim();
  const validation = summariseValidation(dir);

  meta.currentTurn = newTurn;
  meta.validationAtCurrent = validation;
  writeMeta(id, meta);

  return { turn: newTurn, sha: sha.slice(0, 12), summary, validation };
}

/**
 * Return the absolute path to the session's bundle dir.
 * Used by the Phase 4 messages endpoint as the agent's cwd.
 */
export function bundleDir(id) {
  return path.join(sessionPath(id), "bundle");
}

/**
 * Run the deterministic (+ opt-in AI) prose scrub against a session's bundle
 * dir and commit any prunes as a follow-up turn. Never throws — scrubProse
 * itself degrades to a partial report on internal failure (see
 * src/crl/prose-scrub.js); this wrapper does not add its own try/catch so a
 * git failure surfaces loudly to the caller, matching every other git-backed
 * mutator in this module.
 *
 * Used by:
 *   • the turn-0 wiring in the create route (src/routes/sessions-lifecycle.js),
 *     gated behind SDK_PROSE_SCRUB, baseline mode only;
 *   • the `:scrub` command (reruns the scrub on demand against the current
 *     bundle state).
 *
 * @param {string} id sessionId
 * @param {{ai?: boolean}} [opts] ai=true also runs the AI-judged pass (requires
 *   ANTHROPIC_API_KEY; scrubProse no-ops that stage otherwise).
 * @returns {Promise<{pruned:object[], skipped:object[], reverted:object[], report:string, error?:string}>}
 */
export async function scrubSessionBundle(id, { ai = false } = {}) {
  const dir = bundleDir(id);
  const r = await scrubProse(dir, { ai });
  if (r.pruned.length) {
    git(dir, "add", "-A");
    git(dir, "commit", "-m", `scrub: prose cleanup (${r.pruned.length} pruned)`);
  }
  return r;
}

/**
 * Stage avni-skills under <session>/bundle/.claude/skills/ and confirm
 * `.gitignore` excludes that path so staged skills never get committed.
 * Idempotent. Returns { staged, total }.
 */
export function ensureSessionSkillsStaged(id) {
  const dir = bundleDir(id);
  const giPath = path.join(dir, ".gitignore");
  const giHas = fs.existsSync(giPath) && fs.readFileSync(giPath, "utf8").split(/\r?\n/).some((l) => l.trim() === ".claude/");
  if (!giHas) {
    const prev = fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf8") : "";
    fs.writeFileSync(giPath, (prev ? prev.replace(/\n*$/, "\n") : "") + ".claude/\n");
  }
  return ensureSkillsStagedAt(dir);
}

// ─── CRL per-change gate (Phase 4 — wire the compliance-guided review layer
// into the edit loop) ────────────────────────────────────────────────────

// Parse `git status -z --porcelain` into a flat changed-file list. Extracted
// so commitWorkspaceChanges can call it TWICE (once to seed the CRL delta, once
// more after the gate runs to pick up a scrub's own edits) without duplicating
// the NUL-safe parsing. Exported for direct unit testing.
/**
 * Files sitting UNCOMMITTED in a session's bundle working tree.
 *
 * A turn is all-or-nothing: the agent edits files, and the server commits them
 * only after the SSE stream ends. Kill the process mid-turn (terminal closed,
 * Ctrl-C, the CLI exiting and taking its spawned server child with it) and the
 * edits are on disk but uncommitted, while meta.json still describes the
 * PREVIOUS turn. Without this, a resume shows meta's view — "turn 0, empty
 * workspace" — over a tree holding a half-finished edit, which can be strictly
 * worse than where the session started (e.g. an entity deleted but the
 * references to it not yet repointed).
 *
 * Reporting only — deliberately does NOT auto-commit. Committing someone's
 * half-finished surgery on their behalf is the wrong call; name the files and
 * let the operator choose to keep, finish, or discard.
 *
 * @param {string} id Session id.
 * @returns {string[]} repo-relative paths, [] when the tree is clean.
 * @throws if the session does not exist.
 */
export function uncommittedChanges(id) {
  const dir = path.join(sessionPath(id), "bundle");
  if (!fs.existsSync(dir)) throw new Error(`session not found: ${id}`);
  return listWorkingTreeChanges(dir);
}

export function listWorkingTreeChanges(dir) {
  const status = git(dir, "status", "-z", "--porcelain");
  if (!status) return [];
  return status.split("\0").filter((e) => e.length >= 4).map((e) => e.slice(3));
}

// Collect every `{uuid: "..."}` leaf in a parsed bundle-file JSON value,
// regardless of whether the file's top level is an array of entities
// (concepts.json), a single entity object (organisationConfig.json,
// forms/*.json), or a named-array wrapper (operationalSubjectTypes.json:
// {operationalSubjectTypes:[...]}) — walking generically avoids hardcoding a
// per-file shape map that would silently miss a class of entity.
function collectUuids(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) { for (const e of node) collectUuids(e, out); return; }
  if (typeof node === "object") {
    if (typeof node.uuid === "string") out.add(node.uuid);
    for (const v of Object.values(node)) collectUuids(v, out);
  }
}

// Extract every entity uuid touched by this turn's changed files: current
// on-disk uuids (additions/edits) UNIONED with pre-turn (sinceSha) uuids
// (removals/renames) — a removed/renamed entity's stale uuid is exactly what a
// dangling reference hides behind, so it must be scanned too, not just the
// surviving ones.
function extractChangedEntityUuids(dir, changedFiles, sinceSha) {
  const uuids = new Set();
  for (const rel of changedFiles) {
    if (!rel.endsWith(".json")) continue; // .gitignore etc. never carry a reviewable uuid
    try { collectUuids(JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")), uuids); }
    catch { /* removed this turn, or unparsable mid-edit — sinceSha below still catches a prior version */ }
    if (sinceSha) {
      try { collectUuids(JSON.parse(git(dir, "show", `${sinceSha}:${rel}`)), uuids); }
      catch { /* file didn't exist at sinceSha — fine */ }
    }
  }
  return [...uuids];
}

// Merge N RefResult objects (bundle-mcp-server.js findReferencesOnDir's shape,
// verified: {ok, query, totalReferences, filesAffected, byFile, references})
// into one — same field names, unioned across every changed entity, so a
// consumer that only reads {ok, totalReferences, filesAffected, byFile,
// references} can't tell a merged blastRadius from a single-entity call.
function mergeRefResults(results) {
  const references = [];
  for (const r of results) {
    if (!r || !r.ok) continue;
    for (const ref of r.references) references.push(ref);
  }
  const byFile = {};
  for (const r of references) (byFile[r.file] ||= []).push(r);
  return {
    ok: true,
    query: { mode: "blast-radius", value: results.map((r) => r && r.query && r.query.value).filter(Boolean) },
    totalReferences: references.length,
    filesAffected: Object.keys(byFile).length,
    byFile,
    references,
  };
}

// Build the delta the review layer scopes itself to for THIS turn (contract
// §2.4): the changed-file list, the diff against the turn's pre-commit HEAD,
// and the MERGED blast radius (MAJ-5) — every dependent of every entity this
// turn touched, found via findReferencesOnDir per entity and unioned. `diff` is
// computed against the `sinceSha` PARAMETER, never the literal string "HEAD":
// commitWorkspaceChanges calls this AFTER committing the turn (MAJ-1), so by the
// time this runs HEAD already IS the new commit and `sinceSha` is its parent;
// `git diff <sinceSha>` (single-ref form) compares the current working
// tree/HEAD state to that ref regardless of what "HEAD" now points to, which is
// exactly the turn's diff either way this is called (pre-commit dirty tree, or
// post-commit clean one). Exported for direct testing.
export function buildCrlDelta(dir, changedFiles, sinceSha) {
  let diff = "";
  try { diff = sinceSha ? git(dir, "diff", sinceSha) : git(dir, "diff", "HEAD"); }
  catch { /* no HEAD yet (fresh repo, turn 0) */ }
  const changedUuids = extractChangedEntityUuids(dir, changedFiles, sinceSha);
  const blastRadius = mergeRefResults(changedUuids.map((uuid) => findReferencesOnDir(dir, { uuid })));
  return { changedFiles, sinceSha, diff, blastRadius };
}

// Fail-safe wrapper around crlGate — NEVER throws. A CRL failure (missing
// compliance doc, crl module load error, brain graph unavailable) degrades to
// `pass:null` ("not evaluated" — must NOT be read as clean OR dirty) so it can
// never block or corrupt an otherwise-good turn, mirroring the exact fail-safe
// stance summariseIntegrity already has for the integrity gate. Exported so the
// degrade shape is directly unit-testable without forcing a real crlGate
// internal failure.
export async function runCrlGateSafely(dir, delta) {
  try {
    return await crlGate(dir, { delta, scopingCtx: buildCrlScopingCtx(dir), hitl: true });
  } catch (e) {
    return { pass: null, review: null, retries: 0, escalated: false, error: e.message };
  }
}

// O-1 — spec-artifact detection. A "spec-mutating turn" is one whose changed
// files include a canonical spec artifact authored into the bundle
// (spec.yaml / spec.yml / *.spec.yaml / *.spec.yml). Ordinary bundle-authoring
// turns (concepts.json / forms/*.json / …) never match, so the spec gate stays
// dormant unless a real spec artifact is being edited — zero effect on the
// existing bundle-only flow.
function specArtifactOf(changedFiles) {
  return changedFiles.find((f) => /^spec\.ya?ml$|\.spec\.ya?ml$/.test(f)) || null;
}

// Fail-safe reviewSpec wrapper (O-1) — gates the intermediate spec artifact
// against spec-template.yaml, judging INTENT coverage (never server-compliance,
// which the bundle gate owns). Same commit-first precondition as the bundle
// gate: the turn is already committed, so reviewSpec (which materialises into
// its own temp dir) can only ever read the just-committed spec. NEVER throws —
// a malformed spec degrades to pass:null, exactly like runCrlGateSafely.
export async function runSpecGateSafely(dir, specRelPath) {
  try {
    const specText = fs.readFileSync(path.join(dir, specRelPath), "utf8");
    const review = await reviewSpec(specText, { scopingCtx: buildCrlScopingCtx(dir) });
    return { pass: review.ok, review, retries: 0, escalated: !!review.escalate };
  } catch (e) {
    return { pass: null, review: null, retries: 0, escalated: false, error: e.message };
  }
}

/**
 * Snapshot whatever the agent (or a caller) wrote into the bundle dir as a new
 * turn. Honours `.gitignore`, so staged skills are excluded.
 *
 * Order (contract IC-6): listWorkingTreeChanges → concept-collision interceptor
 * → COMMIT THE AGENT'S TURN → CRL gate (unless SDK_CRL_GATE=="off") → follow-up
 * commit if the gate's executor applied a scrub → persist meta.crlAtCurrent →
 * return.
 *
 * The agent's turn is committed BEFORE the CRL gate runs (MAJ-1). Pre-fix, the
 * gate ran on the dirty, not-yet-committed tree, so HEAD was still the PRIOR
 * turn when the executor's revert-on-regression guardrail
 * (`git checkout HEAD -- <file>`) could fire — silently discarding this turn's
 * uncommitted edits (non-recoverable; not in reflog). Committing first means
 * HEAD already IS this turn by the time the gate runs, so a HEAD-relative
 * revert can only ever target this turn's own pre-prune state. If the gate's
 * executor applies a scrub, it lands as a SEPARATE follow-up commit
 * (`turn N.crl: ...`) — never folded into the agent's own commit, so the two
 * provenances stay distinguishable in history. This does NOT bump
 * meta.currentTurn a second time — it is still "turn N" from the caller's view.
 * (`revertToTurn(N)` lands on the pre-scrub `turn N:` commit — its
 * message-prefix match ignores `turn N.crl:` — so reverting always gets the
 * agent's own edit, pre-scrub.)
 *
 * The gate NEVER hard-blocks the commit — same iterate-don't-revert posture as
 * the integrity fold (FIX 1(a)); an escalation is surfaced (crlGate field +
 * meta.crlAtCurrent + the next turn's injected preamble), not enforced by
 * refusing to commit.
 *
 * Returns { turn, sha, summary, validation, rulesValidation, crlGate, specGate?,
 * changedFiles, noChanges }.
 *   `noChanges: true` is returned when the working tree was clean (no commit
 *   was created and the turn counter was NOT incremented) — the CRL gate does
 *   NOT run on a no-op turn, nor on a concept-collision-rejected turn (both
 *   return before reaching it). `crlGate`/`specGate` are likewise absent on both.
 */
export async function commitWorkspaceChanges(id, summary) {
  const dir = bundleDir(id);
  // Detect changes against HEAD ignoring .gitignored paths (NUL-safe parse —
  // filenames are never quoted, safe for spaces / unicode).
  const changedFiles = listWorkingTreeChanges(dir);
  if (changedFiles.length === 0) {
    const meta = readMeta(id);
    return { turn: meta.currentTurn, sha: null, summary, agentActionSummary: "no changes", validation: meta.validationAtCurrent, rulesValidation: meta.rulesValidationAtCurrent, changedFiles: [], noChanges: true };
  }

  // Pre-turn HEAD — the CRL delta's `sinceSha`. Defensive try/catch even though
  // turn 0 always commits at session create (both baseline and agent mode), so
  // HEAD exists in practice by the time any real turn is committed.
  let beforeSha = null;
  try { beforeSha = git(dir, "rev-parse", "HEAD").trim(); } catch { /* fresh repo */ }

  // CONCEPT-COLLISION INTERCEPTOR — runs BEFORE git add/commit, unchanged.
  // If concepts.json was modified and the new version introduces a concept
  // whose name case-insensitively collides with an existing one, revert
  // concepts.json (and ONLY concepts.json) and return a rejected-turn.
  if (changedFiles.includes("concepts.json")) {
    try {
      const headRaw = git(dir, "show", "HEAD:concepts.json");
      const oldConcepts = JSON.parse(headRaw);
      const newPath = path.join(dir, "concepts.json");
      const newConcepts = JSON.parse(fs.readFileSync(newPath, "utf8"));
      const { collisions } = detectConceptCollisions(oldConcepts, newConcepts);
      if (collisions.length > 0) {
        // Revert concepts.json to HEAD; leave other working-tree edits alone
        // so the agent can re-commit non-conflicting work in a follow-up turn
        // if it wants.
        git(dir, "checkout", "HEAD", "--", "concepts.json");
        const meta = readMeta(id);
        return {
          turn: meta.currentTurn,
          sha: null,
          summary,
          validation: meta.validationAtCurrent,
          rulesValidation: meta.rulesValidationAtCurrent,
          changedFiles: [],
          noChanges: false,
          rejected: true,
          rejectionReason: "CONCEPT_COLLISION",
          violations: collisions,
          violationMessage: formatViolationMessage(collisions),
        };
      }
    } catch (e) {
      // If parsing fails (corrupted concepts.json), let the normal commit
      // path proceed — the bundle validator will catch the breakage.
      // eslint-disable-next-line no-console
      console.warn(`[concept-gate] check skipped: ${e.message}`);
    }
  }

  // COMMIT THE AGENT'S TURN — FIRST, before the CRL gate runs (MAJ-1).
  git(dir, "add", "-A");
  const meta = readMeta(id);
  const newTurn = meta.currentTurn + 1;
  git(dir, "commit", "-m", `turn ${newTurn}: ${summary}`);

  // CRL PER-CHANGE GATE (Phase 4) — runs once per mutating, non-rejected turn,
  // against the now-clean, just-committed tree. Gated behind SDK_CRL_GATE
  // (MAJ-12) so the eval harness can boot the server with the gate OFF: Phase 3
  // and Phase 4 share one server process once both merge, and an unbudgeted
  // per-turn AI call inside an eval case would both blow its cost accounting and
  // risk collateral drift the case never asked for.
  const crlGateEnabled = process.env.SDK_CRL_GATE !== "off";
  const crlGateResult = crlGateEnabled
    ? await runCrlGateSafely(dir, buildCrlDelta(dir, changedFiles, beforeSha))
    : { pass: null, review: null, retries: 0, escalated: false, disabled: true };

  // O-1 — if this turn authored/edited a canonical spec artifact, ALSO gate the
  // spec against spec-template.yaml (same commit-first ordering; reviewSpec
  // reads the just-committed spec). Only when the gate is enabled and a spec
  // artifact actually changed — a bundle-only turn carries no specGate.
  const specArtifact = specArtifactOf(changedFiles);
  // `let`, not `const` — the O-2 Live Spec View block below reassigns this when
  // the DERIVED spec.yaml (not a frozen-changedFiles hand-authored spec) is what
  // actually populated the spec view this turn. With SDK_SPEC_VIEW on the agent
  // never hand-authors spec.yaml, so specArtifact is null here and O-2 is the
  // sole populator; the two paths are mutually exclusive in practice.
  let specGateResult = (crlGateEnabled && specArtifact)
    ? await runSpecGateSafely(dir, specArtifact)
    : undefined;

  // If the gate's executor applied a scrub, land it as a FOLLOW-UP commit
  // against the turn just committed above.
  const postGateChanges = listWorkingTreeChanges(dir);
  if (postGateChanges.length > 0) {
    git(dir, "add", "-A");
    git(dir, "commit", "-m", `turn ${newTurn}.crl: automated compliance scrub`);
  }

  // ─── LIVE SPEC VIEW (O-2) — derived, read-only, persisted per mutating turn.
  // Runs AFTER the CRL scrub follow-up commit above, so the emitted spec.yaml
  // reflects the POST-scrub bundle. syncSpecView is pure filesystem + emit (no
  // git) — this call site owns the commit + gate, mirroring the CRL gate's own
  // separation of concerns. Gated by SDK_SPEC_VIEW (default on; the eval harness
  // + package.json test scripts set it "off", synthesis C3, mirroring
  // SDK_CRL_GATE/MAJ-12) so eval runs and the entity suite stay deterministic
  // and free of an unbudgeted per-turn AI call + collateral `turn N.spec`
  // commit. A true no-op re-emit (unchanged derived spec) skips both the commit
  // and the gate call — see syncSpecView's own no-op test. `turn N.spec:` is a
  // follow-up commit like `turn N.crl:` — listTurns/diffTurn/revertToTurn match
  // `^turn (\d+):` so the `.spec` suffix is NOT counted as a turn (it self-heals
  // on the next mutating turn after a revert).
  const specViewEnabled = process.env.SDK_SPEC_VIEW !== "off";
  let specViewResult = { specChanged: false, identityChanged: false, disabled: !specViewEnabled };
  if (specViewEnabled) {
    specViewResult = syncSpecView(dir, { org: meta.org });
    // Existence-filtered add so a `git add` of a not-yet-written path can never
    // throw on this (highest-blast-radius) commit path. In practice both files
    // are always present together once written (turn 1 writes both fresh), so
    // this matches the contract §2.4 `git add spec.yaml identity-map.yaml` in
    // every real case while staying defensive.
    const specFiles = ["spec.yaml", "identity-map.yaml"].filter((f) => fs.existsSync(path.join(dir, f)));
    if ((specViewResult.specChanged || specViewResult.identityChanged) && specFiles.length > 0) {
      git(dir, "add", ...specFiles);
      git(dir, "commit", "-m", `turn ${newTurn}.spec: derived spec view`);
    }
    if (specViewResult.specChanged) {
      // REUSE the existing O-1 wrapper on the DERIVED spec — no new gate code.
      specGateResult = await runSpecGateSafely(dir, "spec.yaml");
    }
  }

  const sha = git(dir, "rev-parse", "HEAD").trim();
  const finalChangedFiles = [...new Set([...changedFiles, ...postGateChanges])];
  // FIX 1(a): fold deterministic integrity errors into the stored per-turn
  // validation result so `validation.valid` is false whenever the bundle would
  // fail on upload — even when the local validator is green. Computed against
  // the FINAL tree (post-scrub, if any), so the agent never sees stale state.
  const validation = summariseValidationWithIntegrity(dir);
  const rulesValidation = await summariseRules(dir);
  meta.currentTurn = newTurn;
  meta.validationAtCurrent = validation;
  meta.rulesValidationAtCurrent = rulesValidation;
  // Durable cross-session state (Phase 4): meta.json is the session's durable
  // on-disk record (SDK_SESSIONS_DIR survives reboots — see file header). This
  // is what lets a bundle resumed cold show a fresh turn the same review
  // outcome — including a still-unresolved HITL escalation — via
  // currentValidatorStateText (Task 5).
  meta.crlAtCurrent = crlGateResult;
  if (specGateResult !== undefined) meta.specCrlAtCurrent = specGateResult;
  meta.specViewAtCurrent = specViewResult;
  writeMeta(id, meta);
  const agentActionSummary = summariseAgentAction(finalChangedFiles);
  return {
    turn: newTurn, sha: sha.slice(0, 12), summary, agentActionSummary,
    validation, rulesValidation, crlGate: crlGateResult,
    ...(specGateResult !== undefined ? { specGate: specGateResult } : {}),
    specSync: specViewResult,
    changedFiles: finalChangedFiles, noChanges: false,
  };
}

// One-line description of what the agent actually did this turn, derived from
// the changed-file list. The existing `summary` field is the (truncated) user
// prompt — useful but not the same thing. ALPHA surfaces this in transcript
// events so reviewers can see file-level intent at a glance.
function summariseAgentAction(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) return "no changes";
  if (changedFiles.length <= 3) return `edit: ${changedFiles.join(", ")}`;
  const [first, second] = changedFiles;
  return `edit: ${first}, ${second}, and ${changedFiles.length - 2} more`;
}

/**
 * Hard-revert to a previous turn. Discards all turns after `toTurn`.
 */
export function revertToTurn(id, toTurn) {
  const dir = path.join(sessionPath(id), "bundle");
  const log = git(dir, "log", `--pretty=format:%H%x09%s`).split("\n");
  const target = log.find((l) => l.split("\t")[1].startsWith(`turn ${toTurn}:`));
  if (!target) throw new Error(`turn ${toTurn} not found`);
  const sha = target.split("\t")[0];
  git(dir, "reset", "--hard", sha);

  const meta = readMeta(id);
  meta.currentTurn = toTurn;
  meta.validationAtCurrent = summariseValidation(dir);
  writeMeta(id, meta);

  return meta;
}

export async function zipBundle(id, zipPath) {
  const dir = path.join(sessionPath(id), "bundle");
  zipPath = zipPath || path.join(sessionPath(id), `${readMeta(id).org}.zip`);
  return zipBundleDir(dir, zipPath);
}

export function deleteSession(id) {
  const dir = sessionPath(id);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function listSessions() {
  const out = [];
  for (const e of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith("sess_")) {
      try { out.push(readMeta(e.name)); } catch {}
    }
  }
  return out;
}
