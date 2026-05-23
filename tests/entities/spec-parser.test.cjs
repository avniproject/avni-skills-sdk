// Tests for avni-skills/srs-bundle-generator/spec/parser.js — YAML → entities.
//
// The parser lives in avni-skills (the brain — see CLAUDE.md §3). Tests live
// here in the SDK because the SDK is where the test framework lives. Loaded
// via AVNI_SKILLS_PATH.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'avni-skills');

const PARSER = path.join(AVNI_SKILLS_PATH, 'srs-bundle-generator', 'spec', 'parser.js');
const { specToEntities } = require(PARSER);

// ─── Top-level shape ────────────────────────────────────────────────

test('empty YAML mapping → default entities shape', () => {
  const out = specToEntities('org: ""');
  assert.equal(out.org_name, '');
  assert.deepEqual(out.subject_types, []);
  assert.deepEqual(out.programs, []);
  assert.deepEqual(out.encounter_types, []);
  assert.deepEqual(out.address_levels, []);
  // groups defaults to single Everyone entry when not specified
  assert.deepEqual(out.groups, [{ name: 'Everyone', has_all_privileges: false }]);
  assert.deepEqual(out.forms, []);
});

test('throws on non-mapping top-level', () => {
  assert.throws(() => specToEntities('- one\n- two'), /must be a YAML mapping/);
});

test('throws on malformed YAML', () => {
  assert.throws(() => specToEntities(': : :'), /Invalid YAML/);
});

// ─── addressLevels ──────────────────────────────────────────────────

test('addressLevels parsed with level + parent', () => {
  const yaml = `
org: "X"
addressLevels:
  - name: State
    level: 4
  - name: District
    level: 3
    parent: State
`;
  const out = specToEntities(yaml);
  assert.equal(out.address_levels.length, 2);
  assert.equal(out.address_levels[0].name, 'State');
  assert.equal(out.address_levels[0].level, 4);
  assert.equal(out.address_levels[0].parent, null);
  assert.equal(out.address_levels[1].parent, 'State');
});

test('addressLevels: missing level defaults to 1', () => {
  const out = specToEntities('addressLevels:\n  - name: Village\n');
  assert.equal(out.address_levels[0].level, 1);
});

// ─── subjectTypes ───────────────────────────────────────────────────

test('subjectTypes: minimal Person with sane defaults', () => {
  const yaml = `
subjectTypes:
  - name: Beneficiary
    type: Person
`;
  const out = specToEntities(yaml);
  assert.equal(out.subject_types.length, 1);
  const st = out.subject_types[0];
  assert.equal(st.name, 'Beneficiary');
  assert.equal(st.type, 'Person');
  assert.equal(st.allowProfilePicture, false);
  assert.equal(st.uniqueName, false);
  assert.equal(st.lastNameOptional, true);  // default
});

test('subjectTypes: truthy boolean fields preserved, falsy dropped', () => {
  const yaml = `
subjectTypes:
  - name: Household
    type: Household
    group: true
    household: true
    allowEmptyLocation: true
    allowMiddleName: false
`;
  const out = specToEntities(yaml);
  const st = out.subject_types[0];
  assert.equal(st.group, true);
  assert.equal(st.household, true);
  assert.equal(st.allowEmptyLocation, true);
  assert.ok(!('allowMiddleName' in st), 'allowMiddleName:false should not be emitted');
});

test('subjectTypes: passthrough fields preserved', () => {
  const yaml = `
subjectTypes:
  - name: X
    iconFileS3Key: "s3://b/k.png"
    syncRegistrationConcept1: "uuid-1"
    subjectSummaryRule: |
      'use strict'; ({params}) => null;
    validFirstNameFormat:
      regex: "^[A-Z].*"
      descriptionKey: "Must start caps"
`;
  const out = specToEntities(yaml);
  const st = out.subject_types[0];
  assert.equal(st.iconFileS3Key, 's3://b/k.png');
  assert.equal(st.syncRegistrationConcept1, 'uuid-1');
  assert.match(st.subjectSummaryRule, /use strict/);
  assert.deepEqual(st.validFirstNameFormat, { regex: '^[A-Z].*', descriptionKey: 'Must start caps' });
});

