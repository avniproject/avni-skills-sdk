// Tests for avni-skills/srs-bundle-generator/spec/graph.js — dependency graph
// builder + findDependents / findDependencies / integrityCheck queries.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const GRAPH = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec', 'graph.js');
const {
  buildBundleGraph,
  findDependents,
  findDependencies,
  integrityCheck,
  FORM_TYPE_MAPPING_REQUIREMENTS,
} = require(GRAPH);

const uuid = () => crypto.randomUUID();

function tmpBundle(name = 'graph') {
  const dir = path.join(os.tmpdir(), `${name}-test-` + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(path.join(dir, 'forms'), { recursive: true });
  return dir;
}

function writeJson(dir, file, data) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
}

// ─── A reusable synthetic bundle with full referential integrity ───

function fullBundle() {
  const dir = tmpBundle();

  const stUuid = uuid();
  const opStUuid = uuid();
  const progUuid = uuid();
  const opProgUuid = uuid();
  const encUuid = uuid();
  const opEncUuid = uuid();
  const conceptUuid = uuid();
  const ansUuid = uuid();
  const formUuid = uuid();
  const formMappingUuid = uuid();

  writeJson(dir, 'subjectTypes.json',           [{ uuid: stUuid, name: 'Beneficiary' }]);
  writeJson(dir, 'operationalSubjectTypes.json', [{ uuid: opStUuid, subjectTypeUUID: stUuid, name: 'Beneficiary' }]);
  writeJson(dir, 'programs.json',                [{ uuid: progUuid, name: 'ANC' }]);
  writeJson(dir, 'operationalPrograms.json',     [{ uuid: opProgUuid, programUUID: progUuid, name: 'ANC' }]);
  writeJson(dir, 'encounterTypes.json',          [{ uuid: encUuid, name: 'ANC Visit' }]);
  writeJson(dir, 'operationalEncounterTypes.json', [{ uuid: opEncUuid, encounterTypeUUID: encUuid, name: 'ANC Visit' }]);
  writeJson(dir, 'concepts.json', [
    { uuid: conceptUuid, name: 'Gender', dataType: 'Coded', answers: [{ uuid: ansUuid, name: 'Female' }] },
    { uuid: ansUuid,     name: 'Female', dataType: 'NA' },
  ]);
  fs.writeFileSync(path.join(dir, 'forms', `RegForm_${formUuid}.json`), JSON.stringify({
    uuid: formUuid, name: 'Registration', formType: 'IndividualProfile',
    formElementGroups: [{
      uuid: uuid(), name: 'Identity',
      formElements: [
        { uuid: uuid(), name: 'Gender', concept: { uuid: conceptUuid, name: 'Gender' } }
      ],
    }],
  }));
  writeJson(dir, 'formMappings.json', [{
    uuid: formMappingUuid, formType: 'IndividualProfile',
    formUUID: formUuid, subjectTypeUUID: stUuid,
  }]);

  return { dir, stUuid, opStUuid, progUuid, opProgUuid, encUuid, opEncUuid,
           conceptUuid, ansUuid, formUuid, formMappingUuid };
}

// ─── Builder sanity ────────────────────────────────────────────────

