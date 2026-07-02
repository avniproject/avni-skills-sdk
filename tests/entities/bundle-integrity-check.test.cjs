// Tests for the in-process MCP `bundle_integrity_check` tool's core logic
// (src/agents/bundle-mcp-server.js → runBundleIntegrityCheck).
//
// The tool closes two detection gaps that slipped past BOTH the local
// validator AND the model, on two real shipped incidents:
//   • Durga   → FE_CONCEPT_NOT_OBJECT (formElement.concept flattened to a UUID
//               string; AVNI server Jackson-crashes on deserialize)
//   • Astitva → ALT_INVALID_NAME (addressLevelType name empty or containing
//               < > = " '; AVNI LocationService rejects it on upload)
//
// Synthetic fixtures only (CLAUDE.md §1) — no real org data.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

async function loadServer() {
  return await import("../../src/agents/bundle-mcp-server.js?t=" + Date.now());
}

// Write a synthetic bundle to a temp dir. Only the keys provided are written.
function tmpBundle({
  concepts = [],
  forms = [],
  subjectTypes = [],
  programs = [],
  encounterTypes = [],
  formMappings = [],
  addressLevelTypes = [],
  groupRoles = [],
} = {}) {
  const dir = path.join(os.tmpdir(), "integrity-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs));
  fs.writeFileSync(path.join(dir, "encounterTypes.json"), JSON.stringify(encounterTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
  fs.writeFileSync(path.join(dir, "addressLevelTypes.json"), JSON.stringify(addressLevelTypes));
  fs.writeFileSync(path.join(dir, "groupRoles.json"), JSON.stringify(groupRoles));
  for (const f of forms) fs.writeFileSync(path.join(dir, "forms", `${f.name}.json`), JSON.stringify(f));
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

const UUID = "11111111-1111-1111-1111-111111111111";

// ─── FE_CONCEPT_NOT_OBJECT (Durga) ──────────────────────────────────

test("flags a formElement whose concept was flattened to a bare UUID string", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: UUID }] }],
    }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const fe = findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT");
  assert.equal(fe.length, 1, "exactly one FE_CONCEPT_NOT_OBJECT finding");
  assert.equal(fe[0].severity, "error");
  assert.equal(fe[0].file, "forms/F.json");
  assert.match(fe[0].locator, /age-el/);
  assert.equal(ok, false, "an error-severity finding makes ok=false");
  cleanup(dir);
});

test("does NOT flag a formElement whose concept is a proper nested object", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        { name: "age-el", concept: { name: "Age", uuid: UUID, dataType: "Numeric", answers: [], media: [] } },
      ] }],
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  assert.equal(findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT").length, 0);
  cleanup(dir);
});

// The avni-server's FormElementContract.validate() rejects MORE shapes than a
// bare string. Server-reject parity: null / missing / non-object / uuid-less
// concepts all crash the upload, so the SHAPE check must flag them all.

test("flags a null concept (server: Concept UUID Not Provided)", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "null-el", concept: null }] }],
    }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const fe = findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT");
  assert.equal(fe.length, 1, "exactly one FE_CONCEPT_NOT_OBJECT finding for null concept");
  assert.equal(fe[0].severity, "error");
  assert.match(fe[0].locator, /null-el/);
  assert.match(fe[0].message, /missing\/null/, "message names the missing/null shape");
  assert.equal(ok, false);
  cleanup(dir);
});

test("flags a formElement that is MISSING the concept key entirely", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      // No `concept` key at all (undefined) — same server reject as null.
      formElementGroups: [{ formElements: [{ name: "no-concept-key" }] }],
    }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const fe = findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT");
  assert.equal(fe.length, 1, "missing concept key is flagged");
  assert.match(fe[0].locator, /no-concept-key/);
  assert.match(fe[0].message, /missing\/null/);
  assert.equal(ok, false);
  cleanup(dir);
});

test("flags a concept object that has no uuid (concept: {})", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        { name: "uuidless-el", concept: { name: "Age", dataType: "Numeric" } }, // object, but no uuid
      ] }],
    }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const fe = findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT");
  assert.equal(fe.length, 1, "uuid-less concept object is flagged");
  assert.match(fe[0].locator, /uuidless-el/);
  assert.match(fe[0].message, /no uuid/i, "message names the no-uuid shape");
  assert.equal(ok, false);
  cleanup(dir);
});

