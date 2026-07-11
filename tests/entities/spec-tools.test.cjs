// spec-tools.test.cjs — the spec_apply / spec_emit MCP tools (story #11 part B)
//
// These tools wrap the pipeline's applySpec / emitSpec as in-process MCP tools.
// We test the pure pipeline functions (emitSpec + bundleToEntities) AND the
// tool-level dir handlers (specApplyOnDir / specEmitOnDir), plus the frozen
// tool-name contract. Synthetic in-memory fixtures only (CLAUDE.md rule §1).
//
// No API key, no LLM — these are deterministic unit tests of the tool logic.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ESM modules — dynamic-import from CJS. Cache-bust so a stale copy never leaks
// between files (mirrors spec-integration.test.cjs).
async function loadPipeline() {
  return import("../../src/pipeline.js?t=" + Date.now());
}
async function loadMcp() {
  return import("../../src/agents/bundle-mcp-server.js?t=" + Date.now());
}
async function loadNames() {
  return import("../../src/agents/bundle-mcp-tool-names.js?t=" + Date.now());
}

// A representative multi-entity spec: a subject type + registration form, a
// program + enrolment form, and a program encounter + form.
const SEED_SPEC = `
org: RoundTripOrg
subjectTypes:
  - name: Beneficiary
    type: Person
    registrationForm:
      sections:
        - name: Identity
          fields:
            - {name: Full Name, dataType: Text, mandatory: true}
            - {name: Age, dataType: Numeric, min: 0, max: 120}
programs:
  - name: ANC
    targetSubjectType: Beneficiary
    enrolmentForm:
      sections:
        - {name: Enroll, fields: [{name: LMP, dataType: Date}]}
encounterTypes:
  - name: ANC Visit
    program: ANC
    subjectType: Beneficiary
    form:
      sections:
        - {name: Visit, fields: [{name: BP, dataType: Numeric, unit: mmHg}]}
`;

function writeBundleToDir(fileMap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-tools-"));
  for (const [rel, val] of Object.entries(fileMap)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
  return dir;
}

// ─── frozen tool-name contract ──────────────────────────────────────

test("frozen names: original 5 unchanged + spec_apply/spec_emit appended", async () => {
  const { BUNDLE_TOOL_NAME, BUNDLE_TOOL_NAMES } = await loadNames();

  // The original five names must be byte-identical (transcripts/audits depend
  // on them — see the rename-warning rationale in the module header).
  assert.equal(BUNDLE_TOOL_NAME.VALIDATOR_RUN, "mcp__avni-bundle__bundle_validator_run");
  assert.equal(BUNDLE_TOOL_NAME.FIND_CONCEPT, "mcp__avni-bundle__bundle_find_concept");
  assert.equal(BUNDLE_TOOL_NAME.SUMMARY, "mcp__avni-bundle__bundle_summary");
  assert.equal(BUNDLE_TOOL_NAME.EXPORT_TO_PATH, "mcp__avni-bundle__bundle_export_to_path");
  assert.equal(BUNDLE_TOOL_NAME.INTEGRITY_CHECK, "mcp__avni-bundle__bundle_integrity_check");

  // The two names appended in story #11 (part B).
  assert.equal(BUNDLE_TOOL_NAME.SPEC_APPLY, "mcp__avni-bundle__spec_apply");
  assert.equal(BUNDLE_TOOL_NAME.SPEC_EMIT, "mcp__avni-bundle__spec_emit");

  // The two names appended in story #12 (agent author mode).
  assert.equal(BUNDLE_TOOL_NAME.READ_SRS, "mcp__avni-bundle__bundle_read_srs");
  assert.equal(BUNDLE_TOOL_NAME.GENERATE_BASELINE, "mcp__avni-bundle__bundle_generate_baseline");

  // The name appended in story #13 (tool promotion: find-references).
  assert.equal(BUNDLE_TOOL_NAME.FIND_REFERENCES, "mcp__avni-bundle__bundle_find_references");

  // The list form: exactly 13, in order, the first 5 unchanged (Phase 4
  // appended bundle_review / bundle_scrub / spec_review — CRL edit-loop wiring).
  assert.deepEqual(BUNDLE_TOOL_NAMES, [
    "mcp__avni-bundle__bundle_validator_run",
    "mcp__avni-bundle__bundle_find_concept",
    "mcp__avni-bundle__bundle_summary",
    "mcp__avni-bundle__bundle_export_to_path",
    "mcp__avni-bundle__bundle_integrity_check",
    "mcp__avni-bundle__spec_apply",
    "mcp__avni-bundle__spec_emit",
    "mcp__avni-bundle__bundle_read_srs",
    "mcp__avni-bundle__bundle_generate_baseline",
    "mcp__avni-bundle__bundle_find_references",
    "mcp__avni-bundle__bundle_review",
    "mcp__avni-bundle__bundle_scrub",
    "mcp__avni-bundle__spec_review",
  ]);

  // Still frozen — a stray mutation must throw, not silently corrupt logs.
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAME));
  assert.ok(Object.isFrozen(BUNDLE_TOOL_NAMES));
});

