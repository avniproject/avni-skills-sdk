// src/spec-view/emit.js — the ONE rich spec emitter (Live Spec View, P1).
//
// Reconstructs a name-keyed, UUID-free, ~25-family entities dict from a bundle
// file map and hands it to the brain's `entitiesToSpec` (unchanged) as the YAML
// serializer. This is the single emitter feeding: pipeline.emitSpec, the MCP
// spec_emit / spec_review tools, the per-turn live-view sync (P3), and
// reviewSpec's subject. Deterministic, no LLM.
//
// Why SDK-side (not in the brain): the missing work is *bundle-shape knowledge*
// — reshaping operational mirrors, resolving cross-ref UUIDs → names, reading
// the ~30 ancillary files. Every piece of bundle-shape knowledge already lives
// SDK-side; the brain's `entitiesToSpec` consumes an entities dict, not a
// bundle, so it is the wrong layer to teach bundle-file shapes. Keeping the
// serializer identical preserves the parser↔emitter round-trip contract.
//
// Public API:
//   readRichBundleFileMap(bundleDir) -> fileMap        // full dir, sorted forms
//   buildIdentityIndex(fileMap)      -> { byKind, resolve }
//   bundleToRichEntities(fileMap, { identityIndex }) -> entities
//   emitRichSpec({ bundleDir, existingBundleFiles, org }) -> YAML string
//
// The module carries ZERO org names (org is a parameter) so the genericity
// guard stays green.

import fs from "node:fs";
import path from "node:path";

// ─── 1. Full-bundle file map ─────────────────────────────────────────
//
// Superset of bundle-mcp-server.js's private 13-file `readBundleFileMap`. Reads
// every ancillary family too. NOTE the singular filenames the real corpus uses
// (`groupRole.json`, not the plural `groupRoles.json` that private map carries —
// that plural is a latent bug against real bundles; this map uses the
// corpus-verified singular name).

const RICH_TOP_LEVEL = [
  // 13 core
  "organisationConfig.json", "addressLevelTypes.json", "subjectTypes.json",
  "operationalSubjectTypes.json", "programs.json", "operationalPrograms.json",
  "encounterTypes.json", "operationalEncounterTypes.json", "concepts.json",
  "formMappings.json", "groups.json", "groupPrivilege.json",
  "individualRelation.json", "relationshipType.json",
  // ancillary — present in the committed corpus
  "groupRole.json", "identifierSource.json", "messageRule.json",
  "catchments.json", "locations.json", "documentations.json",
  "reportCard.json", "reportDashboard.json", "menuItem.json",
  "groupDashboards.json", "ruleDependency.json",
  // ancillary — no committed-corpus example, read defensively if present
  "checklist.json", "video.json", "customQuery.json",
];

export function readRichBundleFileMap(bundleDir) {
  const files = {};
  for (const rel of RICH_TOP_LEVEL) {
    const fp = path.join(bundleDir, rel);
    if (fs.existsSync(fp)) {
      try { files[rel] = JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch { /* malformed JSON degrades to a thin emit — the validator's job */ }
    }
  }
  const formsDir = path.join(bundleDir, "forms");
  if (fs.existsSync(formsDir)) {
    // Sorted so key-insertion order (and downstream Object.entries traversal)
    // is deterministic across machines — readdirSync order is NOT guaranteed.
    for (const f of fs.readdirSync(formsDir).sort()) {
      if (!f.endsWith(".json")) continue;
      try { files[`forms/${f}`] = JSON.parse(fs.readFileSync(path.join(formsDir, f), "utf8")); }
      catch { /* validator's job */ }
    }
  }
  return files;
}