test("flags a concept whose uuid is an empty / whitespace string", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        { name: "blank-uuid-el", concept: { name: "Age", uuid: "   ", dataType: "Numeric" } },
      ] }],
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const fe = findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT");
  assert.equal(fe.length, 1, "blank-uuid concept object is flagged");
  assert.match(fe[0].message, /no uuid/i);
  cleanup(dir);
});

test("flags a non-object scalar concept (number)", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "num-el", concept: 42 }] }],
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const fe = findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT");
  assert.equal(fe.length, 1, "numeric concept is flagged");
  assert.match(fe[0].message, /number/, "message names the scalar type");
  cleanup(dir);
});

test("does NOT throw on a form missing formElementGroups", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{ name: "F", uuid: "fff", formType: "IndividualProfile" }], // no formElementGroups
  });
  // The whole point: traversal must be defensive, not crash.
  const { ok, findings } = runBundleIntegrityCheck(dir);
  assert.equal(findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT").length, 0);
  assert.equal(ok, true);
  cleanup(dir);
});

test("does NOT flag a well-shaped {uuid} concept even when that uuid is DANGLING (shape check stays silent; only the FK check speaks)", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const DANGLING = "99999999-9999-9999-9999-999999999999";
  const dir = tmpBundle({
    // concepts.json deliberately does NOT contain DANGLING — the uuid is dangling.
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        // A perfectly well-SHAPED concept object whose uuid is not in concepts.json.
        { name: "dangle-el", concept: { name: "Ghost", uuid: DANGLING, dataType: "Numeric", answers: [], media: [] } },
      ] }],
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  // SHAPE check: silent — the object is well-formed.
  assert.equal(
    findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT").length, 0,
    "a well-shaped concept object is NOT a shape violation even if its uuid dangles",
  );
  // The FK check is the one that may speak about the dangling uuid (separate job).
  // We do not assert it MUST fire (FK coverage of FE concepts is the FK check's
  // concern); we only assert the SHAPE check did not false-positive.
  cleanup(dir);
});

// ─── ALT_INVALID_NAME (Astitva) ─────────────────────────────────────

test("flags an addressLevelType named like a Google-Drive URL", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    // A name copied straight from an SRS hierarchy diagram — a Drive share link.
    addressLevelTypes: [
      { name: "State", uuid: "alt-1", level: 2 },
      { name: 'https://drive.google.com/file/d/abc?usp="sharing"', uuid: "alt-2", level: 1 },
    ],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const alt = findings.filter((f) => f.code === "ALT_INVALID_NAME");
  assert.equal(alt.length, 1, "exactly one ALT_INVALID_NAME finding");
  assert.equal(alt[0].severity, "error");
  assert.equal(alt[0].file, "addressLevelTypes.json");
  assert.equal(alt[0].locator, "[1].name");
  assert.equal(ok, false);
  cleanup(dir);
});

test("flags empty and angle/quote-bearing addressLevelType names", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    addressLevelTypes: [
      { name: "", uuid: "a1", level: 3 },                 // empty
      { name: "<District>", uuid: "a2", level: 2 },        // angle brackets
      { name: "Level='Block'", uuid: "a3", level: 1 },     // = and quote
      { name: "Village", uuid: "a4", level: 0 },           // clean
    ],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const alt = findings.filter((f) => f.code === "ALT_INVALID_NAME");
  assert.equal(alt.length, 3, "three invalid names, one clean");
  assert.ok(alt.every((f) => f.severity === "error"));
  cleanup(dir);
});

// ─── clean bundle → no NEW findings ─────────────────────────────────

test("a clean bundle produces no FE_CONCEPT_NOT_OBJECT / ALT_INVALID_NAME findings", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [
        { name: "age-el", concept: { name: "Age", uuid: UUID, dataType: "Numeric", answers: [], media: [] } },
      ] }],
    }],
    addressLevelTypes: [{ name: "State", uuid: "alt-1", level: 1 }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  assert.equal(findings.filter((f) => f.code === "FE_CONCEPT_NOT_OBJECT").length, 0);
  assert.equal(findings.filter((f) => f.code === "ALT_INVALID_NAME").length, 0);
  assert.equal(ok, true, "fully clean bundle is ok");
  cleanup(dir);
});