test("createBundleMcpServer registers spec_apply + spec_emit alongside the original 5", async () => {
  const { createBundleMcpServer } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-tools-srv-"));
  const server = createBundleMcpServer(dir);
  // The SDK's createSdkMcpServer stores tools on the low-level MCP instance
  // under `_registeredTools` (a name→def map).
  const registered = server?.instance?._registeredTools || {};
  const names = Object.keys(registered);
  assert.ok(names.length > 0, "no tools registered on the MCP instance");
  // Must contain the two new tools (bare names, as registered via tool()).
  assert.ok(names.includes("spec_apply"), `spec_apply not registered; saw: ${names.join(", ")}`);
  assert.ok(names.includes("spec_emit"), `spec_emit not registered; saw: ${names.join(", ")}`);
  // And still expose the original five.
  for (const n of ["bundle_validator_run", "bundle_find_concept", "bundle_summary", "bundle_export_to_path", "bundle_integrity_check"]) {
    assert.ok(names.includes(n), `original tool ${n} missing; saw: ${names.join(", ")}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── emitSpec (pipeline) ────────────────────────────────────────────

test("emitSpec: emits a spec from a bundle file map (names the entities)", async () => {
  const { applySpec, emitSpec } = await loadPipeline();
  const built = applySpec({ existingBundleFiles: {}, specYaml: SEED_SPEC });
  const spec = emitSpec({ existingBundleFiles: built.patchedFiles, org: "RoundTripOrg" });
  assert.equal(typeof spec, "string");
  assert.ok(spec.length > 0);
  assert.match(spec, /org: RoundTripOrg/);
  assert.match(spec, /Beneficiary/);
  assert.match(spec, /ANC/);
  assert.match(spec, /ANC Visit/);
  // The registration/enrolment/encounter forms round-tripped into the spec.
  assert.match(spec, /registrationForm:/);
  assert.match(spec, /enrolmentForm:/);
});

test("emitSpec: throws without a bundle source", async () => {
  const { emitSpec } = await loadPipeline();
  assert.throws(() => emitSpec({}), /existingBundleFiles or existingBundleZip required/);
});

test("bundleToEntities: reconstructs top-level entities + derives program target from enrolment form", async () => {
  const { applySpec, bundleToEntities } = await loadPipeline();
  const built = applySpec({ existingBundleFiles: {}, specYaml: SEED_SPEC });
  const entities = bundleToEntities(built.patchedFiles);
  assert.equal(entities.subject_types.length, 1);
  assert.equal(entities.subject_types[0].name, "Beneficiary");
  assert.equal(entities.programs.length, 1);
  assert.equal(entities.programs[0].name, "ANC");
  assert.equal(entities.programs[0].target_subject_type, "Beneficiary");
  const enc = entities.encounter_types[0];
  assert.equal(enc.name, "ANC Visit");
  assert.equal(enc.program_name, "ANC");
  assert.equal(enc.is_program_encounter, true);
});

// ─── round-trip (pipeline): emit → apply is a clean no-op ────────────

test("round-trip: applying an emitted spec adds ZERO entities and stays integrity-clean", async () => {
  const { applySpec, emitSpec } = await loadPipeline();
  const built = applySpec({ existingBundleFiles: {}, specYaml: SEED_SPEC });
  const emitted = emitSpec({ existingBundleFiles: built.patchedFiles, org: "RoundTripOrg" });

  const reapplied = applySpec({ existingBundleFiles: built.patchedFiles, specYaml: emitted });
  const addedCount = Object.values(reapplied.diff).reduce(
    (n, ops) => n + (ops.added?.length || 0), 0,
  );
  assert.equal(addedCount, 0, `round-trip created entities: ${JSON.stringify(reapplied.diff)}`);
  // The graph-based integrity check stays clean (name-resolved form concepts
  // emit no dangling FK edge).
  assert.equal(reapplied.integrity.ok, true);
});

// ─── tool-level handlers (dir I/O) ──────────────────────────────────

test("specEmitOnDir: returns the spec YAML as a non-error tool result", async () => {
  const { applySpec } = await loadPipeline();
  const { specEmitOnDir } = await loadMcp();
  const built = applySpec({ existingBundleFiles: {}, specYaml: SEED_SPEC });
  const dir = writeBundleToDir(built.patchedFiles);
  try {
    const res = specEmitOnDir(dir);
    assert.ok(!res.isError, `unexpected isError: ${res.content?.[0]?.text}`);
    const yaml = res.content[0].text;
    assert.match(yaml, /subjectTypes:/);
    assert.match(yaml, /Beneficiary/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("specApplyOnDir: applying the emitted spec round-trips (no new subjectTypes, no throw)", async () => {
  const { applySpec } = await loadPipeline();
  const { specEmitOnDir, specApplyOnDir } = await loadMcp();
  // A forms-free bundle keeps the round-trip byte-clean (no name-resolved form
  // concepts to flag) so we can assert the no-op precisely.
  const seed = "subjectTypes:\n  - {name: Beneficiary, type: Person}\nprograms:\n  - {name: ANC, targetSubjectType: Beneficiary}\n";
  const built = applySpec({ existingBundleFiles: {}, specYaml: seed });
  const dir = writeBundleToDir(built.patchedFiles);
  try {
    const stBefore = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8")).length;

    const emit = specEmitOnDir(dir);
    assert.ok(!emit.isError);
    const yaml = emit.content[0].text;

    const apply = specApplyOnDir(dir, yaml);
    assert.ok(!apply.isError, `unexpected isError: ${apply.content?.[0]?.text}`);
    const parsed = JSON.parse(apply.content[0].text);
    assert.deepEqual(parsed.filesChanged, [], "round-trip should change nothing");

    const stAfter = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8")).length;
    assert.equal(stAfter, stBefore, "round-trip must not duplicate subject types");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("specApplyOnDir: a valid spec that adds an entity persists to disk + reports integrity", async () => {
  const { applySpec } = await loadPipeline();
  const { specApplyOnDir } = await loadMcp();
  const built = applySpec({ existingBundleFiles: {}, specYaml: "subjectTypes:\n  - {name: Beneficiary, type: Person}\n" });
  const dir = writeBundleToDir(built.patchedFiles);
  try {
    const res = specApplyOnDir(dir, "subjectTypes:\n  - {name: Household, type: Group, group: true}\n");
    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.ok(parsed.filesChanged.includes("subjectTypes.json"));
    // integrityCheck summary is present (bundle_integrity_check ran AFTER apply).
    assert.ok(parsed.integrityCheck && typeof parsed.integrityCheck === "object");
    const names = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8")).map((s) => s.name);
    assert.ok(names.includes("Household"), `Household not persisted; have: ${names.join(", ")}`);
    assert.ok(names.includes("Beneficiary"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── bad-input handling: actionable error, never a thrown loop ───────

test("specApplyOnDir: a non-mapping spec returns an actionable error (no throw)", async () => {
  const { applySpec } = await loadPipeline();
  const { specApplyOnDir } = await loadMcp();
  const built = applySpec({ existingBundleFiles: {}, specYaml: "subjectTypes:\n  - {name: X, type: Person}\n" });
  const dir = writeBundleToDir(built.patchedFiles);
  try {
    // A YAML list is valid YAML but not a spec mapping — parser rejects it.
    const res = specApplyOnDir(dir, "- a\n- b\n- c\n");
    assert.ok(res.isError, "expected isError for a non-mapping spec");
    assert.match(res.content[0].text, /spec_apply could not apply the spec/);
    assert.match(res.content[0].text, /Fix the spec/);
    // Nothing should have been mutated on disk.
    const st = JSON.parse(fs.readFileSync(path.join(dir, "subjectTypes.json"), "utf8"));
    assert.equal(st.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("specApplyOnDir: empty/blank spec returns an actionable error (no throw)", async () => {
  const { specApplyOnDir } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-tools-empty-"));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), "[]");
  try {
    const res = specApplyOnDir(dir, "   ");
    assert.ok(res.isError);
    assert.match(res.content[0].text, /spec is required/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("specEmitOnDir: emitting an empty bundle does not throw (returns a skeleton spec)", async () => {
  const { specEmitOnDir } = await loadMcp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-tools-mt-"));
  try {
    const res = specEmitOnDir(dir);
    assert.ok(!res.isError, `unexpected isError: ${res.content?.[0]?.text}`);
    // Emitter applies defaults (org + groups) even for an empty bundle.
    assert.match(res.content[0].text, /groups:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Task 15 — the ONE rich emitter is now the production path (M5) ──
// pipeline.bundleToEntities/emitSpec AND the MCP specEmitOnDir/specReviewOnDir
// all feed the rich spec-view emitter. The old 6-family adapter never surfaced
// ancillary families (reportCards, identifierSources, …); the thin 13-file
// readBundleFileMap never even read reportCard.json off disk.

test("emitSpec: now surfaces reportCards (rich emitter wired in, not the old 6-family adapter)", async () => {
  const { emitSpec } = await loadPipeline();
  const spec = emitSpec({ existingBundleFiles: {
    "subjectTypes.json": [{ uuid: "s1", name: "X" }],
    "reportCard.json": [{ uuid: "r1", name: "Total Population", color: "#eee" }],
  }, org: "T" });
  assert.match(spec, /reportCards:/);
  assert.match(spec, /Total Population/);
});

test("specEmitOnDir: surfaces an ancillary family from disk (rich map, not the private 13-file whitelist)", async () => {
  const { applySpec } = await loadPipeline();
  const { specEmitOnDir } = await loadMcp();
  const built = applySpec({ existingBundleFiles: {}, specYaml: "subjectTypes:\n  - {name: X, type: Person}\n" });
  const dir = writeBundleToDir(built.patchedFiles);
  fs.writeFileSync(path.join(dir, "reportCard.json"), JSON.stringify([{ uuid: "r1", name: "Total Population", color: "#eee" }]));
  try {
    const res = specEmitOnDir(dir);
    assert.ok(!res.isError, `unexpected isError: ${res.content?.[0]?.text}`);
    assert.match(res.content[0].text, /reportCards:/);
    assert.match(res.content[0].text, /Total Population/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
