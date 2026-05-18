// Location Hierarchy parser tests.
//
// Generator contract: rows in the Modelling sheet's Location Hierarchy that
// are NOT valid level identifiers must be skipped. AVNI's LocationService
// rejects names that are URLs, hierarchy-chain arrows, parenthesized
// descriptions, or "Hierarchy"-suffixed section headers. Filtering at the
// generator keeps bundle deploys from aborting on the first file.
//
// Regression: 2026-05-15 Astitva upload failed because a Google Drive URL
// row was emitted as a level name (see project_avni_skills_sdk_demo.md).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { generate } = require("./lib/fixture.cjs");

// Minimal forms workbook so the generator has *something* to process.
const FORMS = {
  "Beneficiary Registration": [
    ["Section", "Question", "Type", "Mandatory"],
    ["Demographics", "Name", "Text", "Yes"],
  ],
};

test("location hierarchy: skips URL rows (AVNI rejects them)", () => {
  const bundle = generate({
    formsSheets: FORMS,
    modellingSheets: {
      "Subject Types": [["Subject Type Name", "Type"], ["Individual", "Person"]],
      "Location Hierarchy": [
        ["Location Type"],
        ["District"],
        ["Block"],
        ["https://drive.google.com/file/d/abc/view?usp=drive_link"],
        ["Village"],
      ],
    },
  });
  const names = bundle.addressLevelTypes.map((a) => a.name);
  assert.deepEqual(names, ["District", "Block", "Village"]);
  fs.rmSync(bundle.__outDir, { recursive: true, force: true });
});

test("location hierarchy: skips arrow-spec rows (descriptions, not names)", () => {
  const bundle = generate({
    formsSheets: FORMS,
    modellingSheets: {
      "Subject Types": [["Subject Type Name", "Type"], ["Individual", "Person"]],
      "Location Hierarchy": [
        ["Location Type"],
        ["District"],
        ["District → Block → Village"], // hierarchy description, not a level
        ["Block"],
        ["Village"],
      ],
    },
  });
  const names = bundle.addressLevelTypes.map((a) => a.name);
  assert.deepEqual(names, ["District", "Block", "Village"]);
  fs.rmSync(bundle.__outDir, { recursive: true, force: true });
});

test("location hierarchy: skips parenthesized descriptions and Hierarchy headers", () => {
  const bundle = generate({
    formsSheets: FORMS,
    modellingSheets: {
      "Subject Types": [["Subject Type Name", "Type"], ["Individual", "Person"]],
      "Location Hierarchy": [
        ["Location Type"],
        ["Nourish Location Hierarchy"], // ends with "Hierarchy" — section header
        ["(District -> Block -> Village)"], // parenthesized AND arrow-spec
        ["District"],
        ["Village"],
      ],
    },
  });
  const names = bundle.addressLevelTypes.map((a) => a.name);
  assert.deepEqual(names, ["District", "Village"]);
  fs.rmSync(bundle.__outDir, { recursive: true, force: true });
});

test("location hierarchy: levels and isRegistrationLocation use the filtered count", () => {
  const bundle = generate({
    formsSheets: FORMS,
    modellingSheets: {
      "Subject Types": [["Subject Type Name", "Type"], ["Individual", "Person"]],
      "Location Hierarchy": [
        ["Location Type"],
        ["District"],
        ["https://example.com/doc"], // skipped
        ["Block"],
        ["Village"],
      ],
    },
  });
  assert.equal(bundle.addressLevelTypes.length, 3);
  // 3 accepted rows ⇒ levels 3 (District), 2 (Block), 1 (Village, registration)
  const byName = Object.fromEntries(bundle.addressLevelTypes.map((a) => [a.name, a]));
  assert.equal(byName.District.level, 3);
  assert.equal(byName.Block.level, 2);
  assert.equal(byName.Village.level, 1);
  assert.equal(byName.District.isRegistrationLocation, false);
  assert.equal(byName.Village.isRegistrationLocation, true);
  // Parent chain reflects filtered order, not original row indices.
  assert.equal(byName.Block.parent.uuid, byName.District.uuid);
  assert.equal(byName.Village.parent.uuid, byName.Block.uuid);
  fs.rmSync(bundle.__outDir, { recursive: true, force: true });
});

test("location hierarchy: every-row-invalid falls back to AVNI default (not garbage)", () => {
  // When the Modelling sheet's Location Hierarchy contains only junk rows
  // (the Astitva 2026-05-15 case), the parser filters them all out. The
  // writer then falls back to the standard State→District→Block→Village
  // default. This is preferable to emitting an invalid bundle the AVNI
  // server rejects, and the user can override later via a session turn.
  const bundle = generate({
    formsSheets: FORMS,
    modellingSheets: {
      "Subject Types": [["Subject Type Name", "Type"], ["Individual", "Person"]],
      "Location Hierarchy": [
        ["Location Type"],
        ["Nourish Location Hierarchy"],
        ["(District -> Block -> Hamlet)"],
        ["https://drive.google.com/file/d/abc/view"],
      ],
    },
  });
  const names = bundle.addressLevelTypes.map((a) => a.name);
  assert.deepEqual(names, ["State", "District", "Block", "Village"]);
  fs.rmSync(bundle.__outDir, { recursive: true, force: true });
});
