#!/usr/bin/env node
// stage-skills.mjs — stage the avni-skills knowledge base into this repo's
// `.claude/skills/` so a Claude Code session working here discovers the same
// skills a session-mode agent gets.
//
// Reuses `ensureSkillsStagedAt` — the identical staging the session path calls,
// so there is one implementation and no chance of the two drifting.
//
// `.gitignore` already excludes `.claude/*` (except workflows/), so the staged
// symlinks never enter git. Re-running is idempotent: existing entries are left
// alone, which also means a stale entry is NOT refreshed — delete
// `.claude/skills/` and re-run if avni-skills gained or renamed a skill.

import path from "node:path";
import fs from "node:fs";
import { ensureSkillsStagedAt } from "../src/workspace.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

if (!process.env.AVNI_SKILLS_PATH) {
  const sibling = path.resolve(REPO, "..", "avni-skills");
  if (fs.existsSync(sibling)) process.env.AVNI_SKILLS_PATH = sibling;
}

const { staged, total } = ensureSkillsStagedAt(REPO);
console.log(`staged ${staged} new (${total} total) into ${path.join(REPO, ".claude", "skills")}`);
console.log(`source: ${process.env.AVNI_SKILLS_PATH}`);
if (staged === 0 && total > 0) console.log("(already staged — delete .claude/skills/ and re-run to refresh)");
