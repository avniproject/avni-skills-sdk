"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { generate } = require("./lib/fixture.cjs");

const STD_YES = "e1018fd6-6a74-45e5-9191-6dec7647d817";
const STD_NO  = "cca1df60-04c2-497c-a5ad-47438ae9fb7c";

const VALID_DATA_TYPES = new Set([
  "Numeric","Text","Notes","Coded","NA","Date","DateTime","Time",
  "Image","Video","Subject","Id","Audio","File","Location","PhoneNumber","Duration","Encounter",
]);

describe("Concepts", () => {

  test("one question concept per form-element row", () => {
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name", "Data Type"],
          ["Name", "Text"],
          ["Age", "Numeric"],
          ["DOB", "Date"],
        ],
      },
    });
    for (const name of ["Name", "Age", "DOB"]) {
      assert.ok(b.conceptByName.get(name), `${name} concept exists`);
    }
  });

  test("concept dataType matches form Data Type column", () => {
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name", "Data Type"],
          ["Q1", "Text"],
          ["Q2", "Numeric"],
          ["Q3", "Date"],
        ],
      },
    });
    assert.equal(b.conceptByName.get("Q1").dataType, "Text");
    assert.equal(b.conceptByName.get("Q2").dataType, "Numeric");
    assert.equal(b.conceptByName.get("Q3").dataType, "Date");
  });

  test("Coded concept produces answer concepts (dataType=NA) for each option", () => {
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name", "Data Type", "Pre added Options Datatype",
           "Mandatory (default No)", "User entered / System generated",
           "If Numeric Data Type\n\nAllow Negative values","If Numeric Data Type\n\nAllow Decimal?",
           "If Numeric Max and Min Limit","Unit (In kg, INR, ml etc)",
           "If Date allow Current Date?","If Date allow Future Date?","If Date allow Past Date?",
           "Pre added Options Selection Type","OPTIONS (needed for Single Select and Multi Select)"],
          ["Status", "Coded", "", "Yes", "User entered ", "", "", "", "", "", "", "", "Single Select", "Active\nInactive\nUnknown"],
        ],
      },
    });
    const status = b.conceptByName.get("Status");
    assert.equal(status.dataType, "Coded");
    assert.ok(status.answers && status.answers.length >= 3, `Status has ${status.answers?.length} answers`);
    const answerNames = status.answers.map(a => a.name);
    assert.deepEqual(answerNames.sort(), ["Active", "Inactive", "Unknown"]);
    // each answer concept should be Coded-NA
    for (const a of status.answers) {
      const ac = b.conceptByUuid.get(a.uuid);
      assert.ok(ac, `answer concept ${a.name} exists`);
      assert.equal(ac.dataType, "NA");
    }
  });

  test("Yes/No coded answers use STANDARD_UUIDs (no duplicate Yes/No concepts)", () => {
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name","Data Type","Pre added Options Datatype",
           "Mandatory (default No)","User entered / System generated",
           "If Numeric Data Type\n\nAllow Negative values","If Numeric Data Type\n\nAllow Decimal?",
           "If Numeric Max and Min Limit","Unit (In kg, INR, ml etc)",
           "If Date allow Current Date?","If Date allow Future Date?","If Date allow Past Date?",
           "Pre added Options Selection Type","OPTIONS (needed for Single Select and Multi Select)"],
          ["Pregnant", "Coded", "", "Yes", "", "", "", "", "", "", "", "", "Single Select", "Yes\nNo"],
        ],
      },
    });
    const yes = b.concepts.filter(c => c.name === "Yes");
    const no  = b.concepts.filter(c => c.name === "No");
    assert.equal(yes.length, 1);
    assert.equal(no.length, 1);
    assert.equal(yes[0].uuid, STD_YES);
    assert.equal(no[0].uuid, STD_NO);
  });

  test("'Pre added Options' literal does NOT leak into concepts (Bug 1 fix)", () => {
    // Reproduce the JK Laxmi pattern: SRS row with Data Type = "Pre added Options"
    // (i.e., the column header text used as a value).
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name", "Data Type"],
          ["X", "Pre added Options"],
        ],
      },
    });
    assert.equal(b.concepts.filter(c => /^pre\s*added\s*options/i.test(c.name)).length, 0);
  });

  test("'In case of X do not show ...' validation text does NOT leak as answer concepts (Bug 1 fix)", () => {
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name","Data Type","Pre added Options Datatype",
           "Mandatory (default No)","User entered / System generated",
           "If Numeric Data Type\n\nAllow Negative values","If Numeric Data Type\n\nAllow Decimal?",
           "If Numeric Max and Min Limit","Unit (In kg, INR, ml etc)",
           "If Date allow Current Date?","If Date allow Future Date?","If Date allow Past Date?",
           "Pre added Options Selection Type","OPTIONS (needed for Single Select and Multi Select)",
           "Unique option for multi-select","Option condition/Validation"],
          ["Scheme", "Coded", "", "Yes", "", "", "", "", "", "", "", "", "Single Select",
           "1. PMMVY\n2. JSSY\n3. PMSMA",
           "",
           "In case of Gravida do not show 2,3,5 scheme option"],
        ],
      },
    });
    // None of the junk substrings should appear as concept names
    const junkPatterns = [
      /^in\s+case\s+of/i,
      /^[0-9]+\s+scheme\s+option$/i,
    ];
    for (const c of b.concepts) {
      for (const p of junkPatterns) {
        assert.ok(!p.test(c.name), `Concept "${c.name}" matches junk pattern ${p}`);
      }
    }
  });

  test("every concept has a valid dataType (server contract)", () => {
    const b = generate({
      formsSheets: {
        F: [
          ["Field Name", "Data Type", "Pre added Options Datatype",
           "Mandatory (default No)", "User entered / System generated",
           "If Numeric Data Type\n\nAllow Negative values","If Numeric Data Type\n\nAllow Decimal?",
           "If Numeric Max and Min Limit","Unit (In kg, INR, ml etc)",
           "If Date allow Current Date?","If Date allow Future Date?","If Date allow Past Date?",
           "Pre added Options Selection Type","OPTIONS (needed for Single Select and Multi Select)"],
          ["X","Coded","","Y","","","","","","","","","Single Select","A\nB"],
          ["Y","Numeric","","Y","","","","","","","","","",""],
          ["Z","Text","","Y","","","","","","","","","",""],
        ],
      },
    });
    for (const c of b.concepts) {
      assert.ok(VALID_DATA_TYPES.has(c.dataType), `invalid dataType "${c.dataType}" on concept "${c.name}"`);
    }
  });

  test("concept UUIDs are deterministic across runs", () => {
    const sheets = { formsSheets: { F: [["Field Name","Data Type"],["StableConcept","Text"]] } };
    const a = generate(sheets);
    const b = generate(sheets);
    assert.equal(a.conceptByName.get("StableConcept").uuid, b.conceptByName.get("StableConcept").uuid);
  });

});
