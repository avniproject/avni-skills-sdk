"use strict";
// C5 self-check: the harness ENGINE must carry zero org identifiers — all org
// specifics live in the manifest/fixtures. Scans the engine files for any org
// name from the manifest and reports violations.
const fs = require("node:fs");
const path = require("node:path");
const { manifest } = require("../manifest.cjs");

// Engine files that must stay org-agnostic (manifest + fixtures + tests are exempt).
const ENGINE_FILES = [
  "tests/corpus/lib/corpus-loader.cjs",
  "tests/corpus/lib/deep-names.cjs",
  "tests/corpus/lib/deep-diff.cjs",
  "tests/corpus/lib/acceptance-core.cjs",
  "scripts/acceptance.mjs",
];

// Directories scanned RECURSIVELY for every file inside — the CRL engine
// (src/crl/**) so new files added under it are covered automatically, with
// no ENGINE_FILES edit required on every future CRL task (MAJ-10).
const ENGINE_DIRS = [
  "src/crl",
  "src/spec-view",
];

// Single-directory (non-recursive) glob entries: { dir, ext } — every file
// directly inside `dir` ending in `ext`. Covers the CRL's hand-authored
// reference docs (compliance-doc.yaml, spec-template.yaml) alongside the
// vendored fk-matrix.yaml / spec-format.yaml already there.
const ENGINE_GLOBS = [
  { dir: "skills/avni-bundle-spec/reference", ext: ".yaml" },
];

function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(fp));
    else if (entry.isFile()) out.push(fp);
  }
  return out;
}

function collectEngineFiles(root) {
  const files = [];
  for (const rel of ENGINE_FILES) {
    const fp = path.join(root, rel);
    if (fs.existsSync(fp)) files.push(fp);
  }
  for (const rel of ENGINE_DIRS) {
    const dp = path.join(root, rel);
    if (fs.existsSync(dp)) files.push(...walkDir(dp));
  }
  for (const { dir, ext } of ENGINE_GLOBS) {
    const dp = path.join(root, dir);
    if (!fs.existsSync(dp)) continue;
    for (const name of fs.readdirSync(dp)) {
      if (name.endsWith(ext)) files.push(path.join(dp, name));
    }
  }
  return files;
}

function runGenericityGuard(root) {
  const orgs = manifest().map((r) => r.org);
  const violations = [];
  for (const fp of collectEngineFiles(root)) {
    const src = fs.readFileSync(fp, "utf8");
    for (const org of orgs) if (src.includes(org)) violations.push({ file: path.relative(root, fp), org });
  }
  return { pass: violations.length === 0, violations };
}

module.exports = { runGenericityGuard, collectEngineFiles, ENGINE_FILES, ENGINE_DIRS, ENGINE_GLOBS };