// ─── ALT_INVALID_NAME survives a wrapped addressLevelTypes shape (F6) ──
//
// The generator emits a bare array, but server-round-tripped / hand-edited
// bundles can wrap it ({ addressLevelTypes: [...] } or { data: [...] }). The ALT
// check used to run only for a bare Array, so a wrapped list silently skipped —
// a false-clean. The normalisation must catch invalid names inside either wrapper.

test("ALT_INVALID_NAME — wrapped { addressLevelTypes: [...] } shape is still checked", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    // Passed straight to JSON.stringify by tmpBundle → writes the wrapped object.
    addressLevelTypes: {
      addressLevelTypes: [
        { name: "State", uuid: "alt-1", level: 2 },
        { name: "<District>", uuid: "alt-2", level: 1 }, // invalid: angle brackets
      ],
    },
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const alt = findings.filter((f) => f.code === "ALT_INVALID_NAME");
  assert.equal(alt.length, 1, "wrapped shape must not silently skip the ALT check");
  assert.equal(alt[0].severity, "error");
  assert.equal(alt[0].locator, "[1].name");
  assert.equal(ok, false);
  cleanup(dir);
});

test("ALT_INVALID_NAME — generic { data: [...] } envelope is still checked", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    addressLevelTypes: { data: [{ name: "Level='Block'", uuid: "b1", level: 1 }] },
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  assert.equal(findings.filter((f) => f.code === "ALT_INVALID_NAME").length, 1);
  assert.equal(ok, false);
  cleanup(dir);
});

test("ALT_INVALID_NAME — wrapped shape with only clean names produces no finding", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    addressLevelTypes: { addressLevelTypes: [{ name: "State", uuid: "s1", level: 1 }] },
  });
  const { findings } = runBundleIntegrityCheck(dir);
  assert.equal(findings.filter((f) => f.code === "ALT_INVALID_NAME").length, 0);
  cleanup(dir);
});

// ─── FK / dangling-reference via the brain's yaml-driven graph ──────
//
// #14 (slice 2): the tool now drives FK integrity off the brain's
// buildBundleGraph + integrityCheck (yaml-driven, single source of truth).
// A dangling REQUIRED edge is MISSING_REQUIRED_REF (error); a dangling OPTIONAL
// edge is DANGLING_REF (warning). The dangling formMapping.formUUID edge is
// REQUIRED, so it surfaces as MISSING_REQUIRED_REF (was DANGLING_REF under the
// old local checker — the code rename is the brain's, not a behaviour change).

test("FK graph — dangling formMapping.formUUID is reported as MISSING_REQUIRED_REF (error)", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Person", uuid: "st-1" }],
    formMappings: [{
      uuid: "map-1", formType: "IndividualProfile",
      formUUID: "GHOST-FORM-UUID", subjectTypeUUID: "st-1",
    }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const missing = findings.filter((f) => f.code === "MISSING_REQUIRED_REF");
  assert.ok(missing.length >= 1, "dangling required formUUID reported");
  assert.ok(missing.some((f) => /formUUID/.test(f.file)), "the finding names the formUUID field");
  assert.ok(missing.every((f) => f.severity === "error"), "MISSING_REQUIRED_REF is error severity");
  assert.equal(ok, false);
  cleanup(dir);
});

// ─── #14 slice 2: the 5 previously-graph-only edge kinds ────────────
//
// These FK edges live ONLY in the brain's yaml-driven graph — the SDK's old
// local checkIntegrityOnFileMap never walked them, so a dangling ref slipped
// through. Each test below proves bundle_integrity_check now flags them.

test("graph-only #1: dangling encounterType.conceptUuid (optional) → DANGLING_REF warning", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    // The encounterType's display concept points at a uuid not in concepts.json.
    encounterTypes: [{ name: "ANC Visit", uuid: "enc-1", conceptUuid: "GHOST-CONCEPT" }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const hit = findings.filter((f) => /encounterType\.conceptUuid/.test(f.file));
  assert.equal(hit.length, 1, "exactly one encounterType.conceptUuid finding");
  assert.equal(hit[0].code, "DANGLING_REF", "optional edge → DANGLING_REF");
  assert.equal(hit[0].severity, "warning");
  assert.match(hit[0].locator, /GHOST-CONCEPT/);
  cleanup(dir);
});

