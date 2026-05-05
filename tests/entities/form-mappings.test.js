"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { generate } = require("./lib/fixture");

describe("FormMappings", () => {

  test("each non-cancellation form has one formMapping", () => {
    const b = generate({
      formsSheets: {
        "Beneficiary Registration": [["Field Name", "Data Type"], ["Name", "Text"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["Beneficiary", "Person"]],
      },
    });
    const mappings = b.formMappings.filter(m => m.formName === "Beneficiary Registration");
    assert.equal(mappings.length, 1);
  });

  test("formMapping.formUUID references a real form file", () => {
    const b = generate({
      formsSheets: {
        "Awareness Register": [["Field Name", "Data Type"], ["Topic", "Text"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["B", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Awareness Register", "B"]],
      },
    });
    const formUuids = new Set([...b.forms.values()].map(f => f.uuid));
    for (const m of b.formMappings) {
      if (m.formUUID) {
        assert.ok(formUuids.has(m.formUUID),
          `formMapping ${m.formName} → formUUID ${m.formUUID} not found in any form file`);
      }
    }
  });

  test("formMapping.subjectTypeUUID references a real subject type", () => {
    const b = generate({
      formsSheets: {
        "Awareness Register": [["Field Name", "Data Type"], ["T", "Text"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["Beneficiary", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Awareness Register", "Beneficiary"]],
      },
    });
    const subjectUuids = new Set(b.subjectTypes.map(s => s.uuid));
    for (const m of b.formMappings) {
      if (m.subjectTypeUUID) {
        assert.ok(subjectUuids.has(m.subjectTypeUUID),
          `formMapping ${m.formName} → subjectTypeUUID ${m.subjectTypeUUID} not found`);
      }
    }
  });

  test("ProgramEnrolment formMappings have a programUUID that references a real program", () => {
    const b = generate({
      formsSheets: {
        "Maternal Enrolment": [["Field Name", "Data Type"], ["LMP", "Date"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["M", "Person"]],
        Program: [
          ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
          ["Maternal", "Maternal Enrolment", "", "", "M"],
        ],
      },
    });
    const m = b.formMappings.find(x => x.formName === "Maternal Enrolment");
    assert.equal(m.formType, "ProgramEnrolment");
    assert.ok(m.programUUID, "ProgramEnrolment must carry programUUID");
    const programUuids = new Set(b.programs.map(p => p.uuid));
    assert.ok(programUuids.has(m.programUUID), "programUUID is registered");
  });

  test("ProgramEncounter formMappings have BOTH programUUID and encounterTypeUUID", () => {
    const b = generate({
      formsSheets: {
        "ANC Visit": [["Field Name", "Data Type"], ["W", "Numeric"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["M", "Person"]],
        Program: [
          ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
          ["Maternal", "ME", "MX", "", "M"],
        ],
        "Program Encounters": [["Encounter Name", "Program name"], ["ANC Visit", "Maternal"]],
      },
    });
    const m = b.formMappings.find(x => x.formName === "ANC Visit");
    assert.equal(m.formType, "ProgramEncounter");
    assert.ok(m.programUUID, "programUUID present");
    assert.ok(m.encounterTypeUUID, "encounterTypeUUID present");
    const knownEncs = new Set(b.encounterTypes.map(e => e.uuid));
    assert.ok(knownEncs.has(m.encounterTypeUUID), "encounterTypeUUID resolves");
  });

  test("regular Encounter formMappings have encounterTypeUUID but no programUUID", () => {
    const b = generate({
      formsSheets: {
        "Field Visit": [["Field Name", "Data Type"], ["N", "Text"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["Worker", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Field Visit", "Worker"]],
      },
    });
    const m = b.formMappings.find(x => x.formName === "Field Visit");
    assert.equal(m.formType, "Encounter");
    assert.ok(m.encounterTypeUUID, "encounterTypeUUID present");
    assert.equal(m.programUUID ?? null, null, "no programUUID for non-program encounter");
  });

  test("IndividualEncounterCancellation from explicit sheet has encounterTypeUUID (regression)", () => {
    // When a Forms.xlsx contains an explicit "<X> Cancellation" sheet for a
    // non-program encounter, the addFormMapping path used to skip
    // encounterTypeUUID assignment, leaving the formMapping dangling per
    // server contract. Affected Atul, EKAM, MonkeySports, Gram-Seva.
    // Regression-pinned 2026-05-05.
    const b = generate({
      formsSheets: {
        "Field Visit": [["Field Name", "Data Type"], ["N", "Text"]],
        "Field Visit Cancellation": [["Field Name", "Data Type"], ["Reason", "Text"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["W", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Field Visit", "W"]],
      },
    });
    const m = b.formMappings.find(x => x.formName === "Field Visit Cancellation");
    assert.ok(m, "cancellation formMapping exists");
    assert.equal(m.formType, "IndividualEncounterCancellation");
    assert.ok(m.encounterTypeUUID, "encounterTypeUUID is set");
    const knownEncs = new Set(b.encounterTypes.map(e => e.uuid));
    assert.ok(knownEncs.has(m.encounterTypeUUID), "encounterTypeUUID resolves");
  });

});
