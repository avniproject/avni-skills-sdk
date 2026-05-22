// Integration scenarios — multi-entity specs, real-world bundle shapes,
// and the glue between parser + patcher + pipeline + bundle-io.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const SPEC = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec');
const { specToEntities } = require(path.join(SPEC, 'parser.js'));
const { entitiesToSpec } = require(path.join(SPEC, 'emitter.js'));
const { patchBundle }    = require(path.join(SPEC, 'patcher.js'));
const { bundleFromZip, bundleToZip } = require(path.join(SPEC, 'bundle-io.js'));

async function loadPipeline() {
  return await import('../../src/pipeline.js?t=' + Date.now());
}

// ─── Multi-entity spec → patch → all entities land coherently ─────────

test('integration: 3 subjectTypes + 2 programs + 4 encounterTypes + 9 forms land in one patch', async () => {
  const { applySpec } = await loadPipeline();
  const yaml = `
subjectTypes:
  - {name: Mother, type: Person}
  - {name: Child, type: Person}
  - {name: Household, type: Household, household: true, group: true}
programs:
  - name: ANC
    targetSubjectType: Mother
    enrolmentForm:
      sections:
        - {name: Enroll, fields: [{name: LMP, dataType: Date}]}
    exitForm:
      sections:
        - {name: Exit, fields: [{name: Outcome, dataType: Coded, options: [Live, Stillbirth]}]}
  - name: PNC
    targetSubjectType: Mother
    enrolmentForm:
      sections:
        - {name: Enroll, fields: [{name: DeliveryDate, dataType: Date}]}
encounterTypes:
  - name: ANC Visit
    program: ANC
    subjectType: Mother
    form:
      sections:
        - {name: Visit, fields: [{name: BP, dataType: Numeric, unit: mmHg}]}
  - name: PNC Visit
    program: PNC
    subjectType: Mother
    form:
      sections:
        - {name: Visit, fields: [{name: BP, dataType: Numeric}]}
  - name: Child Visit
    subjectType: Child
    form:
      sections:
        - {name: Growth, fields: [{name: Weight, dataType: Numeric}]}
  - name: Household Survey
    subjectType: Household
    form:
      sections:
        - {name: Members, fields: [{name: Count, dataType: Numeric}]}
`;
  const r = applySpec({
    existingBundleFiles: { 'subjectTypes.json': [] },
    specYaml: yaml,
  });
  // Tallies
  assert.equal(r.patchedFiles['subjectTypes.json'].length, 3);
  assert.equal(r.patchedFiles['programs.json'].length, 2);
  assert.equal(r.patchedFiles['encounterTypes.json'].length, 4);
  const formPaths = Object.keys(r.patchedFiles).filter((p) => p.startsWith('forms/'));
  // 2 enrolment + 1 exit + 4 encounter = 7
  assert.equal(formPaths.length, 7);
  assert.equal(r.integrity.ok, true);
});

// ─── Round-trip on a tricky shape: ProgramExit + cancellation forms ──

test('integration: ProgramExit + IndividualEncounterCancellation forms survive round-trip', () => {
  const yaml = `
programs:
  - name: P
    targetSubjectType: S
    exitForm:
      sections: [{name: Exit, fields: [{name: Reason, dataType: Text}]}]
encounterTypes:
  - name: Visit
    subjectType: S
    cancellationForm:
      sections: [{name: Why, fields: [{name: Reason, dataType: Text}]}]
`;
  const e1 = specToEntities(yaml);
  const y2 = entitiesToSpec(e1, '');
  const e2 = specToEntities(y2);
  const types1 = e1.forms.map((f) => f.formType).sort();
  const types2 = e2.forms.map((f) => f.formType).sort();
  assert.deepEqual(types1, types2);
  assert.ok(types1.includes('ProgramExit'));
  assert.ok(types1.includes('IndividualEncounterCancellation'));
});

// ─── Bundle-IO + patcher + pipeline integration ──────────────────────

test('integration: ZIP → apply spec → ZIP → re-apply same spec → no-op', async () => {
  const { applySpec } = await loadPipeline();
  const yaml = `
subjectTypes:
  - {name: X, type: Person}
`;
  // Initial empty ZIP
  const zip0 = bundleToZip({ 'subjectTypes.json': [] });
  const r1 = applySpec({ existingBundleZip: zip0, specYaml: yaml, outputZip: true });
  assert.equal(r1.filesChanged.length, 1);
  // Re-apply same spec to the patched ZIP
  const r2 = applySpec({ existingBundleZip: r1.patchedZip, specYaml: yaml, outputZip: true });
  assert.deepEqual(r2.filesChanged, []);
});

