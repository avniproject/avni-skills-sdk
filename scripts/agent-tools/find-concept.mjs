#!/usr/bin/env node
// Forced-tool gate for the bundle agent.
//
// Usage: from a bundle directory containing concepts.json,
//   node /path/to/find-concept.mjs "<name>"        → case-insensitive match
//   node /path/to/find-concept.mjs --uuid "<uuid>" → exact UUID lookup
//
// Output: JSON to stdout. Always prints something — never silent. The agent
// is REQUIRED (per BUNDLE_HARD_RULES rule #6) to call this before adding any
// new concept. The output documents whether a match exists and what to do.
//
// Why a CLI instead of an MCP/SDK tool: the agent already has Bash. Adding
// a custom MCP tool would require client-side SDK plumbing. A CLI does the
// same job with zero new infrastructure and is easy to test.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: find-concept.mjs "<name>"  |  --uuid "<uuid>"');
  process.exit(2);
}

const cwd = process.cwd();
const conceptsPath = path.join(cwd, "concepts.json");
if (!fs.existsSync(conceptsPath)) {
  console.error(`concepts.json not found in ${cwd}`);
  process.exit(2);
}

let concepts;
try {
  const raw = fs.readFileSync(conceptsPath, "utf8");
  const parsed = JSON.parse(raw);
  concepts = Array.isArray(parsed) ? parsed : (parsed.concepts || []);
} catch (e) {
  console.error(`failed to parse concepts.json: ${e.message}`);
  process.exit(2);
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

if (args[0] === "--uuid") {
  const uuid = args[1];
  if (!uuid) { console.error("--uuid requires a value"); process.exit(2); }
  const hit = concepts.find((c) => c.uuid === uuid);
  emit({
    query: { mode: "uuid", value: uuid },
    found: !!hit,
    concept: hit || null,
    guidance: hit
      ? `Concept exists. Reuse its UUID (${hit.uuid}) and name ("${hit.name}").`
      : `No concept with UUID ${uuid}. Safe to use this UUID for a NEW concept (if v4-shaped).`,
  });
  process.exit(0);
}

const queryName = args[0];
const queryLc = queryName.toLowerCase().trim();

const matches = concepts.filter((c) => (c.name || "").toLowerCase().trim() === queryLc);

if (matches.length === 0) {
  emit({
    query: { mode: "name", value: queryName },
    found: false,
    matches: [],
    guidance: `No concept matches "${queryName}" case-insensitively. SAFE to add a new concept with this name. Generate a v4 UUID and proceed.`,
  });
  process.exit(0);
}

emit({
  query: { mode: "name", value: queryName },
  found: true,
  matchCount: matches.length,
  matches: matches.map((c) => ({
    uuid: c.uuid,
    name: c.name,
    dataType: c.dataType,
    answers: (c.answers || []).map((a) => ({ name: a.name, uuid: a.uuid })),
  })),
  guidance: matches.length === 1
    ? `EXACT MATCH. REUSE UUID ${matches[0].uuid} (name "${matches[0].name}"). DO NOT add a new concept — that triggers a C3/D1 validator error.`
    : `Multiple case-insensitive matches. Verify intent; in most cases reuse the first match's UUID (${matches[0].uuid}).`,
});
