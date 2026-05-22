// Tests for avni-skills/srs-bundle-generator/spec/bundle-io.js — ZIP ↔ file
// map round-trip. Org-agnostic synthetic fixtures only.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const IO = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec', 'bundle-io.js');
const { bundleFromZip, bundleToZip } = require(IO);

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

function sampleBundle() {
  return {
    'organisationConfig.json': { uuid: U1, name: 'Test', settings: { languages: ['en'] } },
    'subjectTypes.json':       [{ uuid: U1, name: 'Beneficiary', type: 'Person' }],
    'programs.json':           [],
    'encounterTypes.json':     [{ uuid: U2, name: 'Home Visit' }],
    'concepts.json':           [
      { uuid: U1, name: 'Gender', dataType: 'Coded', answers: [{ uuid: U2, name: 'Female' }] },
      { uuid: U2, name: 'Female', dataType: 'NA' },
    ],
    'forms/Reg_form1.json':    { uuid: U1, name: 'Reg', formType: 'IndividualProfile', formElementGroups: [] },
    'forms/Visit_form2.json':  { uuid: U2, name: 'Visit', formType: 'Encounter', formElementGroups: [] },
    'formMappings.json':       [{ uuid: U1, formType: 'IndividualProfile', formUUID: U1, subjectTypeUUID: U1 }],
    'addressLevelTypes.json':  [],
  };
}

// ─── Round-trip ────────────────────────────────────────────────────

test('bundleToZip → bundleFromZip round-trips a synthetic bundle', () => {
  const original = sampleBundle();
  const zipBuf = bundleToZip(original);
  assert.ok(Buffer.isBuffer(zipBuf));
  assert.ok(zipBuf.length > 100, 'ZIP buffer should be non-trivial');

  const recovered = bundleFromZip(zipBuf);
  // Same keys
  assert.deepEqual(Object.keys(recovered).sort(), Object.keys(original).sort());
  // Same content per key
  for (const key of Object.keys(original)) {
    assert.deepEqual(recovered[key], original[key], `mismatch on ${key}`);
  }
});

test('bundleToZip preserves canonical order on output', () => {
  const original = sampleBundle();
  const zipBuf = bundleToZip(original);
  const recovered = bundleFromZip(zipBuf);

  // Recovered keys should match the canonical order: orgConfig → addressLevelTypes
  // → subjectTypes → programs → encounterTypes → concepts → forms → formMappings
  const keys = Object.keys(recovered);
  const idxOrg     = keys.indexOf('organisationConfig.json');
  const idxAddr    = keys.indexOf('addressLevelTypes.json');
  const idxSubj    = keys.indexOf('subjectTypes.json');
  const idxProg    = keys.indexOf('programs.json');
  const idxEnc     = keys.indexOf('encounterTypes.json');
  const idxConc    = keys.indexOf('concepts.json');
  const idxForm1   = keys.indexOf('forms/Reg_form1.json');
  const idxMap     = keys.indexOf('formMappings.json');

  assert.ok(idxOrg < idxAddr, 'orgConfig before addressLevelTypes');
  assert.ok(idxAddr < idxSubj, 'addressLevelTypes before subjectTypes');
  assert.ok(idxSubj < idxProg, 'subjectTypes before programs');
  assert.ok(idxProg < idxEnc,  'programs before encounterTypes');
  assert.ok(idxEnc < idxConc,  'encounterTypes before concepts');
  assert.ok(idxConc < idxForm1, 'concepts before forms');
  assert.ok(idxForm1 < idxMap, 'forms before formMappings');
});

// ─── Edge cases ─────────────────────────────────────────────────────

test('bundleToZip: throws on missing fileMap', () => {
  assert.throws(() => bundleToZip(), /fileMap object required/);
  assert.throws(() => bundleToZip(null), /fileMap object required/);
});

test('bundleFromZip: throws on non-Buffer input', () => {
  assert.throws(() => bundleFromZip('not a buffer'), /Buffer required/);
});

test('bundleToZip handles empty fileMap (creates valid empty-ish ZIP)', () => {
  const buf = bundleToZip({});
  const recovered = bundleFromZip(buf);
  assert.deepEqual(recovered, {});
});

test('bundleToZip preserves non-canonical files (e.g. catchments.json) at the tail', () => {
  const fileMap = {
    ...sampleBundle(),
    'catchments.json': [{ uuid: U1, name: 'Mumbai' }],
    'locations.json':  [{ uuid: U2, name: 'Andheri' }],
  };
  const buf = bundleToZip(fileMap);
  const recovered = bundleFromZip(buf);
  assert.deepEqual(recovered['catchments.json'], fileMap['catchments.json']);
  assert.deepEqual(recovered['locations.json'], fileMap['locations.json']);
});

test('bundleFromZip preserves non-JSON entries as raw Buffer', () => {
  const fileMap = {
    'organisationConfig.json': { name: 'X' },
    'README.txt': Buffer.from('hello world', 'utf8'),
  };
  const buf = bundleToZip(fileMap);
  const recovered = bundleFromZip(buf);
  assert.ok(Buffer.isBuffer(recovered['README.txt']));
  assert.equal(recovered['README.txt'].toString('utf8'), 'hello world');
});

test('multiple forms files: all preserved in canonical __FORMS__ slot', () => {
  const fileMap = {
    'subjectTypes.json': [],
    'concepts.json': [],
    'forms/A_111.json': { name: 'A', formType: 'IndividualProfile' },
    'forms/B_222.json': { name: 'B', formType: 'Encounter' },
    'forms/C_333.json': { name: 'C', formType: 'ProgramEnrolment' },
    'formMappings.json': [],
  };
  const buf = bundleToZip(fileMap);
  const recovered = bundleFromZip(buf);
  assert.equal(Object.keys(recovered).filter((k) => k.startsWith('forms/')).length, 3);
  // Forms ordered after concepts.json, before formMappings.json
  const keys = Object.keys(recovered);
  const idxConcepts = keys.indexOf('concepts.json');
  const idxForms    = keys.findIndex((k) => k.startsWith('forms/'));
  const idxMap      = keys.indexOf('formMappings.json');
  assert.ok(idxConcepts < idxForms);
  assert.ok(idxForms < idxMap);
});

// ─── ZIP buffer is real (importable into adm-zip directly) ─────────

test('output ZIP is a valid ZIP archive (parseable independently)', () => {
  const AdmZip = require(path.join(AVNI_SKILLS_PATH, 'node_modules', 'adm-zip'));
  const buf = bundleToZip(sampleBundle());
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().map((e) => e.entryName);
  assert.ok(entries.includes('concepts.json'));
  assert.ok(entries.includes('subjectTypes.json'));
});
