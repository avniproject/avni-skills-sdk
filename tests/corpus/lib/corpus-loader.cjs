"use strict";
// Generic corpus loader: normalizes any org's oracle (dir|zip) to a bundle directory
// and decides which orgs can run now. Org-agnostic — no org names appear here.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const BUNDLE_MARKERS = ["subjectTypes.json", "forms", "concepts.json", "formMappings.json"];
const hasMarker = (d) => BUNDLE_MARKERS.some((m) => fs.existsSync(path.join(d, m)));

// Oracle-only orgs have no scoping inputs → the generation dimension is skipped.
function hasInputs(row) {
  return !!(row && row.inputs && row.inputs.srs);
}

// Server exports wrap the bundle in a single dir; descend until the marker files appear.
function descendWrapper(dir) {
  if (hasMarker(dir)) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("__MACOSX") && !e.name.startsWith("."));
  const subdirs = entries.filter((e) => e.isDirectory());
  if (subdirs.length === 1) return descendWrapper(path.join(dir, subdirs[0].name));
  return dir; // ambiguous — return as-is; the differ will report an empty bundle
}

// Extract a zip robustly. Some UAT exports carry filenames with non-ASCII chars
// (e.g. an en-dash) that system `unzip` mangles under a non-UTF-8 locale; macOS
// `ditto` handles them. Fall back to `unzip` elsewhere.
function extractZip(zip, out) {
  if (process.platform === "darwin") {
    try { execSync(`ditto -x -k "${zip}" "${out}"`, { stdio: ["ignore", "pipe", "pipe"] }); return; }
    catch { /* fall through to unzip */ }
  }
  execSync(`unzip -o -q "${zip}" -d "${out}"`, { stdio: ["ignore", "pipe", "pipe"] });
}

// Normalize {dir}|{zip} → a bundle directory.
function loadOracle(row) {
  const oracle = (row && row.oracle) || {};
  if (oracle.dir) return oracle.dir;
  if (oracle.zip) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-oracle-"));
    extractZip(oracle.zip, out);
    return descendWrapper(out);
  }
  throw new Error(`org ${row && row.org}: oracle has neither dir nor zip`);
}

function requiredFiles(row) {
  const files = [];
  if (row.oracle && row.oracle.dir) files.push(row.oracle.dir);
  if (row.oracle && row.oracle.zip) files.push(row.oracle.zip);
  if (hasInputs(row)) {
    files.push(row.inputs.srs);
    if (row.inputs.modelling) files.push(row.inputs.modelling);
  }
  return files;
}

function filesPresent(row) {
  return requiredFiles(row).every((f) => fs.existsSync(f));
}

// Committed orgs run whenever their files are present; proprietary orgs run only when real===true.
function listRunnableOrgs(rows, { real = false } = {}) {
  return rows.filter((row) => {
    if (row.tier === "proprietary" && !real) return false;
    return filesPresent(row);
  });
}

module.exports = { hasInputs, descendWrapper, loadOracle, requiredFiles, filesPresent, listRunnableOrgs };
