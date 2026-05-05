// Session-backed iterative bundle workspace.
//
// Each session is a filesystem dir containing a git repo. Every edit is
// committed as a turn. The session_id is opaque; sessions live under
// $SDK_SESSIONS_DIR (default: /tmp/avni-sdk-sessions).
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

const SESSIONS_DIR = process.env.SDK_SESSIONS_DIR || path.join(os.tmpdir(), "avni-sdk-sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

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

// ───────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────

/**
 * Create a session. Runs deterministic generator on the uploaded SRS,
 * commits the first-pass bundle as turn 0, returns session info.
 */
export function createSession({ formsBuffer, formsFilename, modellingBuffer, modellingFilename, org = "Bundle" }) {
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

export function getSession(id) {
  const meta = readMeta(id);
  return meta;
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
