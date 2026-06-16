// normalize.cjs — detector-agnostic canonicalisation for the corpus:parity gate.
//
// PURPOSE
// -------
// The `corpus:parity` gate proves the NEW `bundle_integrity_check` detector
// catches everything the two OLD detectors being consolidated catch, BEFORE we
// delete `checkIntegrityOnFileMap`. To compare them we must first strip away the
// surface differences (message wording, array index, finding shape) and reduce
// every finding from all three detectors to a canonical triple:
//
//     { class, file, locator }
//
//   • class   — a coarse, detector-AGNOSTIC category. The two OLD detectors and
//               the NEW one all spell a missing-foreign-key finding differently
//               ("DANGLING_REF" code / graph edge.kind / a message string); they
//               all collapse to the single class `DANGLING_REF` here.
//   • file    — the bundle file the finding is anchored to (best-effort; the
//               graph detector is directory-based and doesn't know the file, so
//               its findings carry file="(bundle)"). file is NOT part of the set
//               key for DANGLING_REF (see below) precisely because the graph
//               half can't supply it — keying on it would manufacture false LOST.
//   • locator — keyed on the REFERENCED UUID (the dangling `to` uuid), NEVER on
//               message text or array index. For a dangling ref the thing that
//               uniquely identifies the problem is "which uuid is missing", and
//               both file-map and graph detectors expose that as `to`.
//
// SET-MEMBERSHIP KEY
// ------------------
// Findings are compared as a SET. The key is `class|locator` for DANGLING_REF
// (file deliberately excluded — the graph detector is directory-based and emits
// file="(bundle)", so including file would make every graph dangling-ref look
// "lost" vs the file-map detector that DOES know the file). For the two NEW-only
// classes the key includes file+locator because both are file-anchored and we
// want each distinct site reported.
//
// CODE → CLASS MAPPING (documented in README.md):
//
//   OLD  pipeline.checkIntegrityOnFileMap : code "DANGLING_REF"            → DANGLING_REF
//   OLD  graph.integrityCheck             : code "DANGLING_REF" (edge.*)   → DANGLING_REF
//   NEW  runBundleIntegrityCheck          : code "DANGLING_REF"            → DANGLING_REF
//   NEW  runBundleIntegrityCheck          : code "FE_CONCEPT_NOT_OBJECT"   → FE_CONCEPT_NOT_OBJECT (NEW-only → GAINED)
//   NEW  runBundleIntegrityCheck          : code "ALT_INVALID_NAME"        → ALT_INVALID_NAME      (NEW-only → GAINED)
//
// The 28-code validator (`bundle_validator.js`) is OUT OF SCOPE — it is KEPT, not
// consolidated. None of these three detectors emit validator codes, so nothing to
// filter, but `assertNoValidatorCodes` below makes the scope explicit and will
// throw if a validator code ever leaks into this comparison.

"use strict";

// Coarse, detector-agnostic finding classes.
const CLASS = Object.freeze({
  DANGLING_REF: "DANGLING_REF",
  FE_CONCEPT_NOT_OBJECT: "FE_CONCEPT_NOT_OBJECT",
  ALT_INVALID_NAME: "ALT_INVALID_NAME",
});

// Validator (bundle_validator.js) codes are explicitly OUT OF SCOPE for this
// gate. This list is illustrative (the validator emits ~28 codes like A1, B2,
// C3, D1, …); the point is to make the scope boundary executable, not exhaustive.
const VALIDATOR_CODE_RE = /^[A-Z][0-9]+$/; // A1, B12, C3, D1, … — validator's coded scheme

/**
 * A finding from the graph.integrityCheck DETECTOR is dangling iff edge.to is
 * unknown. Reduce it to a canonical triple. The graph is directory-based and
 * doesn't carry the originating file, so file is "(bundle)" — and is therefore
 * excluded from the DANGLING_REF set key (see header).
 */
function fromGraphIssue(issue) {
  // graph issues only ever carry code DANGLING_REF in the current brain.
  const edge = issue.edge || {};
  return {
    class: CLASS.DANGLING_REF,
    file: "(bundle)",
    locator: edge.to || "", // the referenced (missing) uuid
    // diagnostic context — NOT part of the set key
    _field: edge.field || null,
    _from: edge.from || null,
    _severity: issue.severity || null,
    _origin: "graph.integrityCheck",
  };
}

/**
 * A finding from the OLD pipeline.checkIntegrityOnFileMap detector. Its issues
 * are { severity, code:"DANGLING_REF", message, from, to, field }.
 */
function fromFileMapIssue(issue) {
  if (issue.code !== "DANGLING_REF") {
    throw new Error(
      `checkIntegrityOnFileMap emitted unexpected code ${JSON.stringify(issue.code)} — ` +
      `parity normalisation only knows DANGLING_REF for this detector.`,
    );
  }
  return {
    class: CLASS.DANGLING_REF,
    file: fileFromField(issue.field),
    locator: issue.to || "", // the referenced (missing) uuid
    _field: issue.field || null,
    _from: issue.from || null,
    _severity: issue.severity || null,
    _origin: "checkIntegrityOnFileMap",
  };
}

