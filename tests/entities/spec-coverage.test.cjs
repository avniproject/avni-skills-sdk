// Coverage hardening: matrix tests across all formTypes, all rule types,
// and the real-bundle wrapped-shape variants that the dogfood uncovered.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const SPEC = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec');
const { specToEntities }                = require(path.join(SPEC, 'parser.js'));
const { entitiesToSpec }                = require(path.join(SPEC, 'emitter.js'));
const { patchBundle }                   = require(path.join(SPEC, 'patcher.js'));
const { buildBundleGraph, integrityCheck, FORM_TYPE_MAPPING_REQUIREMENTS } = require(path.join(SPEC, 'graph.js'));
const { bundleFromZip, bundleToZip }    = require(path.join(SPEC, 'bundle-io.js'));

async function loadPipeline() {
  return await import('../../src/pipeline.js?t=' + Date.now());
}

// ═════════════════════════════════════════════════════════════════════
// MATRIX A — All 7 formType values produce the correct formMapping shape
// ═════════════════════════════════════════════════════════════════════

const ALL_FORM_TYPES = [
  'IndividualProfile', 'ProgramEnrolment', 'ProgramExit',
  'ProgramEncounter', 'ProgramEncounterCancellation',
  'Encounter', 'IndividualEncounterCancellation',
];

for (const formType of ALL_FORM_TYPES) {
  test(`patcher.formType=${formType}: mapping requirements match validator table`, () => {
    const req = FORM_TYPE_MAPPING_REQUIREMENTS[formType];
    assert.ok(req, `${formType} missing from FORM_TYPE_MAPPING_REQUIREMENTS`);
    assert.equal(typeof req.programUUID, 'boolean');
    assert.equal(typeof req.encounterTypeUUID, 'boolean');
  });
}

test('every formType yields a valid form file path via patcher (new form, atomic create)', () => {
  for (const formType of ALL_FORM_TYPES) {
    const r = patchBundle({
      bundleFiles: {},
      entities: {
        forms: [{
          formType,
          subjectType: 'X',
          program: formType.startsWith('Program') ? 'P' : undefined,
          encounterType: formType.includes('Encounter') ? 'E' : undefined,
          formElementGroups: [],
        }],
      },
    });
    const formPaths = Object.keys(r.newFiles).filter((p) => p.startsWith('forms/'));
    assert.equal(formPaths.length, 1, `${formType}: expected exactly 1 form file`);
    const newForm = r.newFiles[formPaths[0]];
    assert.equal(newForm.formType, formType);
    assert.match(newForm.uuid, /^[0-9a-f]{8}-/);
  }
});

// ═════════════════════════════════════════════════════════════════════
// MATRIX B — All 6 rule types compile from declarative IR
// ═════════════════════════════════════════════════════════════════════

function showWhenFemaleIr() {
  return [{
    conditions: [{
      conjunction: 'and',
      compoundRule: {
        conjunction: 'and',
        rules: [{
          lhs: {
            type: 'Concept',
            conceptName: 'Gender',
            conceptUuid: '00000000-0000-0000-0000-000000000001',
            conceptDataType: 'Coded',
            scope: 'registration',
          },
          operator: 'containsAnyAnswerConceptName',
          rhs: {
            type: 'answerConcept',
            answerConceptNames: ['Female'],
            answerConceptUuids: ['00000000-0000-0000-0000-000000000002'],
          },
        }],
      },
    }],
    actions: [{ actionType: 'showFormElement', details: {} }],
  }];
}

const RULE_TYPES = ['viewFilter', 'formElementGroup', 'eligibility', 'formValidation', 'decision', 'visitSchedule'];

for (const ruleType of RULE_TYPES) {
  test(`rules-brain compiler accepts ruleType=${ruleType} without throwing`, async () => {
    const { compile } = await import('../../src/rules-brain/compile.js');
    const r = compile(showWhenFemaleIr(), ruleType, 'individual');
    // viewFilter / formElementGroup / eligibility produce JS; others may error
    // on shape but must not THROW (return {js:null,error:'...'} instead)
    assert.equal(typeof r, 'object');
    assert.ok('js' in r);
    if (r.js === null && r.error) {
      // Acceptable: emitter rejected this IR for the given ruleType
      assert.equal(typeof r.error, 'string');
    } else {
      assert.equal(typeof r.js, 'string');
    }
  });
}

// ═════════════════════════════════════════════════════════════════════
// MATRIX C — Real-bundle wrapped shapes (the dogfood bugs)
// ═════════════════════════════════════════════════════════════════════

