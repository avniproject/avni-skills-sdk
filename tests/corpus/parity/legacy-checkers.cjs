// legacy-checkers.cjs — FROZEN reference copy of the deleted SDK-local
// integrity checker. DO NOT EDIT THE LOGIC.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS
// ─────────────────────────────────────────────────────────────────────────────
// `checkIntegrityOnFileMap` (and its private `asArray` helper) below is a
// VERBATIM, byte-for-byte frozen copy of the function that USED to live in
// `src/pipeline.js`, deleted from production in avni-skills-sdk#15 (story #10)
// because its FK / dangling-reference coverage is a proven subset of the brain's
// yaml-driven dependency graph (`buildBundleGraph` + `integrityCheck`, driven by
// `srs-bundle-generator/spec/fk-matrix.yaml`).
//
// The ONLY change from the original is the module syntax: the original was ESM
// (`export function checkIntegrityOnFileMap`) because all `src/*.js` are ESM;
// here it is CommonJS (`module.exports`) because the parity gate's test files are
// `.cjs`. The function bodies are otherwise UNTOUCHED — same traversal, same FK
// fields, same `{ severity, code:"DANGLING_REF", message, from, to, field }`
// issue shape, same required/optional severity classification.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY IT IS FROZEN HERE (and not imported from src/pipeline.js)
// ─────────────────────────────────────────────────────────────────────────────
// The `corpus:parity` gate proves:
//
//     bundle_integrity_check (NEW)  ⊇  ( legacy checkIntegrityOnFileMap
//                                         ∪  graph.integrityCheck )  (OLD)
//
// i.e. the NEW detector loses NOTHING the two OLD detectors caught (Σ LOST = 0).
// Now that production no longer ships `checkIntegrityOnFileMap`, the gate can no
// longer import it from `src/pipeline.js`. Vendoring this frozen copy keeps the
// OLD baseline EXACTLY as it was at the moment of deletion, so the gate
// PERMANENTLY guards against any future regression of the NEW detector below the
// original deterministic coverage — even though the legacy checker is gone from
// the product. (This mirrors slice 1's frozen golden-reference approach.)
//
// Because it is a FROZEN baseline, this file must NOT be "kept in sync" with any
// future change. If the NEW detector's coverage ever shrinks below this frozen
// surface, the gate SHOULD go red — that is the entire point.
//
// Original source: src/pipeline.js @ avni-skills-sdk 3d28deb (pre-#15-deletion).

"use strict";

// Adapter: graph builder expects a directory path; here we have a file map.
// We replicate the bare minimum traversal — building uuid → kind index +
// walking the same FK fields the graph builder does. Handles BOTH bare-array
// and {wrappedKey: [...]} shapes (the deterministic generator emits the
// wrapped form for operational entities; synthetic tests use bare arrays).
function asArray(value, wrappedKey) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (wrappedKey && Array.isArray(value[wrappedKey])) return value[wrappedKey];
  return [];
}

// Local SDK-side FK / dangling-reference checker. As of #14 (slice 2) the
// in-process MCP `bundle_integrity_check` tool NO LONGER calls this — it drives
// FK integrity off the brain's yaml-driven dependency graph (buildBundleGraph +
// integrityCheck), which covers every edge kind incl. the graph-only ones this
// local checker never saw. This function is kept ONLY as the OLD baseline the
// parity gate compares against; its deletion is story #10's explicit,
// parity-gated final step — do NOT remove it here. Still consumed by applySpec
// above (production patch path) pending that same parity-gated migration.
function checkIntegrityOnFileMap(files) {
  const issues = [];
  const uuidIndex = new Map();    // uuid → kind

  function index(kind, arr) {
    for (const e of arr) {
      if (e && typeof e.uuid === "string") uuidIndex.set(e.uuid, kind);
    }
  }

  index("concept",                  asArray(files["concepts.json"]));
  index("subjectType",              asArray(files["subjectTypes.json"]));
  index("program",                  asArray(files["programs.json"]));
  index("encounterType",            asArray(files["encounterTypes.json"]));
  index("formMapping",              asArray(files["formMappings.json"]));
  index("operationalSubjectType",   asArray(files["operationalSubjectTypes.json"],   "operationalSubjectTypes"));
  index("operationalProgram",       asArray(files["operationalPrograms.json"],       "operationalPrograms"));
  index("operationalEncounterType", asArray(files["operationalEncounterTypes.json"], "operationalEncounterTypes"));
  index("addressLevelType",         asArray(files["addressLevelTypes.json"]));
  for (const [pathStr, content] of Object.entries(files)) {
    if (pathStr.startsWith("forms/") && pathStr.endsWith(".json")) {
      if (content && typeof content === "object" && content.uuid) {
        uuidIndex.set(content.uuid, "form");
      }
    }
  }

  function check(fromUuid, toUuid, field, required) {
    if (!toUuid) return;
    if (uuidIndex.has(toUuid)) return;
    issues.push({
      severity: required ? "error" : "warning",
      code: "DANGLING_REF",
      message: `${field} → ${toUuid} (not found in bundle)`,
      from: fromUuid,
      to: toUuid,
      field,
    });
  }

  for (const m of asArray(files["formMappings.json"])) {
    check(m.uuid, m.formUUID,         "formMapping.formUUID",         true);
    check(m.uuid, m.subjectTypeUUID,  "formMapping.subjectTypeUUID",  true);
    if (m.programUUID)        check(m.uuid, m.programUUID,        "formMapping.programUUID",        false);
    if (m.encounterTypeUUID)  check(m.uuid, m.encounterTypeUUID,  "formMapping.encounterTypeUUID",  false);
  }
  for (const c of asArray(files["concepts.json"])) {
    for (const a of (c.answers || [])) {
      if (a && a.uuid) check(c.uuid, a.uuid, "concept.answers[].uuid", false);
    }
  }
  // operational entities reference base entities via `{kind}.uuid` (nested),
  // not `{kind}UUID` (flat) — matches the generator's actual output shape.
  for (const op of asArray(files["operationalSubjectTypes.json"], "operationalSubjectTypes")) {
    const refUuid = op.subjectType?.uuid || op.subjectTypeUUID;
    if (refUuid) check(op.uuid, refUuid, "operationalSubjectType.subjectType.uuid", true);
  }
  for (const op of asArray(files["operationalPrograms.json"], "operationalPrograms")) {
    const refUuid = op.program?.uuid || op.programUUID;
    if (refUuid) check(op.uuid, refUuid, "operationalProgram.program.uuid", true);
  }
  for (const op of asArray(files["operationalEncounterTypes.json"], "operationalEncounterTypes")) {
    const refUuid = op.encounterType?.uuid || op.encounterTypeUUID;
    if (refUuid) check(op.uuid, refUuid, "operationalEncounterType.encounterType.uuid", true);
  }
  for (const [pathStr, form] of Object.entries(files)) {
    if (!pathStr.startsWith("forms/") || !pathStr.endsWith(".json")) continue;
    if (!form || typeof form !== "object") continue;
    for (const grp of (form.formElementGroups || [])) {
      for (const fe of (grp.formElements || [])) {
        if (fe && fe.concept && fe.concept.uuid) {
          check(form.uuid, fe.concept.uuid, `form.formElementGroups[].formElements["${fe.name}"].concept.uuid`, true);
        }
      }
    }
  }

  const hasError = issues.some((i) => i.severity === "error");
  return { ok: !hasError, issues };
}

module.exports = { checkIntegrityOnFileMap };
