// Layer 1 — SRS → IR extractor tests. Org-agnostic; all SRS inputs synthetic.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return await import("../../src/rules-brain/extract.js");
}
async function loadCompile() {
  return await import("../../src/rules-brain/compile.js");
}

const concepts = {
  Gender:    { uuid: "00000000-0000-0000-0000-00000000G001", dataType: "Coded",   answers: [{ name: "Female", uuid: "00000000-0000-0000-0000-00000000A001" }, { name: "Male", uuid: "00000000-0000-0000-0000-00000000A002" }] },
  Age:       { uuid: "00000000-0000-0000-0000-00000000C002", dataType: "Numeric", answers: [] },
  Pregnancy: { uuid: "00000000-0000-0000-0000-00000000C003", dataType: "Coded",   answers: [{ name: "Yes", uuid: "00000000-0000-0000-0000-00000000A003" }, { name: "No", uuid: "00000000-0000-0000-0000-00000000A004" }] },
};
const conceptLookup = (name) => concepts[name] || null;

test("skipLogic single coded condition → viewFilter IR + compiles", async () => {
  const { extractFormElementRuleFromSkipLogic } = await load();
  const { compile } = await loadCompile();
  // synthetic parsed skipLogic
  const skip = { dependsOn: "Gender", condition: "equals", value: "Female" };
  const ir = extractFormElementRuleFromSkipLogic(skip, conceptLookup, "registration");
  assert.ok(ir, "should produce IR");
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /params\.entity/);
  assert.ok(js.includes(concepts.Gender.uuid));
});

test("skipLogic notDefined emits without RHS", async () => {
  const { extractFormElementRuleFromSkipLogic } = await load();
  const { compile } = await loadCompile();
  const skip = { dependsOn: "Pregnancy", condition: "notDefined" };
  const ir = extractFormElementRuleFromSkipLogic(skip, conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /notDefined/);
});

test("skipLogic numeric comparison emits value RHS", async () => {
  const { extractFormElementRuleFromSkipLogic } = await load();
  const { compile } = await loadCompile();
  const skip = { dependsOn: "Age", condition: "greaterThanOrEquals", value: "18" };
  const ir = extractFormElementRuleFromSkipLogic(skip, conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /greaterThanOrEqualTo/);
  assert.match(js, /18/);
});

test("skipLogic compound AND emits multi-rule compoundRule", async () => {
  const { extractFormElementRuleFromSkipLogic } = await load();
  const { compile } = await loadCompile();
  const skip = {
    compound: true,
    conjunction: "AND",
    parts: [
      { dependsOn: "Gender", condition: "equals", value: "Female" },
      { dependsOn: "Age",    condition: "greaterThanOrEquals", value: "18" },
    ],
  };
  const ir = extractFormElementRuleFromSkipLogic(skip, conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  // both concept UUIDs appear in the body
  assert.ok(js.includes(concepts.Gender.uuid));
  assert.ok(js.includes(concepts.Age.uuid));
});

test("skipLogic with unresolvable field returns null (bail to agent)", async () => {
  const { extractFormElementRuleFromSkipLogic } = await load();
  const skip = { dependsOn: "DoesNotExist", condition: "equals", value: "X" };
  const ir = extractFormElementRuleFromSkipLogic(skip, conceptLookup);
  assert.equal(ir, null);
});

test("skipLogic raw (unparsed prose) returns null", async () => {
  const { extractFormElementRuleFromSkipLogic } = await load();
  const skip = { raw: "If the woman has been to the previous ANC and complained about pain" };
  const ir = extractFormElementRuleFromSkipLogic(skip, conceptLookup);
  assert.equal(ir, null);
});

test("validation min+max emits formValidation IR + compiles", async () => {
  const { extractFormValidationRuleFromRange } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormValidationRuleFromRange({ min: 18, max: 80 }, "Age", conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "formValidation", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /validationResults/);
});

test("validation on coded concept returns null (range applies to numeric only)", async () => {
  const { extractFormValidationRuleFromRange } = await load();
  const ir = extractFormValidationRuleFromRange({ min: 1, max: 2 }, "Gender", conceptLookup);
  assert.equal(ir, null);
});

test("validation with no bounds returns null", async () => {
  const { extractFormValidationRuleFromRange } = await load();
  assert.equal(extractFormValidationRuleFromRange({}, "Age", conceptLookup), null);
  assert.equal(extractFormValidationRuleFromRange(null, "Age", conceptLookup), null);
});