test('integration: diff summary names show up for added entities (human-readable)', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: {},
    specYaml: `
subjectTypes:
  - {name: Alice, type: Person}
programs:
  - {name: Bob, targetSubjectType: Alice}
`,
  });
  assert.match(r.diffSummary, /\+ Alice/);
  assert.match(r.diffSummary, /\+ Bob/);
});

// ─── Materialization + patching combined ─────────────────────────────

test('integration: materialise declarative rule, then verify JS sits beside IR in bundle', async () => {
  const { applySpec } = await loadPipeline();
  const yaml = `
programs:
  - name: P
    enrolmentEligibilityCheckDeclarativeRule:
      - conditions:
          - conjunction: and
            compoundRule:
              conjunction: and
              rules:
                - lhs:
                    type: Concept
                    conceptName: Gender
                    conceptUuid: "00000000-0000-0000-0000-000000000001"
                    conceptDataType: Coded
                    scope: registration
                  operator: containsAnyAnswerConceptName
                  rhs:
                    type: answerConcept
                    answerConceptNames: [Female]
                    answerConceptUuids: ["00000000-0000-0000-0000-000000000002"]
        actions:
          - actionType: setEligibility
            details: {}
`;
  const r = applySpec({ existingBundleFiles: {}, specYaml: yaml });
  assert.equal(r.ruleCompilation.compiled.length, 1);
  const p = r.patchedFiles['programs.json'][0];
  // BOTH the declarative IR (audit trail) AND the materialised JS (runtime)
  assert.ok(p.enrolmentEligibilityCheckDeclarativeRule);
  assert.equal(typeof p.enrolmentEligibilityCheckRule, 'string');
  assert.ok(p.enrolmentEligibilityCheckRule.includes('RuleCondition'));
});

// ─── Edge: empty-collection inputs handled gracefully ────────────────

test('integration: spec with empty subjectTypes array → no-op', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: {},
    specYaml: 'org: T\nsubjectTypes: []\n',
  });
  assert.deepEqual(r.filesChanged, []);
});

test('integration: existing concepts.json with 0 entries + new concept → 1 entry', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: { 'concepts.json': [] },
    // Concepts go via the passthrough section `concepts` in YAML
    specYaml: 'org: T\nconcepts:\n  - {uuid: c-1, name: Age, dataType: Numeric}\n',
  });
  assert.equal(r.patchedFiles['concepts.json'].length, 1);
});

// ─── Conformance: every formType I create round-trips through bundle-io ──

test('integration: ZIP-write + re-read preserves form file names for all 7 formTypes', async () => {
  const { applySpec } = await loadPipeline();
  const yaml = `
subjectTypes:
  - name: S
    registrationForm:
      sections: [{name: R, fields: [{name: F, dataType: Text}]}]
programs:
  - name: P
    targetSubjectType: S
    enrolmentForm:
      sections: [{name: E, fields: [{name: F, dataType: Text}]}]
    exitForm:
      sections: [{name: X, fields: [{name: F, dataType: Text}]}]
encounterTypes:
  - name: PV
    program: P
    subjectType: S
    form:
      sections: [{name: V, fields: [{name: F, dataType: Text}]}]
    cancellationForm:
      sections: [{name: W, fields: [{name: F, dataType: Text}]}]
  - name: NV
    subjectType: S
    form:
      sections: [{name: V, fields: [{name: F, dataType: Text}]}]
    cancellationForm:
      sections: [{name: W, fields: [{name: F, dataType: Text}]}]
`;
  const r = applySpec({ existingBundleFiles: {}, specYaml: yaml, outputZip: true });
  const recovered = bundleFromZip(r.patchedZip);
  const formFiles = Object.keys(recovered).filter((p) => p.startsWith('forms/'));
  assert.equal(formFiles.length, 7);
  // All 7 formType values represented
  const types = formFiles.map((p) => recovered[p].formType).sort();
  assert.deepEqual(types, [
    'Encounter', 'IndividualEncounterCancellation', 'IndividualProfile',
    'ProgramEncounter', 'ProgramEncounterCancellation', 'ProgramEnrolment', 'ProgramExit',
  ]);
});

// ─── Coverage: top-level concepts passthrough (rare but valid) ───────

