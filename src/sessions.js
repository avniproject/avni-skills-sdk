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
import { runBundleIntegrityCheck } from "./agents/bundle-mcp-server.js";

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
 *   • "edit" (DEFAULT) — the existing behaviour, byte-for-byte unchanged: runs
 *     the deterministic generator on the uploaded SRS and commits the
 *     first-pass bundle as turn 0. `formsBuffer` is required.
 *   • "author" — the session is created AROUND an SRS (requirements) instead of
 *     an uploaded bundle. The bundle dir starts empty; the SRS is persisted so
 *     the agent can read it (bundle_read_srs) and optionally bootstrap a
 *     deterministic baseline (bundle_generate_baseline), then refine to clean.
 *
 * @param {Object} args
 * @param {Buffer}  [args.formsBuffer]       Forms.xlsx (required in edit mode; optional generator input in author mode)
 * @param {string}  [args.formsFilename]
 * @param {Buffer}  [args.modellingBuffer]   Modelling.xlsx (optional generator input)
 * @param {string}  [args.modellingFilename]
 * @param {string}  [args.org="Bundle"]
 * @param {"edit"|"author"} [args.mode="edit"]
 * @param {string|Object} [args.srs]         author-mode SRS as inline text or JSON (string or already-parsed object)
 * @param {string}  [args.srsPath]           author-mode external SRS path the agent can Read (recorded, not copied)
 */
