// Tests for avni-skills/srs-bundle-generator/spec/patcher.js — entity merge
// + diff generation on an existing bundle's file map.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const SPEC = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec');
const { patchBundle, summarizeDiff, mergeCollection, buildFormFileName } = require(path.join(SPEC, 'patcher.js'));

const UUID = (n) => `${'0'.repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U1 = UUID(1), U2 = UUID(2), U3 = UUID(3), U4 = UUID(4);

// ─── Smoke ─────────────────────────────────────────────────────────

test('throws on missing args', () => {
  assert.throws(() => patchBundle({}), /bundleFiles object required/);
  assert.throws(() => patchBundle({ bundleFiles: {} }), /entities object required/);
});

test('empty entities → no-op (no files changed, empty diff)', () => {
  const r = patchBundle({
    bundleFiles: { 'concepts.json': [{ uuid: U1, name: 'Age' }] },
    entities: { subject_types: [], programs: [] },
  });
  assert.deepEqual(r.filesChanged, []);
  assert.deepEqual(r.diff, {});
  assert.deepEqual(r.newFiles['concepts.json'], [{ uuid: U1, name: 'Age' }]);
});

// ─── mergeCollection ────────────────────────────────────────────────

test('mergeCollection: UUID match → update in place, name unchanged', () => {
  const existing = [{ uuid: U1, name: 'Age', dataType: 'Numeric' }];
  const incoming = [{ uuid: U1, name: 'Age', dataType: 'Numeric', lowAbsolute: 0 }];
  const { next, updated } = mergeCollection(existing, incoming, { uuidKey: 'uuid', nameKey: 'name' });
  assert.equal(next.length, 1);
  assert.equal(next[0].lowAbsolute, 0);
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0].fields, ['lowAbsolute']);
});

test('mergeCollection: name match (case-insensitive) when no UUID', () => {
  const existing = [{ uuid: U1, name: 'Age', dataType: 'Numeric' }];
  const incoming = [{ name: 'age', dataType: 'Numeric', lowAbsolute: 0 }]; // no uuid; lowercase name
  const { next, added, updated } = mergeCollection(existing, incoming, { uuidKey: 'uuid', nameKey: 'name' });
  assert.equal(next.length, 1);
  assert.equal(next[0].uuid, U1);           // UUID preserved
  assert.equal(next[0].lowAbsolute, 0);
  assert.equal(added.length, 0);
  assert.equal(updated.length, 1);
});

test('mergeCollection: no match → append with new UUID', () => {
  const existing = [{ uuid: U1, name: 'Age' }];
  const incoming = [{ name: 'Weight', dataType: 'Numeric' }];     // no uuid
  const { next, added } = mergeCollection(existing, incoming, { uuidKey: 'uuid', nameKey: 'name' });
  assert.equal(next.length, 2);
  assert.equal(next[1].name, 'Weight');
  assert.match(next[1].uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(added.length, 1);
});

test('mergeCollection: UUID conflict preserves existing UUID (cannot replace UUID via patch)', () => {
  const existing = [{ uuid: U1, name: 'Age' }];
  const incoming = [{ uuid: U2, name: 'Age', dataType: 'Numeric' }];      // tries to flip UUID
  const { next, updated } = mergeCollection(existing, incoming, { uuidKey: 'uuid', nameKey: 'name' });
  // No UUID match → falls back to name match → U2 entry does NOT update U1 by UUID
  // It DOES match by name. Then merge layers new fields. UUID stays U1.
  assert.equal(next.length, 1);
  assert.equal(next[0].uuid, U1);
  assert.equal(next[0].dataType, 'Numeric');
});

test('mergeCollection: no changes → updated array is empty', () => {
  const existing = [{ uuid: U1, name: 'Age', dataType: 'Numeric' }];
  const incoming = [{ uuid: U1, name: 'Age', dataType: 'Numeric' }];
  const { updated, added } = mergeCollection(existing, incoming, { uuidKey: 'uuid', nameKey: 'name' });
  assert.equal(updated.length, 0);
  assert.equal(added.length, 0);
});

// ─── patchBundle: full collections ──────────────────────────────────

test('patchBundle: adds new concept to concepts.json + records diff', () => {
  const r = patchBundle({
    bundleFiles: { 'concepts.json': [{ uuid: U1, name: 'Age' }] },
    entities: { concepts_detail: [{ name: 'Weight', dataType: 'Numeric' }] },
  });
  assert.equal(r.newFiles['concepts.json'].length, 2);
  assert.equal(r.diff['concepts.json'].added.length, 1);
  assert.equal(r.diff['concepts.json'].added[0].name, 'Weight');
  assert.deepEqual(r.filesChanged, ['concepts.json']);
});

test('patchBundle: subjectTypes merge by name preserves UUID', () => {
  const r = patchBundle({
    bundleFiles: {
      'subjectTypes.json': [{ uuid: U1, name: 'Beneficiary', type: 'Person' }],
    },
    entities: {
      subject_types: [{ name: 'Beneficiary', type: 'Person', allowMiddleName: true }],
    },
  });
  const after = r.newFiles['subjectTypes.json'][0];
  assert.equal(after.uuid, U1);
  assert.equal(after.allowMiddleName, true);
  assert.equal(r.diff['subjectTypes.json'].updated[0].fields.includes('allowMiddleName'), true);
});

// ─── patchBundle: forms ─────────────────────────────────────────────

test('patchBundle: matches existing form by (formType, subjectType) and updates', () => {
  const r = patchBundle({
    bundleFiles: {
      'forms/Reg_existing.json': {
        uuid: U1, name: 'Reg', formType: 'IndividualProfile', subjectType: 'B',
        formElementGroups: [{ name: 'A', formElements: [] }],
      },
    },
    entities: {
      forms: [{
        formType: 'IndividualProfile', subjectType: 'B',
        formElementGroups: [{ name: 'Identity', formElements: [{ name: 'X' }] }],
      }],
    },
  });
  // Form file path stays (matched), UUID preserved, body updated
  assert.equal(r.newFiles['forms/Reg_existing.json'].uuid, U1);
  assert.equal(r.newFiles['forms/Reg_existing.json'].formElementGroups[0].name, 'Identity');
  assert.equal(r.diff['forms/*'].updated.length, 1);
  assert.equal(r.diff['forms/*'].updated[0].file, 'forms/Reg_existing.json');
});

test('patchBundle: new form creates new forms/*.json file with v4 UUID', () => {
  const r = patchBundle({
    bundleFiles: {},
    entities: {
      forms: [{
        formType: 'IndividualProfile', subjectType: 'Beneficiary',
        name: 'Beneficiary Registration',
        formElementGroups: [{ name: 'Identity', formElements: [] }],
      }],
    },
  });
  const formPaths = Object.keys(r.newFiles).filter((p) => p.startsWith('forms/'));
  assert.equal(formPaths.length, 1);
  const newForm = r.newFiles[formPaths[0]];
  assert.match(newForm.uuid, /^[0-9a-f]{8}-/);
  assert.equal(newForm.formType, 'IndividualProfile');
  assert.equal(r.diff['forms/*'].added.length, 1);
});

test('patchBundle: ProgramEncounter form matched by formType+program+encounterType', () => {
  const r = patchBundle({
    bundleFiles: {
      'forms/ANC_x.json': {
        uuid: U1, name: 'ANC Visit',
        formType: 'ProgramEncounter', program: 'ANC', encounterType: 'ANC Visit',
        formElementGroups: [],
      },
      'forms/Other_y.json': {
        uuid: U2, name: 'Home Visit',
        formType: 'Encounter', subjectType: 'Worker', encounterType: 'Home Visit',
        formElementGroups: [],
      },
    },
    entities: {
      forms: [{
        formType: 'ProgramEncounter', program: 'ANC', encounterType: 'ANC Visit',
        formElementGroups: [{ name: 'Visit', formElements: [{ name: 'BP' }] }],
      }],
    },
  });
  // The ANC form updates, the other Encounter doesn't
  assert.equal(r.newFiles['forms/ANC_x.json'].formElementGroups[0].name, 'Visit');
  assert.equal(r.newFiles['forms/Other_y.json'].formElementGroups.length, 0);
});

// ─── Idempotence ────────────────────────────────────────────────────

test('patchBundle: applying same patch twice → second is a no-op', () => {
  const initial = { 'concepts.json': [{ uuid: U1, name: 'Age' }] };
  const entities = { concepts_detail: [{ name: 'Weight', dataType: 'Numeric' }] };

  const first = patchBundle({ bundleFiles: initial, entities });
  // re-run with the patched state + the same incoming entities (but Weight now exists by name)
  const second = patchBundle({ bundleFiles: first.newFiles, entities });
  assert.deepEqual(second.filesChanged, []);
  assert.deepEqual(second.diff, {});
});

// ─── Helpers ────────────────────────────────────────────────────────

test('buildFormFileName: strips unsafe characters + collapses whitespace', () => {
  const p = buildFormFileName('Mother Care / Postnatal Visit', U1);
  // The forward-slash is stripped → its position collapses into the surrounding whitespace
  assert.equal(p, 'forms/Mother Care Postnatal Visit_' + U1 + '.json');
  // No path-traversal characters survive
  assert.ok(!p.slice('forms/'.length).includes('/'));
});

test('summarizeDiff: produces a readable one-liner per file', () => {
  const diff = {
    'concepts.json': { added: [{ name: 'Weight' }], updated: [], removed: [] },
    'forms/*':       { added: [{ name: 'F1', file: 'forms/F1_x.json' }], updated: [], removed: [] },
  };
  const s = summarizeDiff(diff);
  assert.match(s, /concepts.json:  \+1  ~0  -0/);
  assert.match(s, /\+ Weight/);
  assert.match(s, /forms\/\*:/);
});
