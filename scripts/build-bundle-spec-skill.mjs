#!/usr/bin/env node
// build-bundle-spec-skill.mjs — stage the brain's canonical fk-matrix.yaml
// into the avni-bundle-spec Skill (Level-2 reference), WITH provenance.
//
// The skill (skills/avni-bundle-spec/) follows Anthropic's Agent-Skills
// progressive-disclosure model: SKILL.md (always-loaded) references several
// Level-2/3 files that the agent loads on demand. One of those — the FK
// matrix — is the SINGLE SOURCE OF TRUTH living in the BRAIN
// (avni-skills/srs-bundle-generator/spec/fk-matrix.yaml). We must NOT fork it;
// instead we VENDOR a copy into the skill so the agent can read it without a
// cross-repo hop, and we stamp the copy with a provenance header (source repo,
// path, and the git sha of the canonical file at stage time).
//
// A checksum test (tests/discovery/bundle-spec-checksum.test.cjs) then asserts
// the staged copy's BODY (provenance header stripped) byte-matches the brain
// canonical — so the skill can never silently drift from the brain. If the
// brain's fk-matrix changes, re-run this script; the test fails until you do.
//
// Usage:
//   AVNI_SKILLS_PATH=/path/to/avni-skills node scripts/build-bundle-spec-skill.mjs
//
// Idempotent. Exits non-zero if the brain or its fk-matrix can't be found.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SKILL_DIR = path.join(SDK_DIR, "skills", "avni-bundle-spec");
const STAGED_MATRIX = path.join(SKILL_DIR, "reference", "fk-matrix.yaml");
const ENTITY_SHAPES = path.join(SKILL_DIR, "reference", "entity-shapes.md");

// The brain's bundle validator — single source of truth for the closed enum
// sets (VALID_DATA_TYPES, VALID_PRIVILEGE_TYPES, …). We generate the matching
// closed-enum blocks in entity-shapes.md from it so they can never drift.
export function validatorPath(brainPath = resolveBrainPath()) {
  return path.join(brainPath, "srs-bundle-generator", "validators", "bundle_validator.js");
}

// Extract the string members of a `const <NAME> = new Set([ ... ]);` literal
// from the validator source, in source order. Order is preserved so the
// generated block is deterministic and the drift test is order-sensitive.
export function extractValidatorSet(name, src) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = src.match(re);
  if (!m) throw new Error(`could not find "const ${name} = new Set([...])" in the brain validator`);
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
}

