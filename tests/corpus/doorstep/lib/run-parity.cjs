"use strict";
// Shared runner: generate a bundle from REAL Doorstep .xlsx inputs (not the
// in-memory synthetic fixture), unzip the UAT export, and diff entity-graph
// parity. Single source of truth for both the gated real-data test
// (tests/corpus/doorstep/parity.test.cjs) and any future CLI report
// (scripts/doorstep-parity.mjs).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { AVNI_SKILLS_PATH, validate } = require("../../../entities/lib/fixture.cjs");
const { bundleActiveNames } = require("./entity-names.cjs");
const { diffNames } = require("./parity.cjs");

const GENERATOR = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "scripts", "generate_bundle_v2.js");

// Generate a bundle directly from real .xlsx files (not the in-memory fixture).
function generateFromXlsx({ formsXlsx, modelXlsx, org = "Doorstep" }) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-gen-"));
  const args = ["--srs", modelXlsx, "--forms", formsXlsx, "--org", org, "--output", outDir, "--no-validate"];
  execSync(`node "${GENERATOR}" ${args.map((a) => `"${a}"`).join(" ")}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return outDir;
}

function unzipTo(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dss-uat-"));
  execSync(`unzip -o "${zip}" -d "${dir}"`, { stdio: ["ignore", "pipe", "pipe"] });
  // Auto-descend a single wrapper directory (e.g. a zip that extracts into
  // `<dir>/Door Step School UAT/subjectTypes.json` instead of `<dir>/subjectTypes.json`).
  let root = dir;
  if (!fs.existsSync(path.join(root, "subjectTypes.json"))) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (entries.length === 1 && dirs.length === 1) root = path.join(root, dirs[0].name);
  }
  return root;
}

function runDoorstepParity({ formsXlsx, modelXlsx, uatZip, org = "Doorstep" }) {
  const genDir = generateFromXlsx({ formsXlsx, modelXlsx, org });
  const uatDir = unzipTo(uatZip);
  const generated = bundleActiveNames(genDir);
  const target = bundleActiveNames(uatDir);
  const targetTotal = ["subjectTypes", "programs", "encounterTypes", "forms"]
    .reduce((n, k) => n + target[k].size, 0);
  if (targetTotal === 0) {
    throw new Error(`UAT reference bundle at ${uatDir} has zero active entities — ` +
      `check the zip layout (a nested wrapper directory would cause this). Refusing to report a vacuous parity PASS.`);
  }
  const diff = diffNames(generated, target);
  const validation = validate(genDir);
  return { diff, validation, genDir, uatDir, generated, target };
}

module.exports = { runDoorstepParity, generateFromXlsx, unzipTo };