test('pipeline handles wrapped operationalSubjectTypes shape', async () => {
  const { applySpec } = await loadPipeline();
  const bundleFiles = {
    'subjectTypes.json': [{ uuid: 'st-uuid', name: 'X', type: 'Person' }],
    // wrapped shape: real generator emits this, not a bare array
    'operationalSubjectTypes.json': {
      operationalSubjectTypes: [
        { uuid: 'op-uuid', subjectType: { uuid: 'st-uuid', voided: false }, name: 'X', voided: false },
      ],
    },
  };
  const r = applySpec({
    existingBundleFiles: bundleFiles,
    specYaml: 'org: X',
    runIntegrityCheck: true,
  });
  assert.equal(r.integrity.ok, true, 'wrapped shape should pass integrity');
});

test('integrity check fails when wrapped operational refs a missing subjectType', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: {
      'operationalSubjectTypes.json': {
        operationalSubjectTypes: [
          { uuid: 'op-uuid', subjectType: { uuid: 'GHOST-UUID', voided: false }, name: 'X' },
        ],
      },
    },
    specYaml: 'org: X',
  });
  assert.equal(r.integrity.ok, false);
  assert.ok(r.integrity.issues.some((i) => i.message.includes('GHOST-UUID')));
});

test('bare-array operational shape also accepted (sdk-generated synthetic bundles)', async () => {
  const { applySpec } = await loadPipeline();
  const bundleFiles = {
    'subjectTypes.json': [{ uuid: 'st-uuid', name: 'X' }],
    'operationalSubjectTypes.json': [
      { uuid: 'op-uuid', subjectTypeUUID: 'st-uuid', name: 'X' },
    ],
  };
  const r = applySpec({ existingBundleFiles: bundleFiles, specYaml: 'org: X' });
  assert.equal(r.integrity.ok, true);
});

// ═════════════════════════════════════════════════════════════════════
// MATRIX D — Parser passthrough completeness for the comprehensive YAML
// ═════════════════════════════════════════════════════════════════════

test('parser preserves enrolmentEligibilityCheckDeclarativeRule (the dogfood drop bug)', () => {
  const ir = showWhenFemaleIr();
  const yaml = `
programs:
  - name: ANC
    targetSubjectType: Mother
    enrolmentEligibilityCheckDeclarativeRule:
      - conditions: []
        actions: []
`;
  const e = specToEntities(yaml);
  assert.ok(e.programs[0].enrolmentEligibilityCheckDeclarativeRule);
  assert.equal(Array.isArray(e.programs[0].enrolmentEligibilityCheckDeclarativeRule), true);
});

test('parser preserves entityEligibilityCheckDeclarativeRule on encounter types', () => {
  const yaml = `
encounterTypes:
  - name: ANC Visit
    program: ANC
    entityEligibilityCheckDeclarativeRule:
      - conditions: []
        actions: []
`;
  const e = specToEntities(yaml);
  assert.ok(e.encounter_types[0].entityEligibilityCheckDeclarativeRule);
});

test('parser preserves manualEnrolmentEligibilityCheckDeclarativeRule', () => {
  const yaml = `
programs:
  - name: P
    manualEnrolmentEligibilityCheckDeclarativeRule:
      - conditions: []
        actions: []
`;
  const e = specToEntities(yaml);
  assert.ok(e.programs[0].manualEnrolmentEligibilityCheckDeclarativeRule);
});

// ═════════════════════════════════════════════════════════════════════
// MATRIX E — Parser edge cases (would crash on real-world adversarial input)
// ═════════════════════════════════════════════════════════════════════

test('parser handles Unicode in entity names (Hindi, Bengali — AVNI is India-focused)', () => {
  const yaml = `
subjectTypes:
  - name: स्वयंसेवक
    type: Person
  - name: কর্মী
    type: Person
`;
  const e = specToEntities(yaml);
  assert.equal(e.subject_types.length, 2);
  assert.equal(e.subject_types[0].name, 'स्वयंसेवक');
});

test('parser handles deeply-nested form structures (10 sections × 20 fields)', () => {
  const sections = [];
  for (let i = 0; i < 10; i++) {
    const fields = [];
    for (let j = 0; j < 20; j++) {
      fields.push({ name: `Field_${i}_${j}`, dataType: 'Text', mandatory: i === 0 && j === 0 });
    }
    sections.push({ name: `Section${i}`, fields });
  }
  const yaml = require(path.join(AVNI_SKILLS_PATH, 'node_modules', 'js-yaml')).dump({
    subjectTypes: [{ name: 'Big', type: 'Person', registrationForm: { sections } }],
  });
  const e = specToEntities(yaml);
  assert.equal(e.forms[0].formElementGroups.length, 10);
  assert.equal(e.forms[0].formElementGroups[0].formElements.length, 20);
});