/**
 * A finding from the NEW runBundleIntegrityCheck detector. Its findings are
 * { code, severity, file, locator, message }. code ∈ { DANGLING_REF (reused
 * from checkIntegrityOnFileMap), FE_CONCEPT_NOT_OBJECT, ALT_INVALID_NAME }.
 */
function fromNewFinding(finding) {
  if (VALIDATOR_CODE_RE.test(String(finding.code || ""))) {
    throw new Error(
      `runBundleIntegrityCheck emitted a validator-shaped code ${JSON.stringify(finding.code)} — ` +
      `validator findings are OUT OF SCOPE for the parity gate.`,
    );
  }
  switch (finding.code) {
    case "DANGLING_REF":
      // The NEW detector's DANGLING_REF locator is "from → to"; extract the
      // referenced uuid (the `to`) so it keys identically to the OLD detectors.
      return {
        class: CLASS.DANGLING_REF,
        file: finding.file && finding.file !== "(bundle)" ? finding.file : "(bundle)",
        locator: danglingToUuid(finding),
        _field: finding.file || null,
        _from: null,
        _severity: finding.severity || null,
        _origin: "runBundleIntegrityCheck",
      };
    case "FE_CONCEPT_NOT_OBJECT":
      return {
        class: CLASS.FE_CONCEPT_NOT_OBJECT,
        file: finding.file || "(bundle)",
        locator: finding.locator || "",
        _severity: finding.severity || null,
        _origin: "runBundleIntegrityCheck",
      };
    case "ALT_INVALID_NAME":
      return {
        class: CLASS.ALT_INVALID_NAME,
        file: finding.file || "addressLevelTypes.json",
        locator: finding.locator || "",
        _severity: finding.severity || null,
        _origin: "runBundleIntegrityCheck",
      };
    default:
      throw new Error(
        `runBundleIntegrityCheck emitted unknown code ${JSON.stringify(finding.code)} — ` +
        `add a CODE→CLASS mapping in tests/corpus/parity/normalize.cjs + README.md.`,
      );
  }
}

// The NEW detector packs the dangling reference as locator = "<from> → <to>"
// (built in bundle-mcp-server.js from issue.from/issue.to). Extract the `to`
// uuid so it keys identically to the OLD file-map / graph detectors. If the
// arrow form isn't present, fall back to the whole locator string.
function danglingToUuid(finding) {
  const loc = String(finding.locator || "");
  const arrow = loc.split("→");
  if (arrow.length === 2) return arrow[1].trim();
  return loc.trim();
}

// Best-effort file attribution from a checkIntegrityOnFileMap `field` string.
// field looks like "formMapping.formUUID", "operationalProgram.program.uuid",
// "concept.answers[].uuid", or "form.formElementGroups[]...". We map the entity
// prefix back to its bundle file purely for human-readable reporting — it is NOT
// part of the DANGLING_REF set key, so an imperfect guess never causes false LOST.
function fileFromField(field) {
  const f = String(field || "");
  if (f.startsWith("formMapping.")) return "formMappings.json";
  if (f.startsWith("concept.")) return "concepts.json";
  if (f.startsWith("operationalSubjectType")) return "operationalSubjectTypes.json";
  if (f.startsWith("operationalProgram")) return "operationalPrograms.json";
  if (f.startsWith("operationalEncounterType")) return "operationalEncounterTypes.json";
  if (f.startsWith("form.")) return "forms/*.json";
  return "(bundle)";
}

// ─── set-membership key ─────────────────────────────────────────────
//
// DANGLING_REF: key on class|locator ONLY (file excluded — the graph detector
//   can't supply a file, so including it would manufacture false LOST).
// NEW-only classes: key on class|file|locator (both are file-anchored; we want
//   each distinct site to be its own member).
function keyOf(triple) {
  if (triple.class === CLASS.DANGLING_REF) {
    return `${triple.class}|${triple.locator}`;
  }
  return `${triple.class}|${triple.file}|${triple.locator}`;
}

// Reduce an array of normalised triples to a Map<key, triple> (dedup on key).
function toSet(triples) {
  const m = new Map();
  for (const t of triples) {
    const k = keyOf(t);
    if (!m.has(k)) m.set(k, t);
  }
  return m;
}

/** A \ B by set key. Returns the triples in A whose key is absent from B. */
function diff(aMap, bMap) {
  const out = [];
  for (const [k, t] of aMap) if (!bMap.has(k)) out.push(t);
  return out;
}

// Defensive: assert no validator-coded findings ever reach this comparison.
function assertNoValidatorCodes(rawFindings, label) {
  for (const f of rawFindings || []) {
    const code = String(f.code || "");
    if (VALIDATOR_CODE_RE.test(code)) {
      throw new Error(
        `${label}: validator code ${JSON.stringify(code)} leaked into the parity comparison — ` +
        `the validator (bundle_validator.js) is KEPT and OUT OF SCOPE for this gate.`,
      );
    }
  }
}

module.exports = {
  CLASS,
  VALIDATOR_CODE_RE,
  fromGraphIssue,
  fromFileMapIssue,
  fromNewFinding,
  fileFromField,
  danglingToUuid,
  keyOf,
  toSet,
  diff,
  assertNoValidatorCodes,
};
