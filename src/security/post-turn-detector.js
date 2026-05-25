// Post-turn git-scope detector — defense-in-depth pair to the lex-level
// Bash hook in src/agent.js. The lex hook (FORBIDDEN_BASH_PATTERNS) is a
// regex blocklist that an adversary who knows shell can route around
// (eval, bash -c, backtick substitution, etc.). This module runs AFTER the
// agent's SDK stream ends and BEFORE the server's own commitWorkspaceChanges,
// and detects any commits in the bundle git repo that weren't authored by
// the server.
//
// The server configures the bundle repo with `user.email = agent@avni-skills-sdk`
// (see src/sessions.js around line 133). Any commit between `beforeSha` and
// HEAD with a DIFFERENT author email is an unauthorized mutation — the agent
// reached around the hook and ran `git commit` itself.
//
// Usage contract (caller wires this; this module does NOT auto-wire):
//
//   import { detectUnauthorizedMutations, revertToSha } from "./security/post-turn-detector.js";
//
//   // BEFORE starting the agent stream
//   const beforeSha = git(bundleDir, "rev-parse", "HEAD").trim();
//
//   // ... run agent stream ...
//
//   // AFTER stream ends, BEFORE the server's own `git add -A && git commit`
//   const detection = detectUnauthorizedMutations(bundleDir, beforeSha);
//   if (!detection.ok && detection.recommendation === "revert") {
//     revertToSha(bundleDir, beforeSha);
//     // emit SSE 'unauthorized-mutation' event with detection.unauthorizedCommits
//     // SKIP the server's normal commitWorkspaceChanges — workspace is back at beforeSha
//   } else {
//     // proceed with normal commitWorkspaceChanges
//   }
//
// ESM only. Uses execFileSync (no shell) — mirrors the pattern in
// src/sessions.js's `git()` helper. Deliberately copied inline rather than
// imported, to avoid cross-file coupling with sessions.js (which is owned
// by DELTA).

import { execFileSync } from "node:child_process";

// Author email used by the server when it commits (sole legitimate
// committer). MUST match what src/sessions.js writes via
// `git config user.email`. If that value changes, change this too.
export const SERVER_COMMITTER_EMAIL = "agent@avni-skills-sdk";

// Inline git helper — same shape as src/sessions.js's `git()`.
// No shell, args passed as array → safe from injection.
function git(cwd, ...args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`git ${args.join(" ")} failed: ${(e.stderr || e.message).slice(0, 300)}`);
  }
}

/**
 * Detect commits in `bundleDir` between `beforeSha` and HEAD that were NOT
 * authored by the server's committer identity.
 *
 * @param {string} bundleDir — absolute path to the bundle git repo
 * @param {string} beforeSha — SHA captured BEFORE the agent stream began
 * @returns {{
 *   ok: boolean,
 *   unauthorizedCommits: Array<{sha: string, author: string, subject: string}>,
 *   dirtyOutsideBundle: boolean,
 *   recommendation: 'safe' | 'revert' | 'warn'
 * }}
 *
 * The bundle is its own git repo, so `dirtyOutsideBundle` is always false
 * (kept in the shape for future-proofing / caller stability).
 *
 * Recommendation logic:
 *   • 0 unauthorized commits → ok=true,  recommendation='safe'
 *   • 1+ unauthorized commits → ok=false, recommendation='revert'
 */
export function detectUnauthorizedMutations(bundleDir, beforeSha) {
  if (!bundleDir || typeof bundleDir !== "string") {
    throw new Error("detectUnauthorizedMutations: bundleDir required");
  }
  if (!beforeSha || typeof beforeSha !== "string") {
    throw new Error("detectUnauthorizedMutations: beforeSha required");
  }

  // `git log` with %H<TAB>%ae<TAB>%s — TAB-separated, one commit per line.
  // beforeSha..HEAD is empty when HEAD == beforeSha (no new commits).
  // We pass `--` at the end to defend against beforeSha looking like a path.
  let raw;
  try {
    raw = git(bundleDir, "log", "--format=%H%x09%ae%x09%s", `${beforeSha}..HEAD`, "--");
  } catch (e) {
    // If git log itself fails (e.g. beforeSha doesn't exist anymore because
    // the agent ran `git reset --hard <other>`), treat as a major violation:
    // we can't account for what happened, so revert.
    return {
      ok: false,
      unauthorizedCommits: [{ sha: "unknown", author: "unknown", subject: `git log failed: ${e.message}` }],
      dirtyOutsideBundle: false,
      recommendation: "revert",
    };
  }

  const unauthorizedCommits = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [sha, author, ...subjectParts] = line.split("\t");
    const subject = subjectParts.join("\t");
    if (author !== SERVER_COMMITTER_EMAIL) {
      unauthorizedCommits.push({ sha, author, subject });
    }
  }

  if (unauthorizedCommits.length === 0) {
    return {
      ok: true,
      unauthorizedCommits: [],
      dirtyOutsideBundle: false,
      recommendation: "safe",
    };
  }

  return {
    ok: false,
    unauthorizedCommits,
    dirtyOutsideBundle: false,
    recommendation: "revert",
  };
}

/**
 * Hard-reset the bundle repo to `targetSha`. Used by the caller when
 * detectUnauthorizedMutations returns recommendation='revert'. Wipes all
 * working-tree changes too — the assumption is that the agent's whole turn
 * is being thrown out.
 *
 * @param {string} bundleDir
 * @param {string} targetSha
 */
export function revertToSha(bundleDir, targetSha) {
  if (!bundleDir || typeof bundleDir !== "string") {
    throw new Error("revertToSha: bundleDir required");
  }
  if (!targetSha || typeof targetSha !== "string") {
    throw new Error("revertToSha: targetSha required");
  }
  git(bundleDir, "reset", "--hard", targetSha);
}
