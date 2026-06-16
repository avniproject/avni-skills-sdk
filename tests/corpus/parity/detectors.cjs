// detectors.cjs — load the three detectors and compute the OLD / NEW detection
// surfaces for a single bundle directory, normalised to canonical triples.
//
// Three detectors:
//   OLD-a  src/pipeline.js              checkIntegrityOnFileMap(fileMap)   (ESM)
//   OLD-b  $AVNI_SKILLS_PATH/.../graph  buildBundleGraph(dir)+integrityCheck (CJS)
//   NEW    src/agents/bundle-mcp-server runBundleIntegrityCheck(dir)        (ESM)
//
//   OLD detection surface = normalize(OLD-a) ∪ normalize(OLD-b)
//   NEW detection surface = normalize(NEW)
//
// The SDK's src/*.js are ESM ("type":"module"); these test files are CJS (.cjs).
// We bridge with dynamic import() behind a tiny memoised loader. The brain's
// graph.js is CommonJS and loads via require().

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  fromGraphIssue,
  fromFileMapIssue,
  fromNewFinding,
  toSet,
  assertNoValidatorCodes,
} = require("./normalize.cjs");

const AVNI_SKILLS_PATH = process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "..", "..", "avni-skills");
const SPEC = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "spec");
const GRAPH_JS = path.join(SPEC, "graph.js");

// Brain graph detector (CommonJS). FAIL LOUD if it cannot load: a half-loaded
// OLD surface would silently shrink (graph.integrityCheck contributes nothing)
// and could pass as parity while actually losing every graph-only detection.
// This is NOT a "skip when no corpus" condition — that is handled separately in
// run.cjs (a missing $SDK_CORPUS_PATH exits 0). A missing/broken brain is a hard
// error: the gate cannot be trusted without it.
let buildBundleGraph, integrityCheck;
try {
  if (!fs.existsSync(GRAPH_JS)) {
    throw new Error(`brain graph.js not found at ${GRAPH_JS}`);
  }
  ({ buildBundleGraph, integrityCheck } = require(GRAPH_JS));
  if (typeof buildBundleGraph !== "function" || typeof integrityCheck !== "function") {
    throw new Error(
      `brain graph.js at ${GRAPH_JS} did not export buildBundleGraph + integrityCheck functions`,
    );
  }
} catch (e) {
  throw new Error(
    `corpus:parity gate cannot load the avni-skills brain (graph.integrityCheck detector). ` +
    `Without it the OLD detection surface is incomplete and the gate would FALSELY pass. ` +
    `Set AVNI_SKILLS_PATH to a valid avni-skills checkout (tried: ${AVNI_SKILLS_PATH}). ` +
    `Underlying error: ${e.message}`,
  );
}

// SDK detectors are ESM — memoise the dynamic imports.
let _esm = null;
async function loadEsm() {
  if (_esm) return _esm;
  const mcp = await import(
    path.resolve(__dirname, "..", "..", "..", "src", "agents", "bundle-mcp-server.js")
  );
  const pipeline = await import(
    path.resolve(__dirname, "..", "..", "..", "src", "pipeline.js")
  );
  _esm = {
    runBundleIntegrityCheck: mcp.runBundleIntegrityCheck,
    checkIntegrityOnFileMap: pipeline.checkIntegrityOnFileMap,
  };
  return _esm;
}

// Read a bundle directory into the file-map shape checkIntegrityOnFileMap wants.
// (Mirrors readBundleFileMap in bundle-mcp-server.js — kept local so the OLD
// file-map detector can be exercised directly without going through the NEW tool.)
function readBundleFileMap(bundleDir) {
  const files = {};
  const topLevel = [
    "concepts.json",
    "subjectTypes.json",
    "programs.json",
    "encounterTypes.json",
    "formMappings.json",
    "operationalSubjectTypes.json",
    "operationalPrograms.json",
    "operationalEncounterTypes.json",
    "addressLevelTypes.json",
  ];
  for (const rel of topLevel) {
    const fp = path.join(bundleDir, rel);
    if (fs.existsSync(fp)) {
      try { files[rel] = JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch { /* malformed JSON is the validator's job */ }
    }
  }
  const formsDir = path.join(bundleDir, "forms");
  if (fs.existsSync(formsDir)) {
    for (const f of fs.readdirSync(formsDir)) {
      if (!f.endsWith(".json")) continue;
      const fp = path.join(formsDir, f);
      try { files[`forms/${f}`] = JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch { /* malformed JSON is the validator's job */ }
    }
  }
  return files;
}

/**
 * OLD detection surface for a bundle dir = normalize(checkIntegrityOnFileMap)
 * ∪ normalize(graph.integrityCheck). Returns { triples, set, raw }.
 */
async function oldSurface(bundleDir) {
  const { checkIntegrityOnFileMap } = await loadEsm();

  // OLD-a: file-map detector
  const fileMap = readBundleFileMap(bundleDir);
  const fmRes = checkIntegrityOnFileMap(fileMap);
  assertNoValidatorCodes(fmRes.issues, "checkIntegrityOnFileMap");
  const fmTriples = fmRes.issues.map(fromFileMapIssue);

  // OLD-b: graph detector
  const graph = buildBundleGraph(bundleDir);
  const gRes = integrityCheck(graph);
  assertNoValidatorCodes(gRes.issues, "graph.integrityCheck");
  const gTriples = gRes.issues.map(fromGraphIssue);

  const triples = [...fmTriples, ...gTriples];
  return {
    triples,
    set: toSet(triples),
    raw: { fileMap: fmRes.issues, graph: gRes.issues },
  };
}

/**
 * NEW detection surface for a bundle dir = normalize(runBundleIntegrityCheck).
 * Returns { triples, set, raw }.
 */
async function newSurface(bundleDir) {
  const { runBundleIntegrityCheck } = await loadEsm();
  const res = runBundleIntegrityCheck(bundleDir);
  assertNoValidatorCodes(res.findings, "runBundleIntegrityCheck");
  const triples = res.findings.map(fromNewFinding);
  return {
    triples,
    set: toSet(triples),
    raw: { findings: res.findings },
  };
}

module.exports = {
  AVNI_SKILLS_PATH,
  SPEC,
  readBundleFileMap,
  oldSurface,
  newSurface,
  loadEsm,
};
