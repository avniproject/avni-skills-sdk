"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { generate } = require("./lib/fixture.cjs");

describe("Forms", () => {

  test("each forms-file sheet (data-bearing) becomes one form", () => {
    const b = generate({
      formsSheets: {
        "Form A": [["Field Name", "Data Type"], ["a1", "Text"]],
        "Form B": [["Field Name", "Data Type"], ["b1", "Numeric"]],
      },
    });
    assert.ok(b.forms.has("Form A"));
    assert.ok(b.forms.has("Form B"));
  });

  test("every form has uuid, name, formType, formElementGroups", () => {
    const b = generate({
      formsSheets: {
        "Form X": [["Field Name", "Data Type"], ["q", "Text"]],
      },
    });
    const f = b.forms.get("Form X");
    assert.ok(f.uuid);
    assert.ok(f.name);
    assert.ok(f.formType);
    assert.ok(Array.isArray(f.formElementGroups));
  });

  test("registration sheets get formType=IndividualProfile", () => {
    const b = generate({
      formsSheets: {
        "Beneficiary Registration": [["Field Name", "Data Type"], ["Name", "Text"]],
      },
    });
    const f = b.forms.get("Beneficiary Registration");
    assert.equal(f.formType, "IndividualProfile");
  });

  test("Enrolment-form sheets get formType=ProgramEnrolment", () => {
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
    const f = b.forms.get("Maternal Enrolment");
    assert.equal(f.formType, "ProgramEnrolment");
  });

  test("ProgramEncounter forms reference a registered program (no dangling programUUID)", () => {
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
    const mapping = b.formMappings.find(m => m.formName === "ANC Visit");
    assert.ok(mapping.programUUID, "ANC Visit form has programUUID");
    const knownProgUuids = new Set(b.programs.map(p => p.uuid));
    assert.ok(knownProgUuids.has(mapping.programUUID), "programUUID references a real program");
  });

  test("cancellation forms are auto-generated for each encounter type", () => {
    const b = generate({
      formsSheets: {
        "Field Visit": [["Field Name", "Data Type"], ["N", "Text"]],
      },
      modellingSheets: {
        "Subject Types": [["Subject Type Name", "Type"], ["W", "Person"]],
        Encounters: [["Encounter Name", "Subject Type"], ["Field Visit", "W"]],
      },
    });
    const cancellationForms = [...b.forms.keys()].filter(n => /Cancellation/i.test(n));
    assert.ok(cancellationForms.length > 0, "at least one cancellation form was generated");
  });

  test("form deterministic UUID — same SRS, same UUIDs", () => {
    const sheets = {
      formsSheets: { "F": [["Field Name", "Data Type"], ["x", "Text"]] },
    };
    const a = generate(sheets);
    const b = generate(sheets);
    assert.equal(a.forms.get("F").uuid, b.forms.get("F").uuid);
  });

});
