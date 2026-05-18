// Locks down the Layer-3 IR→JS compiler. Org-agnostic: every input here is a
// synthetic DeclarativeRule IR shape, not a real org's data. If this suite
// fails after a vendored-rules-config upgrade, that's the signal to look at
// generator template drift before shipping.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// Compile.js is ESM. Use dynamic import inside each test.
async function load() {
  return await import("../../src/rules-brain/compile.js");
}

const FEMALE_UUID = "00000000-0000-0000-0000-000000000001";
const GENDER_UUID = "00000000-0000-0000-0000-000000000002";
const PREG_UUID   = "00000000-0000-0000-0000-000000000003";

// Helper: minimal IR for "when gender is Female → show form element".
function showWhenFemaleIr() {
  return [{
    conditions: [{
      conjunction: "and",
      compoundRule: {
        conjunction: "and",
        rules: [{
          lhs: {
            type: "Concept",
            conceptName: "Gender",
            conceptUuid: GENDER_UUID,
            conceptDataType: "Coded",
            scope: "registration",
          },
          operator: "containsAnyAnswerConceptName",
          rhs: {
            type: "answerConcept",
            answerConceptNames: ["Female"],
            answerConceptUuids: [FEMALE_UUID],
          },
        }],
      },
    }],
    actions: [{ actionType: "showFormElement", details: {} }],
  }];
}

test("listRuleTypes exposes the six canonical types", async () => {
  const { listRuleTypes } = await load();
  assert.deepEqual(
    listRuleTypes().sort(),
    ["decision", "eligibility", "formElementGroup", "formValidation", "viewFilter", "visitSchedule"]
  );
});

test("unknown rule type returns an error, not a throw", async () => {
  const { compile } = await load();
  const r = compile([], "bogus", "individual");
  assert.equal(r.js, null);
  assert.match(r.error, /unknown ruleType/);
});

test("empty IR compiles to no rule (js: null), no error", async () => {
  const { compile } = await load();
  const r = compile([], "decision", "programEncounter");
  assert.equal(r.js, null);
  assert.equal(r.error, undefined);
});

test("viewFilter (form element rule) emits an arrow function with FormElementStatus", async () => {
  const { compile } = await load();
  const { js, error } = compile(showWhenFemaleIr(), "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.ok(js, "should emit a body");
  assert.match(js, /^'use strict';/);
  assert.match(js, /\(\{params, imports\}\) => \{/);
  assert.match(js, /params\.entity/);
  assert.match(js, /params\.formElement/);
  assert.match(js, /new imports\.rulesConfig\.FormElementStatus/);
  // The Female answer UUID must appear (no inventions, no "undefined")
  assert.ok(js.includes(FEMALE_UUID), `expected ${FEMALE_UUID} in emitted body`);
  assert.ok(!js.includes('"undefined"'), "must not emit literal 'undefined' arg");
});

test("decision rule emits decisions push", async () => {
  const { compile } = await load();
  const ir = showWhenFemaleIr();
  ir[0].actions = [{
    actionType: "addDecision",
    details: {
      scope: "registration",
      conceptName: "Pregnancy Status",
      conceptUuid: PREG_UUID,
      conceptDataType: "Coded",
      value: "Confirmed",
    },
  }];
  const { js, error } = compile(ir, "decision", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /decisions\.registrationDecisions\.push/);
  assert.ok(js.includes(PREG_UUID) || js.includes("Pregnancy Status"));
});

test("visit schedule rule emits VisitScheduleBuilder.getAll()", async () => {
  const { compile } = await load();
  const ir = showWhenFemaleIr();
  ir[0].actions = [{
    actionType: "scheduleVisit",
    details: {
      encounterType: "ANC 2",
      encounterName: "ANC 2",
      dateField: "encounterDateTime",
      // NOTE: upstream rules-config validates these via lodash _.isEmpty which
      // returns true for plain numbers. Strings round-trip correctly through
      // the webapp visual builder. Passing strings here matches production.
      daysToSchedule: "28",
      daysToOverdue: "14",
    },
  }];
  const { js, error } = compile(ir, "visitSchedule", "programEncounter");
  assert.equal(error, undefined, error);
  assert.match(js, /new imports\.rulesConfig\.VisitScheduleBuilder/);
  assert.match(js, /scheduleBuilder\.getAll\(\)/);
});

test("eligibility rule emits boolean return", async () => {
  const { compile } = await load();
  const ir = showWhenFemaleIr();
  ir[0].actions = [{ actionType: "showEncounterType", details: {} }];
  const { js, error } = compile(ir, "eligibility", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /let eligibility = true;/);
  assert.match(js, /return eligibility;/);
});

test("form validation rule emits validationResults array", async () => {
  const { compile } = await load();
  const ir = showWhenFemaleIr();
  ir[0].actions = [{
    actionType: "formValidationError",
    details: { validationError: "Pregnancy status required for female" },
  }];
  const { js, error } = compile(ir, "formValidation", "programEncounter");
  assert.equal(error, undefined, error);
  assert.match(js, /const validationResults = \[\]/);
  assert.match(js, /return validationResults/);
});

test("compileByField maps bundle field → ruleType + entity", async () => {
  const { compileByField } = await load();
  const ir = showWhenFemaleIr();
  ir[0].actions = [{
    actionType: "addDecision",
    details: { scope: "encounter", conceptName: "X", conceptUuid: "uuid-x", conceptDataType: "Text", value: "y" },
  }];
  const { js, error } = compileByField(ir, "form.decisionRule", { formType: "ProgramEncounter" });
  assert.equal(error, undefined, error);
  assert.match(js, /const programEncounter = params\.entity;/);
});

test("validateIr surfaces missing concept name as error", async () => {
  const { validateIr } = await load();
  // LHS.validate() uses _.isNil — empty string passes. Trigger via undefined.
  const broken = [{
    conditions: [{
      conjunction: "and",
      compoundRule: {
        conjunction: "and",
        rules: [{
          // LHS.types.Concept = 'concept' (lowercase value). Validate gates on this exact match.
          lhs: { type: "concept", conceptName: null, conceptUuid: null, conceptDataType: "Coded", scope: "registration" },
          operator: "containsAnyAnswerConceptName",
          rhs: { type: "answerConcept", answerConceptNames: ["F"], answerConceptUuids: ["u"] },
        }],
      },
    }],
    actions: [{ actionType: "showFormElement", details: {} }],
  }];
  const r = validateIr(broken);
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 1, "should report at least one error");
});