// Read the validator's VALID_* sets + best-effort git provenance for the file.
export function readValidatorEnums(brainPath = resolveBrainPath()) {
  const src = validatorPath(brainPath);
  if (!fs.existsSync(src)) {
    throw new Error(
      `brain validator not found at "${src}". Set AVNI_SKILLS_PATH to a checkout of ` +
      `avni-skills that contains srs-bundle-generator/validators/bundle_validator.js.`,
    );
  }
  const body = fs.readFileSync(src, "utf8");
  let sha = "unknown";
  try {
    sha = execFileSync(
      "git", ["log", "-1", "--format=%H", "--", "srs-bundle-generator/validators/bundle_validator.js"],
      { cwd: brainPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || "unknown";
  } catch { /* not a git checkout / git unavailable */ }
  return {
    src, sha,
    dataType: extractValidatorSet("VALID_DATA_TYPES", body),
    privilegeType: extractValidatorSet("VALID_PRIVILEGE_TYPES", body),
  };
}

// sha256 of a value set — order-sensitive, joined on "\n" (matches the test).
export function enumChecksum(values) {
  return crypto.createHash("sha256").update(values.join("\n"), "utf8").digest("hex");
}

// Wrap a comma-separated value list to ~76 cols for a readable fenced block.
function wrapList(values, width = 76) {
  const lines = [];
  let cur = "";
  values.forEach((v, i) => {
    const tok = v + (i < values.length - 1 ? "," : "");
    if (cur && (cur.length + 1 + tok.length) > width) { lines.push(cur); cur = tok; }
    else cur = cur ? `${cur} ${tok}` : tok;
  });
  if (cur) lines.push(cur);
  return lines.join("\n");
}

// Replace the GENERATED:<key> fenced block AND its provenance comment in the
// entity-shapes.md text. Idempotent — operates on sentinel markers the doc
// carries. Throws if the markers are missing (so a doc edit can't silently
// disable generation).
export function replaceGeneratedEnum(docText, key, values, { src, sha }) {
  const startTag = `<!-- GENERATED:${key}`;
  const endTag = `<!-- /GENERATED:${key} -->`;
  const sIdx = docText.indexOf(startTag);
  const eIdx = docText.indexOf(endTag);
  if (sIdx === -1 || eIdx === -1) {
    throw new Error(`entity-shapes.md is missing the GENERATED:${key} sentinel block`);
  }
  // Preserve the opening sentinel comment line verbatim (find its end-of-line).
  const sLineEnd = docText.indexOf("\n", sIdx);
  const block =
    docText.slice(sIdx, sLineEnd + 1) +
    "```\n" + wrapList(values) + "\n```\n" +
    endTag;
  let out = docText.slice(0, sIdx) + block + docText.slice(eIdx + endTag.length);

  // Refresh the provenance comment for this key.
  const pStart = `<!-- provenance:${key}`;
  const pEnd = `<!-- /provenance:${key} -->`;
  const pSIdx = out.indexOf(pStart);
  const pEIdx = out.indexOf(pEnd);
  if (pSIdx === -1 || pEIdx === -1) {
    throw new Error(`entity-shapes.md is missing the provenance:${key} sentinel block`);
  }
  const relSrc = "srs-bundle-generator/validators/bundle_validator.js";
  const prov =
    `<!-- provenance:${key}\n` +
    `     source-repo:  avniproject/avni-skills\n` +
    `     source-path:  ${relSrc}\n` +
    `     source-sha:   ${sha}\n` +
    `     value-sha256: ${enumChecksum(values)}\n` +
    `     staged-by:    scripts/build-bundle-spec-skill.mjs (do not edit by hand)\n` +
    `-->\n` +
    pEnd;
  out = out.slice(0, pSIdx) + prov + out.slice(pEIdx + pEnd.length);
  return out;
}

// The marker that separates the generated provenance header from the verbatim
// brain body. Everything ABOVE this line (inclusive) is SDK-generated; the
// checksum test ignores it and compares only the body below.
export const PROVENANCE_END_MARKER =
  "# ─── END PROVENANCE (verbatim brain copy below this line) ───";

// Resolve the brain the SAME way the rest of the SDK does (env var or sibling
// clone) — mirrors src/pipeline.js + src/agents/bundle-mcp-server.js.
export function resolveBrainPath() {
  if (process.env.AVNI_SKILLS_PATH) return process.env.AVNI_SKILLS_PATH;
  return path.resolve(SDK_DIR, "..", "avni-skills");
}

export function canonicalMatrixPath(brainPath = resolveBrainPath()) {
  return path.join(brainPath, "srs-bundle-generator", "spec", "fk-matrix.yaml");
}

// Read the canonical fk-matrix body + best-effort git provenance.
export function readCanonicalMatrix(brainPath = resolveBrainPath()) {
  const src = canonicalMatrixPath(brainPath);
  if (!fs.existsSync(src)) {
    throw new Error(
      `canonical fk-matrix.yaml not found at "${src}". Set AVNI_SKILLS_PATH to a ` +
      `checkout of avni-skills that contains srs-bundle-generator/spec/fk-matrix.yaml ` +
      `(the #14 branch).`,
    );
  }
  const body = fs.readFileSync(src, "utf8");
  let sha = "unknown";
  let lastModified = "unknown";
  try {
    sha = execFileSync(
      "git", ["log", "-1", "--format=%H", "--", "srs-bundle-generator/spec/fk-matrix.yaml"],
      { cwd: brainPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || "unknown";
    lastModified = execFileSync(
      "git", ["log", "-1", "--format=%ci", "--", "srs-bundle-generator/spec/fk-matrix.yaml"],
      { cwd: brainPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || "unknown";
  } catch { /* not a git checkout / git unavailable — provenance stays "unknown" */ }
  return { src, body, sha, lastModified };
}

export function bodyChecksum(body) {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

// Build the full staged-file text: provenance header + END marker + verbatim body.
export function buildStagedContent({ src, body, sha, lastModified }) {
  const checksum = bodyChecksum(body);
  const header = [
    "# ╔══════════════════════════════════════════════════════════════════════╗",
    "# ║  STAGED COPY — DO NOT EDIT BY HAND.                                    ║",
    "# ║  Generated by scripts/build-bundle-spec-skill.mjs.                     ║",
    "# ╚══════════════════════════════════════════════════════════════════════╝",
    "#",
    "# This is a VENDORED copy of the canonical FK matrix that lives in the",
    "# avni-skills brain. It is staged here so the avni-bundle-spec Skill can",
    "# read it on-demand without a cross-repo hop. It is NOT the source of truth.",
    "#",
    "# provenance:",
    `#   source-repo: avniproject/avni-skills`,
    `#   source-path: srs-bundle-generator/spec/fk-matrix.yaml`,
    `#   source-sha:  ${sha}`,
    `#   source-mtime: ${lastModified}`,
    `#   body-sha256: ${checksum}`,
    `#   staged-by:   scripts/build-bundle-spec-skill.mjs`,
    "#",
    "# A checksum test (tests/discovery/bundle-spec-checksum.test.cjs) asserts the",
    "# BODY below byte-matches the brain canonical. If the brain changes, re-run",
    "# the build script — the test fails until the staged copy is refreshed.",
    "#",
    PROVENANCE_END_MARKER,
    "",
  ].join("\n");
  return header + body;
}

// Parse a staged file back into { header, body } by splitting on the END marker.
// Used by the checksum test to compare ONLY the body.
export function splitStaged(text) {
  const idx = text.indexOf(PROVENANCE_END_MARKER);
  if (idx === -1) return { header: "", body: text };
  // Body starts after the marker line + its trailing newline + the blank line.
  const afterMarker = text.slice(idx + PROVENANCE_END_MARKER.length);
  // Drop exactly one leading "\n" (end of marker line) and one more "\n" (blank separator).
  const body = afterMarker.replace(/^\n/, "").replace(/^\n/, "");
  return { header: text.slice(0, idx + PROVENANCE_END_MARKER.length), body };
}

function main() {
  const brainPath = resolveBrainPath();

  // 1. Stage the fk-matrix.yaml (the existing behaviour).
  const canonical = readCanonicalMatrix(brainPath);
  const content = buildStagedContent(canonical);
  fs.mkdirSync(path.dirname(STAGED_MATRIX), { recursive: true });
  fs.writeFileSync(STAGED_MATRIX, content);

  const rel = path.relative(SDK_DIR, STAGED_MATRIX);
  process.stderr.write(
    `staged ${rel}\n` +
    `  ← ${canonical.src}\n` +
    `  source-sha:  ${canonical.sha}\n` +
    `  body-sha256: ${bodyChecksum(canonical.body)}\n`,
  );

  // 2. Generate the closed-enum blocks in entity-shapes.md from the brain
  //    validator's VALID_* sets, with provenance. Keeps the "Derived from the
  //    server-contract validator" banner honest and drift-guarded.
  const enums = readValidatorEnums(brainPath);
  let doc = fs.readFileSync(ENTITY_SHAPES, "utf8");
  doc = replaceGeneratedEnum(doc, "dataType", enums.dataType, enums);
  doc = replaceGeneratedEnum(doc, "privilegeType", enums.privilegeType, enums);
  fs.writeFileSync(ENTITY_SHAPES, doc);

  process.stderr.write(
    `staged ${path.relative(SDK_DIR, ENTITY_SHAPES)}\n` +
    `  ← ${enums.src}\n` +
    `  source-sha:        ${enums.sha}\n` +
    `  dataType (${enums.dataType.length}):      ${enumChecksum(enums.dataType).slice(0, 16)}…\n` +
    `  privilegeType (${enums.privilegeType.length}): ${enumChecksum(enums.privilegeType).slice(0, 16)}…\n`,
  );
}

// Run only when invoked directly (not when required by the checksum test).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`build-bundle-spec-skill failed: ${e.message}\n`);
    process.exit(1);
  }
}
