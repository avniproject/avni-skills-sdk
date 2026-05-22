// Skill discovery — read SKILL.md frontmatter from avni-skills/.
// Pure data, no Claude API call needed. Used by /v1/skills routes.
//
// Bundle-authoring agent: prefer listBundleAuthoringSkills() over listSkills()
// when constructing the agent's allowed-skills set. The full 16-brain list
// includes domains the agent doesn't need (mobile-testing, metabase reports,
// support-engineer post-launch debug) and dilutes context. Audit lives in
// docs/skills-curation.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_SKILLS_DIR = path.resolve(__dirname, "..", "skills");

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

function readSkillFolder(root, slug) {
  const skillFile = path.join(root, slug, "SKILL.md");
  if (!fs.existsSync(skillFile)) return null;
  const fm = parseFrontmatter(fs.readFileSync(skillFile, "utf8"));
  return {
    slug,
    name: fm.name || slug,
    description: fm.description || "",
    version: fm.version || null,
    path: path.join(slug, "SKILL.md"),
  };
}

export function listSkills() {
  const root = avniSkillsPath();
  const skills = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const s = readSkillFolder(root, entry.name);
    if (s) skills.push({ ...s, source: "avni-skills" });
  }
  // SDK-local skills (rules-author, etc.) — staged into the agent workspace
  // alongside the avni-skills ones. Surfacing them in /v1/skills keeps the
  // discovery endpoint honest.
  if (fs.existsSync(SDK_SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SDK_SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const s = readSkillFolder(SDK_SKILLS_DIR, entry.name);
      if (s) skills.push({ ...s, source: "sdk-local" });
    }
  }
  return skills;
}

// Load-bearing skills for the bundle-authoring agent. Curated from a survey
// of the 16 brain skills + 1 sdk-local. Each entry was kept iff a real
// bundle-authoring task (add/edit forms/concepts/rules, fix validator
// errors, map SRS → bundle) routinely touches it. Off-topic skills (mobile
// device testing, post-launch support tickets, metabase reports, CSV data
// migration, org go-live) are deliberately excluded — they remain readable
// via /v1/skills/:slug but aren't pre-loaded into the agent's context.
const LOAD_BEARING_BUNDLE_SKILLS = new Set([
  // brain (avni-skills/)
  "srs-bundle-generator",     // canonical generator + bundle config
  "backend-architecture",     // entity model, observation format, ETL
  "product-codebase",         // rules-config API reference
  "architecture-patterns",    // design patterns from official analysis
  "implementation-engineer",  // form configuration + rule patterns
  "project-scoping",          // SRS → AVNI mapping workflow
  "product-knowledge",        // codebase feasibility checks
  // sdk-local
  "rules-author",             // canonical rule body shapes (validation/
                              // decision/visitSchedule/eligibility/skipLogic)
]);

export function listBundleAuthoringSkills() {
  return listSkills().filter((s) => LOAD_BEARING_BUNDLE_SKILLS.has(s.slug));
}

export function isBundleAuthoringSkill(slug) {
  return LOAD_BEARING_BUNDLE_SKILLS.has(slug);
}

export function readSkill(slug) {
  const root = avniSkillsPath();
  let dir = path.join(root, slug);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) {
    // Fall through to SDK-local skills (rules-author).
    dir = path.join(SDK_SKILLS_DIR, slug);
    if (!fs.existsSync(path.join(dir, "SKILL.md"))) return null;
  }
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