test("graph-only #2: dangling form.decisionConcepts[].uuid (optional) → DANGLING_REF warning", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    forms: [{
      name: "F", uuid: "form-1", formType: "IndividualProfile",
      formElementGroups: [],
      // A decision concept M:M ref to a uuid absent from concepts.json.
      decisionConcepts: [{ uuid: "GHOST-DECISION-CONCEPT", name: "Risk" }],
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const hit = findings.filter((f) => /decisionConcepts/.test(f.file));
  assert.equal(hit.length, 1, "exactly one decisionConcepts finding");
  assert.equal(hit[0].code, "DANGLING_REF", "optional edge → DANGLING_REF");
  assert.equal(hit[0].severity, "warning");
  assert.match(hit[0].locator, /GHOST-DECISION-CONCEPT/);
  cleanup(dir);
});

test("graph-only #3: dangling addressLevelType.parentUuid (optional) → DANGLING_REF warning", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    addressLevelTypes: [
      // A child level whose parent uuid is not present among the levels.
      { name: "Block", uuid: "alt-child", level: 1, parentUuid: "GHOST-PARENT" },
    ],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const hit = findings.filter((f) => /addressLevelType\.parentUuid/.test(f.file));
  assert.equal(hit.length, 1, "exactly one parentUuid finding");
  assert.equal(hit[0].code, "DANGLING_REF", "optional edge → DANGLING_REF");
  assert.equal(hit[0].severity, "warning");
  assert.match(hit[0].locator, /GHOST-PARENT/);
  cleanup(dir);
});

test("graph-only #4: dangling groupRole.*SubjectTypeUUID (required) → MISSING_REQUIRED_REF error", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Household", uuid: "st-group" }],
    // memberSubjectTypeUUID points at a subjectType not in the bundle.
    groupRoles: [{
      uuid: "gr-1", role: "Member",
      groupSubjectTypeUUID: "st-group",
      memberSubjectTypeUUID: "GHOST-SUBJECT-TYPE",
    }],
  });
  const { ok, findings } = runBundleIntegrityCheck(dir);
  const hit = findings.filter((f) => /groupRole\.memberSubjectTypeUUID/.test(f.file));
  assert.equal(hit.length, 1, "exactly one groupRole.memberSubjectTypeUUID finding");
  assert.equal(hit[0].code, "MISSING_REQUIRED_REF", "required edge → MISSING_REQUIRED_REF");
  assert.equal(hit[0].severity, "error");
  assert.match(hit[0].locator, /GHOST-SUBJECT-TYPE/);
  assert.equal(ok, false, "a required dangling ref makes ok=false");
  cleanup(dir);
});

test("graph-only #5: dangling formMapping.taskTypeUUID (optional) → DANGLING_REF warning", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Person", uuid: "st-1" }],
    forms: [{ name: "F", uuid: "form-1", formType: "IndividualProfile", formElementGroups: [] }],
    formMappings: [{
      uuid: "map-1", formType: "IndividualProfile",
      formUUID: "form-1", subjectTypeUUID: "st-1",
      // taskType is not noded by the graph yet, so any taskTypeUUID dangles —
      // here it is explicitly absent from the bundle.
      taskTypeUUID: "GHOST-TASK-TYPE",
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const hit = findings.filter((f) => /formMapping\.taskTypeUUID/.test(f.file));
  assert.equal(hit.length, 1, "exactly one formMapping.taskTypeUUID finding");
  assert.equal(hit[0].code, "DANGLING_REF", "optional edge → DANGLING_REF");
  assert.equal(hit[0].severity, "warning");
  assert.match(hit[0].locator, /GHOST-TASK-TYPE/);
  cleanup(dir);
});

// One explicit assertion contrasting the two severities side by side: a
// required-edge dangling ref is MISSING_REQUIRED_REF (error) and an optional
// one is DANGLING_REF (warning), in the SAME bundle.
test("required dangling ref ⇒ MISSING_REQUIRED_REF(error), optional ⇒ DANGLING_REF(warning)", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    subjectTypes: [{ name: "Person", uuid: "st-1" }],
    encounterTypes: [{ name: "Visit", uuid: "enc-1", conceptUuid: "GHOST-CONCEPT" }], // optional → warning
    formMappings: [{
      uuid: "map-1", formType: "IndividualProfile",
      formUUID: "GHOST-FORM", subjectTypeUUID: "st-1",                                 // required → error
    }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  const req = findings.find((f) => /formMapping\.formUUID/.test(f.file));
  const opt = findings.find((f) => /encounterType\.conceptUuid/.test(f.file));
  assert.ok(req, "required dangling formUUID present");
  assert.equal(req.code, "MISSING_REQUIRED_REF");
  assert.equal(req.severity, "error");
  assert.ok(opt, "optional dangling conceptUuid present");
  assert.equal(opt.code, "DANGLING_REF");
  assert.equal(opt.severity, "warning");
  cleanup(dir);
});

// ─── structured finding shape ───────────────────────────────────────

test("every finding has the {code, severity, file, locator, message} shape", async () => {
  const { runBundleIntegrityCheck } = await loadServer();
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: UUID, dataType: "Numeric" }],
    forms: [{
      name: "F", uuid: "fff", formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: UUID }] }],
    }],
    addressLevelTypes: [{ name: "<bad>", uuid: "alt-1", level: 1 }],
  });
  const { findings } = runBundleIntegrityCheck(dir);
  assert.ok(findings.length >= 2);
  for (const f of findings) {
    assert.equal(typeof f.code, "string");
    assert.ok(f.severity === "error" || f.severity === "warning");
    assert.equal(typeof f.file, "string");
    assert.equal(typeof f.locator, "string");
    assert.equal(typeof f.message, "string");
  }
  cleanup(dir);
});

