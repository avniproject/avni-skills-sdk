// Tests for avni-skills/srs-bundle-generator/spec/emitter.js — entities → YAML.
// Round-trip identity is the contract: parse(emit(parse(y))) deep-equals parse(y).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const SPEC = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec');
const { specToEntities } = require(path.join(SPEC, 'parser.js'));
const { entitiesToSpec } = require(path.join(SPEC, 'emitter.js'));

function roundTrip(yamlStr) {
  const e1 = specToEntities(yamlStr);
  const y2 = entitiesToSpec(e1, e1.org_name);
  const e2 = specToEntities(y2);
  return { e1, y2, e2 };
}

// ─── Smoke ─────────────────────────────────────────────────────────

test('throws on missing/invalid input', () => {
  assert.throws(() => entitiesToSpec(null), /entities object required/);
  assert.throws(() => entitiesToSpec('string'), /entities object required/);
});

test('emits valid YAML for empty input (defaults applied)', () => {
  const out = entitiesToSpec({});
  assert.match(out, /^org: Unknown Organization\n/);
  assert.match(out, /settings:/);
  assert.match(out, /groups:\n  - name: Everyone\n/);
});

// ─── Round-trip on representative shapes ────────────────────────────

test('round-trip: minimal subjectType + registrationForm', () => {
  const y = `
org: "Acme"
subjectTypes:
  - name: Beneficiary
    type: Person
    registrationForm:
      sections:
        - name: Identity
          fields:
            - name: Full Name
              dataType: Text
              mandatory: true
            - name: Age
              dataType: Numeric
              min: 0
              max: 120
              unit: years
`;
  const { e1, e2 } = roundTrip(y);
  assert.deepEqual(e1.subject_types, e2.subject_types);
  // Form should survive round-trip
  assert.equal(e2.forms.length, 1);
  assert.equal(e2.forms[0].formType, 'IndividualProfile');
  const ageField = e2.forms[0].formElementGroups[0].formElements[1];
  assert.equal(ageField.concept.lowAbsolute, 0);
  assert.equal(ageField.concept.hiAbsolute, 120);
});

test('round-trip: program with enrolmentForm + exitForm', () => {
  const y = `
programs:
  - name: ANC
    targetSubjectType: Mother
    enrolmentForm:
      sections:
        - name: Enroll
          fields:
            - {name: LMP, dataType: Date}
    exitForm:
      sections:
        - name: Exit
          fields:
            - {name: Outcome, dataType: Coded, options: [Live, Stillbirth]}
`;
  const { e1, e2 } = roundTrip(y);
  assert.equal(e2.programs[0].name, 'ANC');
  assert.equal(e2.programs[0].target_subject_type, 'Mother');
  const formTypes = e2.forms.map((f) => f.formType).sort();
  assert.deepEqual(formTypes, ['ProgramEnrolment', 'ProgramExit']);
  // Coded options round-trip
  const exit = e2.forms.find((f) => f.formType === 'ProgramExit');
  assert.deepEqual(
    exit.formElementGroups[0].formElements[0].concept.answers,
    [{ name: 'Live' }, { name: 'Stillbirth' }],
  );
});

test('round-trip: program-encounter + cancellation', () => {
  const y = `
encounterTypes:
  - name: ANC Visit
    program: ANC
    subjectType: Mother
    form:
      sections:
        - {name: Visit, fields: [{name: BP, dataType: Numeric, unit: mmHg}]}
    cancellationForm:
      sections:
        - {name: Why, fields: [{name: Reason, dataType: Text}]}
`;
  const { e1, e2 } = roundTrip(y);
  assert.equal(e1.encounter_types[0].is_program_encounter, true);
  assert.equal(e2.encounter_types[0].is_program_encounter, true);
  const formTypes = e2.forms.map((f) => f.formType).sort();
  assert.deepEqual(formTypes, ['ProgramEncounter', 'ProgramEncounterCancellation']);
});

test('round-trip: non-program encounter → Encounter + IndividualEncounterCancellation', () => {
  const y = `
encounterTypes:
  - name: Home Visit
    subjectType: Beneficiary
    form:
      sections:
        - {name: Visit, fields: [{name: Note, dataType: Text}]}
    cancellationForm:
      sections:
        - {name: Why, fields: [{name: Reason, dataType: Text}]}
`;
  const { e1, e2 } = roundTrip(y);
  const formTypes = e2.forms.map((f) => f.formType).sort();
  assert.deepEqual(formTypes, ['Encounter', 'IndividualEncounterCancellation']);
});

test('round-trip: addressLevels preserve level + parent (emitter sorts DESC by level)', () => {
  const y = `
addressLevels:
  - {name: Village, level: 1, parent: Block}
  - {name: Block, level: 2, parent: District}
  - {name: District, level: 3, parent: State}
  - {name: State, level: 4}
`;
  const { e1, e2, y2 } = roundTrip(y);
  // Compare by name (emitter normalises order to DESC level) — set equality
  const byName = (arr) => Object.fromEntries(arr.map((r) => [r.name, r]));
  assert.deepEqual(byName(e1.address_levels), byName(e2.address_levels));
  assert.match(y2, /addressLevels:\n  - name: State/);
  // And the canonical second-pass order IS State→District→Block→Village
  assert.deepEqual(
    e2.address_levels.map((a) => a.name),
    ['State', 'District', 'Block', 'Village'],
  );
});