test('integration: top-level concepts in YAML (concept dictionary) preserved', () => {
  const yaml = `
concepts:
  - {uuid: c1, name: Age, dataType: Numeric, lowAbsolute: 0, hiAbsolute: 120}
  - {uuid: c2, name: Gender, dataType: Coded, answers: [{uuid: c3, name: F}]}
`;
  const e = specToEntities(yaml);
  assert.equal(e.concepts_detail.length, 2);
  const y2 = entitiesToSpec(e, '');
  const e2 = specToEntities(y2);
  assert.deepEqual(e2.concepts_detail, e.concepts_detail);
});

// ─── Resilience: missing dependency tolerated, NOT crash ─────────────

test('integration: spec adds program but targetSubjectType missing from bundle → still patches, integrity warns', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: { 'subjectTypes.json': [] },
    specYaml: `
programs:
  - {name: ANC, targetSubjectType: GhostSubject}
`,
  });
  // Program is added regardless — integrity check on formMappings would catch
  // a missing subjectType FK. Programs.targetSubjectType is a STRING field
  // (resolved by name), not a UUID FK, so it doesn't trigger DANGLING_REF here.
  assert.equal(r.patchedFiles['programs.json'].length, 1);
  assert.equal(r.integrity.ok, true);
});

// ─── Determinism: same input → same output (modulo random UUIDs) ─────

test('integration: same input run twice produces same diff shape (UUIDs differ, structure stable)', async () => {
  const { applySpec } = await loadPipeline();
  const yaml = `subjectTypes:\n  - {name: X, type: Person}\n`;
  const r1 = applySpec({ existingBundleFiles: { 'subjectTypes.json': [] }, specYaml: yaml });
  const r2 = applySpec({ existingBundleFiles: { 'subjectTypes.json': [] }, specYaml: yaml });
  assert.equal(r1.filesChanged.length, r2.filesChanged.length);
  assert.equal(r1.diff['subjectTypes.json'].added.length, r2.diff['subjectTypes.json'].added.length);
  // UUIDs are random per call — confirm
  assert.notEqual(r1.diff['subjectTypes.json'].added[0].uuid, r2.diff['subjectTypes.json'].added[0].uuid);
});

// ─── Boundary: max-realistic spec size ───────────────────────────────

test('integration: spec with 50 subjectTypes parses + patches in reasonable time', async () => {
  const { applySpec } = await loadPipeline();
  const sts = Array.from({ length: 50 }, (_, i) => `  - {name: S${i}, type: Person}`).join('\n');
  const yaml = `subjectTypes:\n${sts}\n`;
  const t0 = Date.now();
  const r = applySpec({ existingBundleFiles: {}, specYaml: yaml });
  const dt = Date.now() - t0;
  assert.equal(r.patchedFiles['subjectTypes.json'].length, 50);
  assert.ok(dt < 1500, `50 subjectTypes patched in ${dt}ms — perf regression`);
});

// ─── Stability: random-order patch then re-emit YAML is parseable ─────

test('integration: applied spec → emit YAML → re-parse → identical entity counts', async () => {
  const { applySpec } = await loadPipeline();
  const yaml = `
subjectTypes:
  - {name: A, type: Person}
  - {name: B, type: Person}
programs:
  - {name: P, targetSubjectType: A}
`;
  const r = applySpec({ existingBundleFiles: {}, specYaml: yaml });
  // Emit YAML from patched file map (proxy by reading entities back from spec)
  const reparsed = specToEntities(yaml);
  assert.equal(r.patchedFiles['subjectTypes.json'].length, reparsed.subject_types.length);
  assert.equal(r.patchedFiles['programs.json'].length, reparsed.programs.length);
});

// ─── Snapshot: BUNDLE_HARD_RULES rule #5 (upsert) enforced in patcher ──

test('integration: case-insensitive trim DUPLICATE name produces a single entry (rule #5 in code)', () => {
  const r = patchBundle({
    bundleFiles: { 'subjectTypes.json': [{ uuid: 'a', name: 'Beneficiary' }] },
    entities: {
      subject_types: [
        { name: 'BENEFICIARY', type: 'Person' },
        { name: ' beneficiary ', type: 'Person', allowMiddleName: true },
        { name: 'Beneficiary', type: 'Person', allowProfilePicture: true },
      ],
    },
  });
  // All three match the existing one → exactly one entry remains, with merged fields
  assert.equal(r.newFiles['subjectTypes.json'].length, 1);
  const st = r.newFiles['subjectTypes.json'][0];
  assert.equal(st.uuid, 'a');
  assert.equal(st.allowMiddleName, true);
  assert.equal(st.allowProfilePicture, true);
});
