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

function runGenericityGuard(root) {
  const orgs = manifest().map((r) => r.org);
  const violations = [];
  for (const rel of ENGINE_FILES) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const src = fs.readFileSync(fp, "utf8");
    for (const org of orgs) if (src.includes(org)) violations.push({ file: rel, org });
  }
  return { pass: violations.length === 0, violations };
}

module.exports = { runGenericityGuard, ENGINE_FILES };
