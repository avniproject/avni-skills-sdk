// Skill discovery — read SKILL.md frontmatter from avni-skills/.
// Pure data, no Claude API call needed. Used by /v1/skills routes.

import fs from "node:fs";
import path from "node:path";

export function avniSkillsPath() {
  const p =
    process.env.AVNI_SKILLS_PATH ||
    path.resolve(process.cwd(), "..", "avni-skills");
  if (!fs.existsSync(p)) {
    throw new Error(
      `avni-skills not found at ${p}. Set AVNI_SKILLS_PATH or clone avniproject/avni-skills as a sibling.`,
    );
  }
  return p;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("---", 3);
  if (end < 0) return {};
  const block = text.slice(3, end);
  const fields = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

export function listSkills() {
  const root = avniSkillsPath();
  const skills = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillFile = path.join(root, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const text = fs.readFileSync(skillFile, "utf8");
    const fm = parseFrontmatter(text);
    skills.push({
      slug: entry.name,
      name: fm.name || entry.name,
      description: fm.description || "",
      version: fm.version || null,
      path: path.join(entry.name, "SKILL.md"),
    });
  }
  return skills;
}

export function readSkill(slug) {
  const root = avniSkillsPath();
  const dir = path.join(root, slug);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) return null;
  const skillText = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  const fm = parseFrontmatter(skillText);
  // Also list supporting files (other .md / .json / .js next to SKILL.md)
  const supporting = [];
  function walk(d, rel = "") {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "SKILL.md" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else supporting.push(r);
    }
  }
  walk(dir);
  return {
    slug,
    name: fm.name || slug,
    description: fm.description || "",
    version: fm.version || null,
    body: skillText,
    supporting,
  };
}