test('subjectTypes: registrationForm becomes IndividualProfile form', () => {
  const yaml = `
subjectTypes:
  - name: Beneficiary
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
  const out = specToEntities(yaml);
  assert.equal(out.forms.length, 1);
  const f = out.forms[0];
  assert.equal(f.formType, 'IndividualProfile');
  assert.equal(f.subjectType, 'Beneficiary');
  assert.equal(f.name, 'IndividualProfile - Beneficiary');
  assert.equal(f.formElementGroups.length, 1);
  const grp = f.formElementGroups[0];
  assert.equal(grp.name, 'Identity');
  assert.equal(grp.formElements.length, 2);
  assert.equal(grp.formElements[0].name, 'Full Name');
  assert.equal(grp.formElements[0].mandatory, true);
  assert.equal(grp.formElements[1].concept.lowAbsolute, 0);
  assert.equal(grp.formElements[1].concept.hiAbsolute, 120);
  assert.equal(grp.formElements[1].concept.unit, 'years');
});

// ─── programs ───────────────────────────────────────────────────────

test('programs: name, target, colour default, enrolmentForm + exitForm', () => {
  const yaml = `
programs:
  - name: Antenatal Care
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
  const out = specToEntities(yaml);
  assert.equal(out.programs.length, 1);
  assert.equal(out.programs[0].colour, '#4A148C');  // default
  assert.equal(out.programs[0].allow_multiple_enrolments, false);
  assert.equal(out.forms.length, 2);
  const types = out.forms.map((f) => f.formType).sort();
  assert.deepEqual(types, ['ProgramEnrolment', 'ProgramExit']);
  // Coded field generates concept.answers
  const exit = out.forms.find((f) => f.formType === 'ProgramExit');
  assert.deepEqual(
    exit.formElementGroups[0].formElements[0].concept.answers,
    [{ name: 'Live' }, { name: 'Stillbirth' }],
  );
});

// ─── encounterTypes ─────────────────────────────────────────────────

test('encounterTypes: program-less → Encounter formType', () => {
  const yaml = `
encounterTypes:
  - name: Home Visit
    subjectType: Beneficiary
    form:
      sections:
        - {name: Visit, fields: [{name: Note, dataType: Text}]}
`;
  const out = specToEntities(yaml);
  assert.equal(out.encounter_types[0].is_program_encounter, false);
  assert.equal(out.forms[0].formType, 'Encounter');
});

test('encounterTypes: with program → ProgramEncounter formType', () => {
  const yaml = `
encounterTypes:
  - name: ANC Visit
    program: Antenatal Care
    subjectType: Mother
    form:
      sections:
        - {name: Visit, fields: [{name: BP, dataType: Numeric}]}
    cancellationForm:
      sections:
        - {name: Why, fields: [{name: Reason, dataType: Text}]}
`;
  const out = specToEntities(yaml);
  assert.equal(out.encounter_types[0].is_program_encounter, true);
  assert.equal(out.forms.length, 2);
  const types = out.forms.map((f) => f.formType).sort();
  assert.deepEqual(types, ['ProgramEncounter', 'ProgramEncounterCancellation']);
});

test('encounterTypes: cancellationForm + no program → IndividualEncounterCancellation', () => {
  const yaml = `
encounterTypes:
  - name: Home Visit
    subjectType: X
    cancellationForm:
      sections: [{name: Why, fields: [{name: Reason, dataType: Text}]}]
`;
  const out = specToEntities(yaml);
  assert.equal(out.forms[0].formType, 'IndividualEncounterCancellation');
});

// ─── groups + passthrough ───────────────────────────────────────────

test('groups: custom group overrides Everyone default', () => {
  const yaml = `
groups:
  - name: Administrator
    hasAllPrivileges: true
  - name: FieldWorker
`;
  const out = specToEntities(yaml);
  assert.equal(out.groups.length, 2);
  assert.equal(out.groups[0].has_all_privileges, true);
  assert.equal(out.groups[1].has_all_privileges, false);
});

test('passthrough sections (menuItems, messageRules, …) preserved verbatim', () => {
  const yaml = `
menuItems:
  - displayKey: Reports
    type: dashboard
messageRules:
  - name: Birthday
    receiverType: Subject
groupPrivileges:
  - groupName: Administrator
    privileges: [{type: ViewSubject}]
`;
  const out = specToEntities(yaml);
  assert.equal(out.menu_items[0].displayKey, 'Reports');
  assert.equal(out.message_rules[0].name, 'Birthday');
  assert.equal(out.group_privileges[0].groupName, 'Administrator');
});

// ─── form-element field shorthand (string vs object) ───────────────

test('field shorthand: string field name → Text dataType default', () => {
  // The Python parser handles fields[fidx] being a bare string. Same here.
  const yaml = `
subjectTypes:
  - name: X
    registrationForm:
      sections:
        - name: A
          fields:
            - JustAName
            - {name: AsObject}
`;
  const out = specToEntities(yaml);
  const elements = out.forms[0].formElementGroups[0].formElements;
  assert.equal(elements[0].name, 'JustAName');
  assert.equal(elements[0].dataType, 'Text');
  assert.equal(elements[0].mandatory, false);
  assert.equal(elements[1].name, 'AsObject');
});