test('round-trip: passthrough sections preserved verbatim', () => {
  const y = `
messageRules:
  - name: Birthday
    receiverType: Subject
groupPrivileges:
  - groupName: Administrator
    privileges: [{type: ViewSubject}]
menuItems:
  - displayKey: Reports
    type: dashboard
`;
  const { e1, e2 } = roundTrip(y);
  assert.deepEqual(e1.message_rules, e2.message_rules);
  assert.deepEqual(e1.group_privileges, e2.group_privileges);
  assert.deepEqual(e1.menu_items, e2.menu_items);
});

test('round-trip: groups with hasAllPrivileges preserved', () => {
  const y = `
groups:
  - {name: Administrator, hasAllPrivileges: true}
  - {name: FieldWorker}
`;
  const { e1, e2 } = roundTrip(y);
  assert.equal(e2.groups.length, 2);
  assert.equal(e2.groups[0].has_all_privileges, true);
  assert.equal(e2.groups[1].has_all_privileges, false);
});

test('round-trip: subjectType passthrough fields preserved', () => {
  const y = `
subjectTypes:
  - name: X
    type: Person
    iconFileS3Key: "s3://bucket/icon.png"
    syncRegistrationConcept1: "concept-uuid-1"
    syncRegistrationConcept1Usable: true
    subjectSummaryRule: |
      'use strict'; ({params}) => null;
    validFirstNameFormat:
      regex: "^[A-Z].*"
      descriptionKey: "Cap required"
`;
  const { e1, e2 } = roundTrip(y);
  const st = e2.subject_types[0];
  assert.equal(st.iconFileS3Key, 's3://bucket/icon.png');
  assert.equal(st.syncRegistrationConcept1, 'concept-uuid-1');
  assert.equal(st.syncRegistrationConcept1Usable, true);
  assert.match(st.subjectSummaryRule, /use strict/);
  assert.deepEqual(st.validFirstNameFormat, { regex: '^[A-Z].*', descriptionKey: 'Cap required' });
});

// ─── Selection type from element.type ───────────────────────────────

test('emitter: MultiSelect element produces selectionType=Multi on Coded field', () => {
  const entities = {
    org_name: 'X',
    subject_types: [{ name: 'S', type: 'Person' }],
    forms: [{
      name: 'IndividualProfile - S',
      formType: 'IndividualProfile',
      subjectType: 'S',
      formElementGroups: [{
        name: 'A', displayOrder: 1,
        formElements: [{
          name: 'F', displayOrder: 1, type: 'MultiSelect',
          concept: { name: 'F', dataType: 'Coded', answers: [{ name: 'X' }, { name: 'Y' }] },
        }],
      }],
    }],
  };
  const y = entitiesToSpec(entities, 'X');
  const back = specToEntities(y);
  assert.equal(back.subject_types.length, 1);
  // We don't currently round-trip selectionType through parser (parser doesn't read it),
  // but emitted YAML must contain it
  assert.match(y, /selectionType: Multi/);
});

// ─── Form-level rules ───────────────────────────────────────────────

test('emitter: form-level decisionRule / validationRule / visitScheduleRule preserved', () => {
  const entities = {
    org_name: 'X',
    subject_types: [{ name: 'S', type: 'Person' }],
    forms: [{
      name: 'IndividualProfile - S',
      formType: 'IndividualProfile',
      subjectType: 'S',
      decisionRule: "'use strict'; ({params}) => ({});",
      validationRule: "'use strict'; ({params}) => [];",
      visitScheduleRule: "'use strict'; ({params}) => [];",
      formElementGroups: [{
        name: 'A', displayOrder: 1,
        formElements: [{ name: 'F', displayOrder: 1, concept: { name: 'F', dataType: 'Text' } }],
      }],
    }],
  };
  const y = entitiesToSpec(entities, 'X');
  assert.match(y, /decisionRule:/);
  assert.match(y, /validationRule:/);
  assert.match(y, /visitScheduleRule:/);
});

// ─── Voided elements/groups ─────────────────────────────────────────

test('emitter: voided formElements + groups skipped', () => {
  const entities = {
    org_name: 'X',
    subject_types: [{ name: 'S', type: 'Person' }],
    forms: [{
      name: 'IndividualProfile - S',
      formType: 'IndividualProfile',
      subjectType: 'S',
      formElementGroups: [
        {
          name: 'A', displayOrder: 1,
          formElements: [
            { name: 'Live', displayOrder: 1, concept: { name: 'Live', dataType: 'Text' } },
            { name: 'Dead', displayOrder: 2, voided: true, concept: { name: 'Dead', dataType: 'Text' } },
          ],
        },
        { name: 'B', displayOrder: 2, voided: true, formElements: [] },
      ],
    }],
  };
  const y = entitiesToSpec(entities, 'X');
  const back = specToEntities(y);
  // Voided group gone; voided element gone
  const form = back.forms[0];
  assert.equal(form.formElementGroups.length, 1);
  assert.equal(form.formElementGroups[0].formElements.length, 1);
  assert.equal(form.formElementGroups[0].formElements[0].name, 'Live');
});