export function createSession({ formsBuffer, formsFilename, modellingBuffer, modellingFilename, org = "Bundle", mode = "edit", srs, srsPath }) {
  if (mode === "author") {
    return createAuthorSession({ formsBuffer, modellingBuffer, org, srs, srsPath });
  }
  if (mode !== "edit") {
    throw new Error(`unknown session mode: ${JSON.stringify(mode)} (expected "edit" or "author")`);
  }
  // ─── EDIT MODE (default) — behaviour below is unchanged from before #12 ───
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

// ─── author mode (story #12) ─────────────────────────────────────────
//
// An author-mode session is built AROUND requirements (an SRS), not an uploaded
// bundle. Unlike edit mode, we do NOT run the deterministic generator at create
// time — the generator is DEMOTED from the pipeline to an agent-callable tool
// (bundle_generate_baseline). The bundle dir starts empty (only .gitignore, so
// git has a HEAD to commit turns against); the agent reads the SRS
// (bundle_read_srs), optionally bootstraps a baseline, then refines to clean.
//
// The SRS is persisted under <session>/srs/ so the tools (which run with cwd =
// <session>/bundle) can reach it as ../srs/ — the same sibling-access pattern
// bundle_export_to_path uses to read ../meta.json.
function createAuthorSession({ formsBuffer, modellingBuffer, org, srs, srsPath }) {
  const id = newId();
  const dir = path.join(SESSIONS_DIR, id);
  const srsDir = path.join(dir, "srs");
  const bDir = path.join(dir, "bundle");
  fs.mkdirSync(srsDir, { recursive: true });
  fs.mkdirSync(bDir, { recursive: true });

  // Persist the SRS in whatever form(s) the caller supplied. All are optional;
  // an author session may start from pure prose, from structured JSON, from
  // XLSX generator inputs, from an external path, or any combination.
  const srsMeta = { kind: "none", files: {}, hasGeneratorInputs: false, externalPath: null };

  if (typeof srs === "string" && srs.trim()) {
    // Inline SRS text. Store as JSON when it parses to an object/array, else raw.
    let parsed = null;
    try { parsed = JSON.parse(srs); } catch { /* not JSON — treat as prose */ }
    if (parsed !== null && typeof parsed === "object") {
      fs.writeFileSync(path.join(srsDir, "srs.json"), JSON.stringify(parsed, null, 2));
      srsMeta.files.json = "srs/srs.json";
      srsMeta.kind = "json";
    } else {
      fs.writeFileSync(path.join(srsDir, "srs.txt"), srs);
      srsMeta.files.text = "srs/srs.txt";
      srsMeta.kind = "text";
    }
  } else if (srs && typeof srs === "object") {
    // Already-parsed structured SRS object.
    fs.writeFileSync(path.join(srsDir, "srs.json"), JSON.stringify(srs, null, 2));
    srsMeta.files.json = "srs/srs.json";
    srsMeta.kind = "json";
  }

  if (formsBuffer) {
    fs.writeFileSync(path.join(srsDir, "forms.xlsx"), formsBuffer);
    srsMeta.files.forms = "srs/forms.xlsx";
    srsMeta.hasGeneratorInputs = true;
    if (srsMeta.kind === "none") srsMeta.kind = "xlsx";
  }
  if (modellingBuffer) {
    fs.writeFileSync(path.join(srsDir, "modelling.xlsx"), modellingBuffer);
    srsMeta.files.modelling = "srs/modelling.xlsx";
  }
  if (typeof srsPath === "string" && srsPath.trim()) {
    srsMeta.externalPath = srsPath.trim();
    if (srsMeta.kind === "none") srsMeta.kind = "path";
    // An external XLSX path can serve as generator forms input too.
    if (/\.xlsx?$/i.test(srsMeta.externalPath)) srsMeta.hasGeneratorInputs = true;
  }

  // .gitignore keeps agent-staging artifacts out of the bundle git history +
  // gives git a first tracked file so turn 0 is a real (non-empty) commit.
  fs.writeFileSync(path.join(bDir, ".gitignore"), ".claude/\n");
  git(bDir, "init", "-b", "main");
  git(bDir, "config", "user.email", "agent@avni-skills-sdk");
  git(bDir, "config", "user.name", "avni-skills-sdk");
  git(bDir, "add", "-A");
  git(bDir, "commit", "-m", "turn 0: author session initialised (empty bundle — awaiting baseline/authoring)");

  // The empty bundle is expected to be dirty; the agent authors it clean. Guard
  // against the validator throwing on an all-but-empty dir.
  let validation;
  try { validation = summariseValidation(bDir); }
  catch { validation = { valid: false, errors: 0, warnings: 0, groups: {} }; }

  const meta = {
    sessionId: id,
    org: org || "Bundle",
    mode: "author",
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

// Session mode (story #12). Absent on pre-#12 sessions → "edit" (the historical
// default), so old sessions and the byte-identical edit path are unaffected.
export function getSessionMode(id) {
  try { return readMeta(id).mode === "author" ? "author" : "edit"; }
  catch { return "edit"; }
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

  const validatorClean = r.valid && r.warnings.length === 0;
  const integrityClean = integrityErrors.length === 0 && integrityWarnings.length === 0;

  let text;
  if (validatorClean && integrityClean) {
    text = "CURRENT VALIDATOR + INTEGRITY STATE (server-truth): ✓ bundle is clean — no validator errors, no integrity errors, no warnings.";
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
    lines.push("");
    lines.push("If the user says \"what is the error?\" or \"fix the error\", refer to the items above verbatim. Validator codes are real (C-class = concepts, F-class = forms/formMappings, R-class = rules, G-class = enums); integrity codes (FE_CONCEPT_NOT_OBJECT, ALT_INVALID_NAME, MISSING_REQUIRED_REF, DANGLING_REF) are the server-only traps. Use them exactly as shown. Do not invent a code that is not in this list. The bundle is NOT ready to export until BOTH sections are error-free.");
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

/**
 * Snapshot whatever the agent (or a caller) wrote into the bundle dir as a
 * new turn. Honours `.gitignore`, so staged skills are excluded.
 *
 * Returns { turn, sha, summary, validation, changedFiles, noChanges }.
 *   `noChanges: true` is returned when the working tree was clean (no commit
 *   was created and the turn counter was NOT incremented).
 */
export async function commitWorkspaceChanges(id, summary) {
  const dir = bundleDir(id);
  // Detect changes against HEAD ignoring .gitignored paths.
  // Use `-z` so entries are NUL-separated and filenames are NEVER quoted —
  // safe for paths with spaces / unicode. Each entry is `XY filename` (3-char
  // prefix). For renames/copies (R/C), the original path follows as its own
  // NUL-terminated entry; we treat that as a separate listing.
  const status = git(dir, "status", "-z", "--porcelain");
  if (!status) {
    const meta = readMeta(id);
    return { turn: meta.currentTurn, sha: null, summary, agentActionSummary: "no changes", validation: meta.validationAtCurrent, rulesValidation: meta.rulesValidationAtCurrent, changedFiles: [], noChanges: true };
  }
  const changedFiles = status.split("\0").filter((e) => e.length >= 4).map((e) => e.slice(3));

  // CONCEPT-COLLISION INTERCEPTOR — runs BEFORE git add/commit.
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

  git(dir, "add", "-A");
  const meta = readMeta(id);
  const newTurn = meta.currentTurn + 1;
  git(dir, "commit", "-m", `turn ${newTurn}: ${summary}`);
  const sha = git(dir, "rev-parse", "HEAD").trim();
  // FIX 1(a): fold deterministic integrity errors into the stored per-turn
  // validation result so `validation.valid` is false whenever the bundle would
  // fail on upload — even when the local validator is green.
  const validation = summariseValidationWithIntegrity(dir);
  const rulesValidation = await summariseRules(dir);
  meta.currentTurn = newTurn;
  meta.validationAtCurrent = validation;
  meta.rulesValidationAtCurrent = rulesValidation;
  writeMeta(id, meta);
  const agentActionSummary = summariseAgentAction(changedFiles);
  return { turn: newTurn, sha: sha.slice(0, 12), summary, agentActionSummary, validation, rulesValidation, changedFiles, noChanges: false };
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