test('buildBundleGraph counts nodes by kind', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  assert.equal(g.counts.subjectType, 1);
  assert.equal(g.counts.operationalSubjectType, 1);
  assert.equal(g.counts.program, 1);
  assert.equal(g.counts.operationalProgram, 1);
  assert.equal(g.counts.encounterType, 1);
  assert.equal(g.counts.operationalEncounterType, 1);
  assert.equal(g.counts.concept, 2);
  assert.equal(g.counts.form, 1);
  assert.equal(g.counts.formMapping, 1);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('buildBundleGraph: missing files are tolerated (empty arrays)', () => {
  const dir = tmpBundle('partial');
  writeJson(dir, 'subjectTypes.json', [{ uuid: uuid(), name: 'X' }]);
  // no concepts, no forms, no formMappings — everything else missing
  const g = buildBundleGraph(dir);
  assert.equal(g.counts.subjectType, 1);
  assert.equal(g.counts.formMapping, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildBundleGraph throws on missing/invalid bundleDir arg', () => {
  assert.throws(() => buildBundleGraph(), /bundleDir/);
  assert.throws(() => buildBundleGraph(null), /bundleDir/);
});

// ─── Edge correctness: formMapping fans out 2 edges in clean bundle ─

test('formMapping → form + subjectType edges present', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  const fm = findDependencies(g, b.formMappingUuid);
  const kinds = fm.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['mappingForm', 'mappingSubjectType']);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('ProgramEnrolment formMapping requires programUUID (per validator table)', () => {
  const dir = tmpBundle('progenrol');
  const stU = uuid(), progU = uuid(), formU = uuid(), mapU = uuid();
  writeJson(dir, 'subjectTypes.json',  [{ uuid: stU, name: 'X' }]);
  writeJson(dir, 'programs.json',      [{ uuid: progU, name: 'P' }]);
  fs.writeFileSync(path.join(dir, 'forms', `E_${formU}.json`), JSON.stringify({
    uuid: formU, name: 'Enrol', formType: 'ProgramEnrolment', formElementGroups: [],
  }));
  writeJson(dir, 'formMappings.json',  [{
    uuid: mapU, formType: 'ProgramEnrolment',
    formUUID: formU, subjectTypeUUID: stU, programUUID: progU,
  }]);
  const g = buildBundleGraph(dir);
  const progEdge = g.edges.find((e) => e.kind === 'mappingProgram');
  assert.ok(progEdge);
  assert.equal(progEdge.required, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ProgramEncounter formMapping requires BOTH programUUID + encounterTypeUUID', () => {
  const requirements = FORM_TYPE_MAPPING_REQUIREMENTS.ProgramEncounter;
  assert.equal(requirements.programUUID, true);
  assert.equal(requirements.encounterTypeUUID, true);
});

test('formElement.concept ref produces a typed edge', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  const fromForm = findDependencies(g, b.formUuid);
  const conceptEdge = fromForm.find((d) => d.kind === 'formElementConcept');
  assert.ok(conceptEdge, 'form → concept edge expected');
  assert.equal(conceptEdge.to.uuid, b.conceptUuid);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('Coded answer creates conceptAnswer edge to the standalone concept', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  const fromGender = findDependencies(g, b.conceptUuid);
  const ansEdge = fromGender.find((d) => d.kind === 'conceptAnswer');
  assert.ok(ansEdge);
  assert.equal(ansEdge.to.uuid, b.ansUuid);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

// ─── Queries ───────────────────────────────────────────────────────

test('findDependents: subjectType is depended on by formMapping + opSubjectType', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  const deps = findDependents(g, b.stUuid);
  const kinds = deps.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['mappingSubjectType', 'operationalMirror']);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('findDependencies: empty list for a leaf node (subjectType)', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  const out = findDependencies(g, b.stUuid);
  assert.deepEqual(out, []);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

// ─── Integrity ─────────────────────────────────────────────────────

test('integrityCheck: clean bundle has no issues', () => {
  const b = fullBundle();
  const g = buildBundleGraph(b.dir);
  const ic = integrityCheck(g);
  assert.equal(ic.ok, true);
  assert.deepEqual(ic.issues, []);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('integrityCheck: dangling formMapping.formUUID surfaces as ERROR', () => {
  const dir = tmpBundle('dangling');
  const stU = uuid(), mapU = uuid(), badFormU = uuid();
  writeJson(dir, 'subjectTypes.json', [{ uuid: stU, name: 'X' }]);
  writeJson(dir, 'formMappings.json', [{
    uuid: mapU, formType: 'IndividualProfile',
    formUUID: badFormU, subjectTypeUUID: stU,
  }]);
  const g = buildBundleGraph(dir);
  const ic = integrityCheck(g);
  assert.equal(ic.ok, false);
  const danglingForm = ic.issues.find((i) => i.code === 'DANGLING_REF' && i.edge.to === badFormU);
  assert.ok(danglingForm);
  assert.equal(danglingForm.severity, 'error');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('integrityCheck: dangling optional ref (encounterType.conceptUuid) → WARNING', () => {
  const dir = tmpBundle('optional');
  const encU = uuid(), missingConceptU = uuid();
  writeJson(dir, 'encounterTypes.json', [{
    uuid: encU, name: 'Visit', conceptUuid: missingConceptU,
  }]);
  const g = buildBundleGraph(dir);
  const ic = integrityCheck(g);
  // The display-concept edge is required:false → integrity reports a WARNING
  const warn = ic.issues.find((i) => i.edge.to === missingConceptU);
  assert.ok(warn);
  assert.equal(warn.severity, 'warning');
  // ok stays true because we only have warnings
  assert.equal(ic.ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── AddressLevelType self-ref + GroupRole double-FK ────────────────

test('AddressLevelType.parentUuid creates a self-referential edge', () => {
  const dir = tmpBundle('alt');
  const stateU = uuid(), distU = uuid();
  writeJson(dir, 'addressLevelTypes.json', [
    { uuid: stateU, name: 'State' },
    { uuid: distU,  name: 'District', parentUuid: stateU },
  ]);
  const g = buildBundleGraph(dir);
  const deps = findDependents(g, stateU);
  assert.equal(deps[0].kind, 'hierarchy');
  assert.equal(deps[0].from.uuid, distU);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GroupRole produces both group + member subjectType edges', () => {
  const dir = tmpBundle('grouprole');
  const groupSt = uuid(), memberSt = uuid(), gr = uuid();
  writeJson(dir, 'subjectTypes.json', [
    { uuid: groupSt, name: 'Household' },
    { uuid: memberSt, name: 'Member' },
  ]);
  writeJson(dir, 'groupRoles.json', [{
    uuid: gr, name: 'Member-of-Household',
    groupSubjectTypeUUID: groupSt, memberSubjectTypeUUID: memberSt,
  }]);
  const g = buildBundleGraph(dir);
  const groupDeps = findDependents(g, groupSt);
  const memberDeps = findDependents(g, memberSt);
  assert.ok(groupDeps.some((d) => d.via.includes('groupSubjectTypeUUID')));
  assert.ok(memberDeps.some((d) => d.via.includes('memberSubjectTypeUUID')));
  fs.rmSync(dir, { recursive: true, force: true });
});
