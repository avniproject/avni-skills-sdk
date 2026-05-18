#!/usr/bin/env node
// Bundle-wide reference finder.
//
// Usage (from a bundle dir):
//   node find-references.mjs --uuid "<uuid>"
//   node find-references.mjs --name "<concept-name>"
//
// Scans every JSON file in the bundle for the target string. Output: JSON list
// of {file, jsonPath, value, context} entries. The agent calls this before
// rename / dedup operations so it knows the full blast radius.
//
// Rule strings (decisionRule etc.) are scanned as strings, NOT parsed as JS,
// so a UUID embedded as a literal inside a rule body IS found.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? null : args[i + 1];
}

const uuid = arg("uuid");
const name = arg("name");
if (!uuid && !name) {
  console.error('usage: find-references.mjs --uuid "<uuid>"  |  --name "<name>"');
  process.exit(2);
}

const target = uuid || name;
const mode = uuid ? "uuid" : "name";
const cwd = process.cwd();

// JSON files to scan (any present)
const ENTITY_FILES = [
  "concepts.json", "subjectTypes.json", "programs.json", "encounterTypes.json",
  "formMappings.json", "organisationConfig.json",
  "operationalSubjectTypes.json", "operationalPrograms.json", "operationalEncounterTypes.json",
  "groupPrivilege.json", "groups.json", "groupRole.json",
  "addressLevelTypes.json", "individualRelation.json", "relationshipType.json",
];

const refs = [];

function walk(node, jsonPath, file) {
  if (node == null) return;
  if (typeof node === "string") {
    // Substring match — finds UUIDs in rule bodies, names referenced in answers, etc.
    if (node.includes(target)) {
      refs.push({ file, jsonPath, value: node.length > 200 ? node.slice(0, 200) + "…" : node, kind: "string-contains" });
    }
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(node[i], `${jsonPath}[${i}]`, file);
    return;
  }
  if (typeof node === "object") {
    // For name mode, also flag {name: "<target>"} as a strong-match hit
    if (mode === "name" && node.name === target) {
      refs.push({ file, jsonPath, kind: "name-field-exact", uuid: node.uuid, dataType: node.dataType });
    }
    // For uuid mode, flag {uuid: "<target>"} as a strong-match hit
    if (mode === "uuid" && node.uuid === target) {
      refs.push({ file, jsonPath, kind: "uuid-field-exact", name: node.name, dataType: node.dataType });
    }
    for (const [k, v] of Object.entries(node)) walk(v, jsonPath ? `${jsonPath}.${k}` : k, file);
  }
}

for (const rel of ENTITY_FILES) {
  const fp = path.join(cwd, rel);
  if (!fs.existsSync(fp)) continue;
  let json;
  try { json = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { continue; }
  walk(json, "", rel);
}

// forms/*.json — one file per form
const formsDir = path.join(cwd, "forms");
if (fs.existsSync(formsDir)) {
  for (const fn of fs.readdirSync(formsDir)) {
    if (!fn.endsWith(".json")) continue;
    const fp = path.join(formsDir, fn);
    let json;
    try { json = JSON.parse(fs.readFileSync(fp, "utf8")); }
    catch { continue; }
    walk(json, "", `forms/${fn}`);
  }
}

const byFile = {};
for (const r of refs) (byFile[r.file] ||= []).push(r);

process.stdout.write(JSON.stringify({
  query: { mode, value: target },
  totalReferences: refs.length,
  filesAffected: Object.keys(byFile).length,
  byFile,
  references: refs,
}, null, 2) + "\n");