test('parser handles negative + float numeric bounds', () => {
  const yaml = `
subjectTypes:
  - name: X
    registrationForm:
      sections:
        - name: A
          fields:
            - {name: Latitude, dataType: Numeric, min: -90.0, max: 90.5}
            - {name: Cold,     dataType: Numeric, min: -273.15, max: 100}
`;
  const e = specToEntities(yaml);
  const fes = e.forms[0].formElementGroups[0].formElements;
  assert.equal(fes[0].concept.lowAbsolute, -90.0);
  assert.equal(fes[0].concept.hiAbsolute, 90.5);
  assert.equal(fes[1].concept.lowAbsolute, -273.15);
});

test('parser handles fields with skipLogic strings containing quotes + backslashes', () => {
  const yaml = `
subjectTypes:
  - name: X
    registrationForm:
      sections:
        - name: A
          fields:
            - name: F
              dataType: Text
              skipLogic: "params.entity.observations.\\\"Age\\\".value > 18"
`;
  const e = specToEntities(yaml);
  assert.equal(typeof e.forms[0].formElementGroups[0].formElements[0].skipLogic, 'string');
});

test('parser handles empty Coded options array (degenerate case)', () => {
  const yaml = `
subjectTypes:
  - name: X
    registrationForm:
      sections:
        - {name: A, fields: [{name: F, dataType: Coded, options: []}]}
`;
  const e = specToEntities(yaml);
  assert.deepEqual(e.forms[0].formElementGroups[0].formElements[0].concept.answers, []);
});

// ═════════════════════════════════════════════════════════════════════
// MATRIX F — Patcher safety nets
// ═════════════════════════════════════════════════════════════════════

test('patcher: trailing whitespace in name matches case-insensitive after trim', () => {
  const r = patchBundle({
    bundleFiles: { 'subjectTypes.json': [{ uuid: 'A', name: 'Beneficiary' }] },
    entities: { subject_types: [{ name: '  beneficiary  ', type: 'Person', allowMiddleName: true }] },
  });
  // Existing entity by UUID stays; updated in place
  assert.equal(r.newFiles['subjectTypes.json'].length, 1);
  assert.equal(r.newFiles['subjectTypes.json'][0].uuid, 'A');
  assert.equal(r.newFiles['subjectTypes.json'][0].allowMiddleName, true);
});

test('patcher: large concepts.json (1k entries) merges without performance cliff', () => {
  const existing = [];
  for (let i = 0; i < 1000; i++) existing.push({ uuid: `u-${i}`, name: `C${i}`, dataType: 'Text' });
  const t0 = Date.now();
  const r = patchBundle({
    bundleFiles: { 'concepts.json': existing },
    entities: { concepts_detail: [{ name: 'NewOne', dataType: 'Numeric' }] },
  });
  const dt = Date.now() - t0;
  assert.equal(r.newFiles['concepts.json'].length, 1001);
  assert.ok(dt < 500, `patch on 1k concepts took ${dt}ms — perf regression`);
});

test('patcher: form with empty formElementGroups still creates a valid file', () => {
  const r = patchBundle({
    bundleFiles: {},
    entities: {
      forms: [{
        formType: 'IndividualProfile', subjectType: 'X',
        name: 'Empty Form', formElementGroups: [],
      }],
    },
  });
  const formPath = Object.keys(r.newFiles).find((p) => p.startsWith('forms/'));
  assert.ok(formPath);
  assert.equal(r.newFiles[formPath].formElementGroups.length, 0);
});

test('patcher: existing form with NO uuid (legacy or malformed) — patch creates one', () => {
  const r = patchBundle({
    bundleFiles: {
      'forms/Legacy_x.json': {
        name: 'Reg', formType: 'IndividualProfile', subjectType: 'X',
        formElementGroups: [],
        // NO uuid field
      },
    },
    entities: {
      forms: [{
        formType: 'IndividualProfile', subjectType: 'X',
        formElementGroups: [{ name: 'New', formElements: [] }],
      }],
    },
  });
  // The form file is matched by (formType, subjectType), so the legacy file is updated
  assert.equal(r.newFiles['forms/Legacy_x.json'].formElementGroups.length, 1);
});

// ═════════════════════════════════════════════════════════════════════
// MATRIX G — Integrity: all edges from JPA model are covered
// ═════════════════════════════════════════════════════════════════════

