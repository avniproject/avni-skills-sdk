#!/usr/bin/env node
// rename-concept-uuid workflow.
//
// Replaces every occurrence of an old UUID with a new UUID across the entire
// bundle: concepts.json, subjectTypes.json, programs.json, encounterTypes.json,
// formMappings.json, organisationConfig.json, all operational files, and
// forms/*.json (including rule body strings).
//
// Also handles the common case of "fix orphan UUID reference": you have an
// answer reference pointing at a UUID that has no standalone concept; the
// real concept exists under a DIFFERENT UUID. Rename the orphan UUID → the
// real UUID everywhere; cross-file consistency restored in one atomic op.
//
// Usage (from a bundle dir):
//   node rename-concept-uuid.mjs --old <uuid> --new <uuid>
//   node rename-concept-uuid.mjs --old <uuid> --new <uuid> --new-name "New Name"
//   node rename-concept-uuid.mjs --old <uuid> --new <uuid> --dry-run
//
// Output: JSON report {filesChanged, replacements, byFile}. With --dry-run,
// no files are written; the report shows what WOULD change.

import fs from "node:fs";
import path from "node:path";

const argsArr = process.argv.slice(2);
function arg(name, defaultVal) {
  const i = argsArr.indexOf(`--${name}`);
  return i < 0 ? defaultVal : argsArr[i + 1];
}
function flag(name) { return argsArr.includes(`--${name}`); }

const oldUuid = arg("old");
const newUuid = arg("new");
const newName = arg("new-name");
const dryRun  = flag("dry-run");

if (!oldUuid || !newUuid) {
  console.error('usage: rename-concept-uuid.mjs --old <uuid> --new <uuid> [--new-name "<name>"] [--dry-run]');
  process.exit(2);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(oldUuid) || !UUID_RE.test(newUuid)) {
  console.error("UUIDs must be v4-shaped 8-4-4-4-12 lowercase hex");
  process.exit(2);
}
if (oldUuid === newUuid && !newName) {
  console.error("--old equals --new and no --new-name given; nothing to do");
  process.exit(0);
}

const cwd = process.cwd();

const ENTITY_FILES = [
  "concepts.json", "subjectTypes.json", "programs.json", "encounterTypes.json",
  "formMappings.json", "organisationConfig.json",
  "operationalSubjectTypes.json", "operationalPrograms.json", "operationalEncounterTypes.json",
  "groupPrivilege.json", "groups.json", "groupRole.json",
  "addressLevelTypes.json", "individualRelation.json", "relationshipType.json",
];

const report = { filesChanged: 0, replacements: 0, byFile: {}, dryRun };

// String-level replacement. Count occurrences of the OLD UUID in the input
// string (substring count via split-length-minus-one), then replace all.
function rewriteString(s, counter) {
  if (typeof s !== "string" || !s.includes(oldUuid)) return s;
  const parts = s.split(oldUuid);
  counter.replaced += parts.length - 1;
  return parts.join(newUuid);
}

// Recursive walk: for every string property, run rewriteString. If the node
// is an object with `uuid: oldUuid` AND `--new-name` is set, also rename it.
function walk(node, counter) {
  if (node == null) return node;
  if (typeof node === "string") return rewriteString(node, counter);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = walk(node[i], counter);
    return node;
  }
  if (typeof node === "object") {
    // Rename concept if this is the matching concept's record
    if (newName && node.uuid === newUuid && typeof node.name === "string") {
      // Optional: rename the (new) concept's display name to a cleaner value
      // Only applies to the concept that NOW carries newUuid (after rewrite)
      // — handled in a second pass below.
    }
    for (const k of Object.keys(node)) node[k] = walk(node[k], counter);
    return node;
  }
  return node;
}

function processFile(rel) {
  const fp = path.join(cwd, rel);
  if (!fs.existsSync(fp)) return;
  const raw = fs.readFileSync(fp, "utf8");
  // Fast bail: skip unless this file references OLD, OR --new-name is set AND
  // the file MIGHT contain a concept whose uuid is NEW (only concepts.json).
  if (!raw.includes(oldUuid) && !(newName && rel === "concepts.json" && raw.includes(newUuid))) return;
  let json;
  try { json = JSON.parse(raw); }
  catch (e) {
    report.byFile[rel] = { skipped: true, reason: `parse error: ${e.message}` };
    return;
  }
  const counter = { replaced: 0 };
  const rewritten = walk(json, counter);

  // --new-name pass: rename the concept whose uuid is newUuid (which may have
  // come from either the rewrite above OR pre-existed in concepts.json).
  if (newName && Array.isArray(rewritten)) {
    for (const c of rewritten) {
      if (c && typeof c === "object" && c.uuid === newUuid && typeof c.name === "string" && c.name !== newName) {
        c.name = newName;
        counter.replaced += 1;
      }
    }
  }

  if (counter.replaced === 0) return;
  if (!dryRun) {
    fs.writeFileSync(fp, JSON.stringify(rewritten, null, 2));
  }
  report.byFile[rel] = { replacements: counter.replaced };
  report.filesChanged += 1;
  report.replacements += counter.replaced;
}

for (const rel of ENTITY_FILES) processFile(rel);

const formsDir = path.join(cwd, "forms");
if (fs.existsSync(formsDir)) {
  for (const fn of fs.readdirSync(formsDir)) {
    if (fn.endsWith(".json")) processFile(`forms/${fn}`);
  }
}

process.stdout.write(JSON.stringify({
  ...report,
  oldUuid, newUuid, newName: newName || null,
  message: dryRun
    ? `DRY-RUN: ${report.replacements} replacements across ${report.filesChanged} files. Re-run without --dry-run to apply.`
    : `Renamed ${oldUuid} → ${newUuid} in ${report.filesChanged} files (${report.replacements} replacements).`,
}, null, 2) + "\n");
