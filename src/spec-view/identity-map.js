// src/spec-view/identity-map.js — read-only uuid<->name breadcrumb.
//
// Reuses P1's buildIdentityIndex (the SAME builder that resolves cross-ref
// UUIDs to names when reshaping spec.yaml) as its ONLY data source — this
// module does zero independent bundle-parsing. It is a pure serializer:
// identityIndex.byKind -> a versioned, name-keyed, deterministically sorted
// YAML breadcrumb.
//
// READ-ONLY / DERIVED. Nothing in this codebase consumes the persisted file
// (see contract §3.2 / design decision 3) — it only de-risks a future editing
// feature by keeping the uuid a human would need to hand-author a
// rename/reconcile step available in one place, without smuggling uuids back
// into spec.yaml's body.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

import { buildIdentityIndex, readRichBundleFileMap } from "./emit.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors src/spec-view/emit.js's resolveBrainPath() / src/crl/compliance-doc.js's
// loadYaml() exactly — js-yaml is resolved from the brain's node_modules, not a
// direct dependency of this repo (no lockfile churn). Grounded: package.json
// carries no js-yaml; ../avni-skills/node_modules/js-yaml is present.
function resolveBrainPath() {
  if (process.env.AVNI_SKILLS_PATH) return process.env.AVNI_SKILLS_PATH;
  return path.resolve(__dirname, "..", "..", "..", "avni-skills");
}

let _yaml;
function loadYaml() {
  if (_yaml) return _yaml;
  const brainPath = resolveBrainPath();
  const yamlPath = path.join(brainPath, "node_modules", "js-yaml");
  if (!fs.existsSync(yamlPath)) {
    throw new Error(
      `js-yaml not found at ${yamlPath}. identity-map.js resolves js-yaml from the brain's ` +
      `node_modules (AVNI_SKILLS_PATH env var, or the sibling ../avni-skills clone), mirroring ` +
      `src/spec-view/emit.js. Checkout avni-skills alongside this repo, or set AVNI_SKILLS_PATH.`
    );
  }
  _yaml = require(yamlPath);
  return _yaml;
}

// buildIdentityIndex "kind" -> identity-map.yaml section name. Pinned 1:1 to
// the reconciliation synthesis's contract §2 (finding C1's fix): P1's
// buildIdentityIndex builds EXACTLY these 11 kinds today — no more, no less
// (verified against src/spec-view/emit.js KIND_SOURCES + the injected `form`
// bucket). Section names mirror the plural family names spec.yaml uses (brain
// emitter.js's top-level keys / PASSTHROUGH table) so a human reading both
// files side by side sees the same labels.
//
// This table is intentionally CLOSED, not a speculative superset. If a later
// phase extends buildIdentityIndex's byKind to cover more families, add the
// matching entry here (and a completeness assertion) in that phase's own PR,
// not ahead of time.
const KIND_TO_SECTION = {
  subjectType: "subjectTypes",
  program: "programs",
  encounterType: "encounterTypes",
  group: "groups",
  addressLevelType: "addressLevels",
  form: "forms",
  concept: "concepts",
  reportCard: "reportCards",
  reportDashboard: "reportDashboards",
  identifierSource: "identifierSources",
  documentation: "documentations",
};
function sectionNameFor(kind) {
  // Defensive fallback only — the 11 keys above are the full, contract-pinned
  // set as of this phase; this branch exists so a future byKind addition
  // degrades to a readable section name instead of a silent drop, never so a
  // real kind can be quietly renamed.
  return KIND_TO_SECTION[kind] || (kind.endsWith("s") ? kind : `${kind}s`);
}

// P1's buildIdentityIndex stores each kind's uuidToName as a Map (verified
// against emit.js buildBucket). Iterate it as a Map; the plain-object branch is
// a defensive fallback in case a future P1 refactor swaps the container.
function entriesOf(m) {
  if (m instanceof Map) return [...m.entries()];
  if (m && typeof m === "object") return Object.entries(m);
  return [];
}

function compareRows(a, b) {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  if (a.uuid < b.uuid) return -1;
  if (a.uuid > b.uuid) return 1;
  return 0;
}

/**
 * Read-only breadcrumb. bundleDir OR existingBundleFiles (fileMap). Delegates
 * ALL bundle-shape knowledge to P1's buildIdentityIndex — this function only
 * shapes + sorts + serializes it. DETERMINISTIC, no LLM.
 *
 * @param {Object} args
 * @param {string} [args.bundleDir]
 * @param {Object} [args.existingBundleFiles]
 * @returns {{ yaml: string, map: object }}
 */
export function emitIdentityMap({ bundleDir, existingBundleFiles } = {}) {
  let fileMap;
  if (bundleDir) {
    fileMap = readRichBundleFileMap(bundleDir);
  } else if (existingBundleFiles && typeof existingBundleFiles === "object") {
    fileMap = existingBundleFiles;
  } else {
    throw new Error("emitIdentityMap: either bundleDir or existingBundleFiles required");
  }

  const identityIndex = buildIdentityIndex(fileMap);
  const sections = [];
  for (const [kind, kindIndex] of Object.entries(identityIndex.byKind || {})) {
    const rows = entriesOf(kindIndex && kindIndex.uuidToName)
      .map(([uuid, name]) => ({ name, uuid }))
      .sort(compareRows);
    if (rows.length === 0) continue; // mirrors spec.yaml's empty-family omission
    sections.push([sectionNameFor(kind), rows]);
  }
  sections.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const map = { version: 1 };
  for (const [sectionName, rows] of sections) map[sectionName] = rows;

  const yaml = loadYaml();
  const yamlText = yaml.dump(map, {
    noRefs: true,
    sortKeys: false,
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  });
  return { yaml: yamlText, map };
}
