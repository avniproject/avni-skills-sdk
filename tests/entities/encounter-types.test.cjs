"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { generate } = require("./lib/fixture.cjs");

describe("Encounter Types", () => {

  test("regular (non-program) Encounters: formMapping has no programUUID", () => {
    // encounterTypes.json doesn't carry programName (it's an internal-only
    // field stripped at write time per the AVNI server schema). The canonical
    // way to test encounter↔program is via formMappings, which carry both
    // encounterTypeUUID AND programUUID. For a regular (non-program) encounter,
    // programUUID should be absent.
    const b = generate({
      formsSheets: {
        "Field Visit": [
          ["Field Name", "Data Type"],
          ["Notes", "Text"],
        ],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["Worker", "Person"]],
        Encounters: [
          ["Encounter Name", "Subject Type"],
          ["Field Visit", "Worker"],
        ],
      },
    });
    const e = b.encounterTypes.find(x => x.name === "Field Visit");
    assert.ok(e, "Field Visit encounter type registered");
    const m = b.formMappings.find(x => x.formName === "Field Visit");
    assert.ok(m, "formMapping for Field Visit exists");
    assert.equal(m.formType, "Encounter");
    assert.equal(m.programUUID ?? null, null, "non-program encounter has no programUUID");
    assert.equal(m.encounterTypeUUID, e.uuid, "encounterTypeUUID matches encounter");
  });

  test("Program Encounters: formMapping links encounter ↔ program", () => {
    const b = generate({
      formsSheets: {
        "ANC Visit": [
          ["Field Name", "Data Type"],
          ["Weeks", "Numeric"],
        ],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["Mother", "Person"]],
        Program: [
          ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
          ["Maternal", "M Enrol", "M Exit", "", "Mother"],
        ],
        "Program Encounters": [
          ["Encounter Name", "Program name"],
          ["ANC Visit", "Maternal"],
        ],
      },
    });
    const e = b.encounterTypes.find(x => x.name === "ANC Visit");
    const program = b.programs.find(p => p.name === "Maternal");
    const m = b.formMappings.find(x => x.formName === "ANC Visit");
    assert.ok(e && program && m, "encounter, program, and mapping all exist");
    assert.equal(m.formType, "ProgramEncounter");
    assert.equal(m.encounterTypeUUID, e.uuid);
    assert.equal(m.programUUID, program.uuid, "formMapping links to the right program");
  });

  test("operationalEncounterTypes wraps each encounter (server-contract: wrapped object form)", () => {
    const b = generate({
      formsSheets: { "X": [["Field Name", "Data Type"], ["A", "Text"]] },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["S", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["X", "S"]],
      },
    });
    const op = b.operationalEncounterTypes.find(o => o.name === "X");
    assert.ok(op, "operationalEncounterTypes wraps the X encounter");
    assert.ok(op.encounterType?.uuid, "op-encounter has encounterType.uuid back-reference");
  });

  test("encounterTypes referenced by formMappings all exist (no dangling refs)", () => {
    const b = generate({
      formsSheets: {
        "ANC Visit": [["Field Name", "Data Type"], ["W", "Numeric"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["M", "Person"]],
        Program: [
          ["Program Name", "Enrolment Form", "Exit Form", "Description", "Target Subject Type"],
          ["P", "EE", "XX", "", "M"],
        ],
        "Program Encounters": [["Encounter Name", "Program name"], ["ANC Visit", "P"]],
      },
    });
    const knownEncUuids = new Set(b.encounterTypes.map(e => e.uuid));
    const dangling = b.formMappings.filter(m => m.encounterTypeUUID && !knownEncUuids.has(m.encounterTypeUUID));
    assert.equal(dangling.length, 0, `${dangling.length} formMappings reference unknown encounter UUIDs`);
  });

});