// ─── frozen tool names: append-only, originals byte-identical ───────

test("frozen tool-name file still carries the original names unchanged + appends the new ones", async () => {
  const { BUNDLE_TOOL_NAME, BUNDLE_TOOL_NAMES } = await import("../../src/agents/bundle-mcp-tool-names.js?t=" + Date.now());
  // The original names must be byte-identical (CLAUDE.md §7).
  assert.equal(BUNDLE_TOOL_NAME.VALIDATOR_RUN, "mcp__avni-bundle__bundle_validator_run");
  assert.equal(BUNDLE_TOOL_NAME.FIND_CONCEPT, "mcp__avni-bundle__bundle_find_concept");
  assert.equal(BUNDLE_TOOL_NAME.SUMMARY, "mcp__avni-bundle__bundle_summary");
  assert.equal(BUNDLE_TOOL_NAME.EXPORT_TO_PATH, "mcp__avni-bundle__bundle_export_to_path");
  assert.equal(BUNDLE_TOOL_NAME.INTEGRITY_CHECK, "mcp__avni-bundle__bundle_integrity_check");
  // The spec round-trip names appended in story #11 (part B).
  assert.equal(BUNDLE_TOOL_NAME.SPEC_APPLY, "mcp__avni-bundle__spec_apply");
  assert.equal(BUNDLE_TOOL_NAME.SPEC_EMIT, "mcp__avni-bundle__spec_emit");
  // The author-mode names appended in story #12.
  assert.equal(BUNDLE_TOOL_NAME.READ_SRS, "mcp__avni-bundle__read_srs");
  assert.equal(BUNDLE_TOOL_NAME.GENERATE_BASELINE, "mcp__avni-bundle__generate_baseline");
  // Appended in story #13 (tool promotion).
  assert.equal(BUNDLE_TOOL_NAME.FIND_REFERENCES, "mcp__avni-bundle__bundle_find_references");
  // The list preserves the originals in order, then the appended ones.
  assert.deepEqual(BUNDLE_TOOL_NAMES, [
    "mcp__avni-bundle__bundle_validator_run",
    "mcp__avni-bundle__bundle_find_concept",
    "mcp__avni-bundle__bundle_summary",
    "mcp__avni-bundle__bundle_export_to_path",
    "mcp__avni-bundle__bundle_integrity_check",
    "mcp__avni-bundle__spec_apply",
    "mcp__avni-bundle__spec_emit",
    "mcp__avni-bundle__read_srs",
    "mcp__avni-bundle__generate_baseline",
    "mcp__avni-bundle__bundle_find_references",
  ]);
  // Still frozen.
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAME));
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAMES));
});

// ─── the MCP server factory registers the tool ─────────────────────

test("createBundleMcpServer wires the integrity tool into the avni-bundle server", async () => {
  const { createBundleMcpServer } = await loadServer();
  const dir = tmpBundle({});
  const server = createBundleMcpServer(dir);
  assert.ok(server, "factory returns a server");
  cleanup(dir);
});