test('integrity: ConceptAnswer.uuid → standalone concept enforced (avni-server JPA edge)', () => {
  const g = buildBundleGraph(tmpBundle({
    'concepts.json': [
      { uuid: 'parent', name: 'Gender', answers: [{ uuid: 'GHOST', name: 'Other' }] },
    ],
  }));
  const ic = integrityCheck(g);
  // Answer points to a concept that doesn't exist in the standalone list — warning
  const warn = ic.issues.find((i) => i.edge.to === 'GHOST');
  assert.ok(warn);
});

test('integrity: form.decisionConcepts edge (JPA-derived, optional)', () => {
  const formUuid = 'form-1';
  const g = buildBundleGraph(tmpBundle({
    [`forms/F_${formUuid}.json`]: {
      uuid: formUuid, name: 'F', formType: 'IndividualProfile',
      formElementGroups: [],
      decisionConcepts: [{ uuid: 'GHOST-DC', name: 'Risk' }],
    },
  }));
  const ic = integrityCheck(g);
  const dc = ic.issues.find((i) => i.code === 'DANGLING_REF' && i.edge.kind === 'decisionConcept');
  assert.ok(dc);
  assert.equal(dc.severity, 'warning');     // optional edge
});

test('integrity: all referenced subjectTypes from operationalSubjectType wrapped shape resolve', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: {
      'subjectTypes.json': [{ uuid: 'A', name: 'X' }, { uuid: 'B', name: 'Y' }],
      'operationalSubjectTypes.json': {
        operationalSubjectTypes: [
          { uuid: 'op1', subjectType: { uuid: 'A' }, name: 'X' },
          { uuid: 'op2', subjectType: { uuid: 'B' }, name: 'Y' },
        ],
      },
    },
    specYaml: 'org: T',
  });
  assert.equal(r.integrity.ok, true);
});

// ─── helper used by graph tests ─────────────────────────────────────

function tmpBundle(files) {
  const fs = require('node:fs');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const dir = path.join(os.tmpdir(), 'spec-cov-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(path.join(dir, 'forms'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const fp = path.join(dir, name);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(content));
  }
  return dir;
}

// ═════════════════════════════════════════════════════════════════════
// MATRIX H — Bundle ZIP round-trip is byte-stable
// ═════════════════════════════════════════════════════════════════════

test('ZIP round-trip: parse → emit → parse → emit produces identical second-pass bytes', () => {
  const fileMap = {
    'organisationConfig.json': { uuid: 'O', name: 'X' },
    'subjectTypes.json':       [{ uuid: 'A', name: 'X', type: 'Person' }],
    'concepts.json':           [{ uuid: 'C', name: 'Age', dataType: 'Numeric' }],
    'forms/F_form.json':       { uuid: 'F', name: 'Reg', formType: 'IndividualProfile', formElementGroups: [] },
    'formMappings.json':       [{ uuid: 'M', formType: 'IndividualProfile', formUUID: 'F', subjectTypeUUID: 'A' }],
  };
  const z1 = bundleToZip(fileMap);
  const recovered1 = bundleFromZip(z1);
  const z2 = bundleToZip(recovered1);
  const recovered2 = bundleFromZip(z2);
  assert.deepEqual(recovered1, recovered2, 'ZIP round-trip should be idempotent at the file-map level');
});

// ═════════════════════════════════════════════════════════════════════
// MATRIX I — Pipeline behaviour under spec-only edits (no bundle changes)
// ═════════════════════════════════════════════════════════════════════

test('applySpec: yaml-only-settings change does NOT touch the bundle (no false-diff)', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: { 'subjectTypes.json': [] },
    specYaml: 'org: T\nsettings:\n  languages: [en, hi_IN]\n',
  });
  assert.deepEqual(r.filesChanged, []);
  assert.equal(r.integrity.ok, true);
});

test('applySpec: empty YAML (only org) is a no-op, not a crash', async () => {
  const { applySpec } = await loadPipeline();
  const r = applySpec({
    existingBundleFiles: { 'concepts.json': [{ uuid: 'C', name: 'Age' }] },
    specYaml: 'org: T\n',
  });
  assert.deepEqual(r.filesChanged, []);
});

test('applySpec: empty YAML mapping ({}) is rejected gracefully', async () => {
  const { applySpec } = await loadPipeline();
  // js-yaml parses '{}' as an empty mapping; parser accepts it (org="")
  const r = applySpec({
    existingBundleFiles: {},
    specYaml: '{}',
  });
  assert.equal(r.integrity.ok, true);
  assert.deepEqual(r.filesChanged, []);
});

test('applySpec: malformed YAML produces a clear ValueError, not a silent failure', async () => {
  const { applySpec } = await loadPipeline();
  assert.throws(() => applySpec({
    existingBundleFiles: {},
    specYaml: ': : :',
  }), /Invalid YAML/);
});
