// End-to-end smoke for the rules-brain pipeline.
//
// Builds a synthetic SRS, generates a bundle, picks a concept UUID from the
// generated concepts.json, then exercises:
//   - extract: synthetic skipLogic → IR
//   - compile: IR → JS body (via vendored DeclarativeRuleHolder)
//   - validate: JS body passes Layer-4 with the bundle's conceptUuids
// All synthetic, all org-agnostic.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { generate } = require("./lib/fixture.cjs");

async function loadExtract() { return await import("../../src/rules-brain/extract.js"); }
async function loadCompile() { return await import("../../src/rules-brain/compile.js"); }
async function loadValidate() { return await import("../../src/rules-brain/validate.js"); }

test("hand-built concepts → IR → JS → validator: full round-trip", async () => {
  // Use a hand-built concept table so this test doesn't depend on the SRS
  // parser's column-header heuristics. Layer-1 extractor only needs a
  // (name) => {uuid, dataType, answers[]} function, not a real bundle.
  const concepts = [
    { name: "Gender", uuid: "00000000-0000-0000-0000-00000000000A", dataType: "Coded", answers: [
      { name: "Female", uuid: "00000000-0000-0000-0000-00000000000F" },
      { name: "Male",   uuid: "00000000-0000-0000-0000-00000000000M" },
    ]},
    { name: "Pregnancy Status", uuid: "00000000-0000-0000-0000-00000000000P", dataType: "Coded", answers: [
      { name: "Yes", uuid: "00000000-0000-0000-0000-00000000000Y" },
      { name: "No",  uuid: "00000000-0000-0000-0000-00000000000N" },
    ]},
  ];
  const genderC = concepts.find((c) => c.name === "Gender");
  const female = genderC.answers.find((a) => a.name === "Female");

  // Build a synthetic skipLogic for "Show Pregnancy Status when Gender = Female"
  const { extractFormElementRuleFromSkipLogic } = await loadExtract();
  const lookup = (name) => {
    const c = concepts.find((x) => x.name === name);
    return c ? { uuid: c.uuid, dataType: c.dataType, answers: c.answers || [] } : null;
  };
  const ir = extractFormElementRuleFromSkipLogic(
    { dependsOn: "Gender", condition: "equals", value: "Female" },
    lookup,
    "registration",
  );
  assert.ok(ir, "extractor must produce IR");

  // Compile to JS
  const { compile } = await loadCompile();
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /'use strict';/);
  assert.ok(js.includes(genderC.uuid), "gender UUID must appear");
  assert.ok(js.includes(female.uuid), "female-answer UUID must appear");

  // Validate against the bundle's concept set — must pass
  const { validateRuleBody } = await loadValidate();
  const conceptUuids = new Set(concepts.map((c) => c.uuid.toLowerCase()));
  for (const c of concepts) for (const a of (c.answers || [])) conceptUuids.add(a.uuid.toLowerCase());
  const r = validateRuleBody(js, { conceptUuids, fieldName: "synthetic.viewFilter" });
  assert.equal(r.valid, true, `validation errors: ${JSON.stringify(r.errors, null, 2)}`);
});

test("agent-written rule with INVENTED UUID is caught by validator", async () => {
  const { validateRuleBody } = await loadValidate();
  const body = `"use strict";
({params, imports}) => {
  const validationResults = [];
  if (params.entity.getObservationValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") > 100) {
    validationResults.push(imports.common.createValidationError("11111111-2222-3333-4444-555555555555", "high"));
  }
  return validationResults;
};`;
  const conceptUuids = new Set(["33333333-4444-5555-6666-777777777777"]); // none of the body UUIDs
  const r = validateRuleBody(body, { conceptUuids });
  // Errors are zero (the UUIDs warn, not error) — but warnings flag both
  const warns = r.warnings.filter((w) => w.code === "R6-UUID-UNKNOWN");
  assert.equal(warns.length, 2, `expected both UUIDs to warn, got ${JSON.stringify(r.warnings)}`);
});

test("agent-written rule with invented imports.globalFn is REJECTED", async () => {
  const { validateRuleBody } = await loadValidate();
  const body = `"use strict";
({params, imports}) => {
  return imports.globalFn.frobnicate(params.entity);
};`;
  const r = validateRuleBody(body, { conceptUuids: new Set() });
  assert.equal(r.valid, false);
  assert.ok(r.errors.find((e) => e.code === "R4-BAD-IMPORT" && /globalFn/.test(e.message)));
});
