// Build an isolated agent workspace where avni-skills's 16 skill folders
// are exposed at the path the Claude Agent SDK auto-discovery expects:
//   <workspace>/.claude/skills/<name>/SKILL.md
//
// The avni-skills repo stores skills at <repo-root>/<name>/SKILL.md (no
// .claude/skills/ wrapper). Without this staging, the SDK falls back to
// the user's ~/.claude/skills/ which is wrong (and pollutes context with
// the user's personal skill set).
//
// Symlinks are used (not copies) so any update to avni-skills/* shows up
// immediately. The staging dir is reused per-process; the OS cleans tmpdirs.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { avniSkillsPath, listSkills } from "./skills.js";

// Local SDK-bundled skills that live in this repo (not in avni-skills).
// The rules-author skill is here until it's PR'd upstream.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_SKILLS_DIR = path.resolve(__dirname, "..", "skills");

function listSdkLocalSkills() {
  if (!fs.existsSync(SDK_SKILLS_DIR)) return [];
  return fs.readdirSync(SDK_SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(SDK_SKILLS_DIR, e.name, "SKILL.md")))
    .map((e) => ({ slug: e.name, source: path.join(SDK_SKILLS_DIR, e.name) }));
}

let _workspaceDir = null;

/**
 * Lazily build (and cache) the staged workspace. Returns the path that
 * should be passed as `cwd` to the Claude Agent SDK.
 */
export function ensureAgentWorkspace() {
  if (_workspaceDir && fs.existsSync(_workspaceDir)) return _workspaceDir;

  const root = avniSkillsPath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avni-skills-workspace-"));
  const skillsDir = path.join(dir, ".claude", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  let count = 0;
  for (const skill of listSkills()) {
    const src = path.join(root, skill.slug);
    const dst = path.join(skillsDir, skill.slug);
    try {
      fs.symlinkSync(src, dst, "dir");
      count++;
    } catch (e) {
      // If symlink fails (e.g., on filesystems that disallow it), fall
      // back to copying the SKILL.md file at minimum so the agent can
      // discover the skill.
      try {
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(path.join(src, "SKILL.md"), path.join(dst, "SKILL.md"));
        count++;
      } catch { /* skip */ }
    }
  }

  // SDK-local skills (rules-author, etc.)
  for (const skill of listSdkLocalSkills()) {
    const dst = path.join(skillsDir, skill.slug);
    if (fs.existsSync(dst)) continue;
    try {
      fs.symlinkSync(skill.source, dst, "dir");
      count++;
    } catch {
      try {
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(path.join(skill.source, "SKILL.md"), path.join(dst, "SKILL.md"));
        count++;
      } catch { /* skip */ }
    }
  }

  _workspaceDir = dir;
  // eslint-disable-next-line no-console
  console.log(`  staged ${count} skills into ${dir}/.claude/skills/`);
  return dir;
}

/**
 * Stage avni-skills's 16 skills into <targetDir>/.claude/skills/<name>.
 * Idempotent — existing symlinks are left as-is, missing ones are created.
 * Used by Phase 4's session-messages endpoint so the agent's cwd can be the
 * session's bundle dir directly while still seeing the full skill catalog.
 *
 * Returns { staged, total } counts.
 */
export function ensureSkillsStagedAt(targetDir) {
  const root = avniSkillsPath();
  const skillsDir = path.join(targetDir, ".claude", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  let staged = 0;
  const skills = listSkills();
  for (const skill of skills) {
    const dst = path.join(skillsDir, skill.slug);
    if (fs.existsSync(dst)) continue;
    const src = path.join(root, skill.slug);
    try {
      fs.symlinkSync(src, dst, "dir");
      staged++;
    } catch {
      try {
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(path.join(src, "SKILL.md"), path.join(dst, "SKILL.md"));
        staged++;
      } catch { /* skip */ }
    }
  }
  // SDK-local skills (rules-author, etc.)
  const local = listSdkLocalSkills();
  for (const skill of local) {
    const dst = path.join(skillsDir, skill.slug);
    if (fs.existsSync(dst)) continue;
    try {
      fs.symlinkSync(skill.source, dst, "dir");
      staged++;
    } catch {
      try {
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(path.join(skill.source, "SKILL.md"), path.join(dst, "SKILL.md"));
        staged++;
      } catch { /* skip */ }
    }
  }
  return { staged, total: skills.length + local.length };
}
