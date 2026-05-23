// Phase-7 text → structured → IR tests. Closes the SRS-prose ↔ IR loop.
// Org-agnostic: every input is synthetic prose that mimics real Modelling-
// sheet cell text. End goal: text → IR → JS via the rules-brain compile()
// path, all proven in one test.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return await import("../../src/rules-brain/extract.js");
}
async function loadCompile() {
  return await import("../../src/rules-brain/compile.js");
}

const concepts = {
  Gender:    { uuid: "00000000-0000-0000-0000-00000000G001", dataType: "Coded",
               answers: [{ name: "Female", uuid: "00000000-0000-0000-0000-00000000A001" },
                         { name: "Male",   uuid: "00000000-0000-0000-0000-00000000A002" },
                         { name: "Other",  uuid: "00000000-0000-0000-0000-00000000A003" }] },
  Age:       { uuid: "00000000-0000-0000-0000-00000000C002", dataType: "Numeric", answers: [] },
  Weight:    { uuid: "00000000-0000-0000-0000-00000000C003", dataType: "Numeric", answers: [] },
  Pregnancy: { uuid: "00000000-0000-0000-0000-00000000C004", dataType: "Coded",
               answers: [{ name: "Yes", uuid: "00000000-0000-0000-0000-00000000A004" },
                         { name: "No",  uuid: "00000000-0000-0000-0000-00000000A005" }] },
  Name:      { uuid: "00000000-0000-0000-0000-00000000C005", dataType: "Text", answers: [] },
};
const conceptLookup = (name) => concepts[name] || null;

// ═══════════════════════════════════════════════════════════════════════
// parseConditionText — text shape parser
// ═══════════════════════════════════════════════════════════════════════

test("parseConditionText: simple equals (=)", async () => {
  const { parseConditionText } = await load();
  assert.deepEqual(parseConditionText("Gender = Female"), {
    dependsOn: "Gender", condition: "equals", value: "Female",
  });
});

test("parseConditionText: 'is' as equals synonym", async () => {
  const { parseConditionText } = await load();
  assert.deepEqual(parseConditionText("Gender is Female"), {
    dependsOn: "Gender", condition: "equals", value: "Female",
  });
});

test("parseConditionText: 'equals' word form", async () => {
  const { parseConditionText } = await load();
  assert.deepEqual(parseConditionText("Gender equals Female"), {
    dependsOn: "Gender", condition: "equals", value: "Female",
  });
});

test("parseConditionText: not-equals variants (!=, <>, ≠)", async () => {
  const { parseConditionText } = await load();
  for (const op of ["!=", "<>", "≠"]) {
    const r = parseConditionText(`Gender ${op} Female`);
    assert.equal(r.condition, "notEquals", `op="${op}"`);
    assert.equal(r.value, "Female");
  }
});

test("parseConditionText: numeric comparisons", async () => {
  const { parseConditionText } = await load();
  assert.deepEqual(parseConditionText("Age >= 18"), {
    dependsOn: "Age", condition: "greaterThanOrEquals", value: "18",
  });
  assert.deepEqual(parseConditionText("Age > 18"), {
    dependsOn: "Age", condition: "greaterThan", value: "18",
  });
  assert.deepEqual(parseConditionText("Weight <= 5"), {
    dependsOn: "Weight", condition: "lessThanOrEquals", value: "5",
  });
  assert.deepEqual(parseConditionText("Weight < 1"), {
    dependsOn: "Weight", condition: "lessThan", value: "1",
  });
});

test("parseConditionText: unicode comparison operators (≥, ≤)", async () => {
  const { parseConditionText } = await load();
  assert.equal(parseConditionText("Age ≥ 18").condition, "greaterThanOrEquals");
  assert.equal(parseConditionText("Weight ≤ 50").condition, "lessThanOrEquals");
});

test("parseConditionText: 'is defined' / 'is not defined'", async () => {
  const { parseConditionText } = await load();
  assert.deepEqual(parseConditionText("Pregnancy is defined"), {
    dependsOn: "Pregnancy", condition: "defined",
  });
  assert.deepEqual(parseConditionText("Pregnancy is not defined"), {
    dependsOn: "Pregnancy", condition: "notDefined",
  });
});

test("parseConditionText: 'is empty' / 'is not empty' synonyms", async () => {
  const { parseConditionText } = await load();
  assert.equal(parseConditionText("Pregnancy is empty").condition, "notDefined");
  assert.equal(parseConditionText("Pregnancy is not empty").condition, "defined");
});

test("parseConditionText: 'in (a, b, c)' → containsAny + list value", async () => {
  const { parseConditionText } = await load();
  const r = parseConditionText("Gender in (Female, Male)");
  assert.equal(r.condition, "containsAny");
  assert.deepEqual(r.value, ["Female", "Male"]);
});

test("parseConditionText: 'in a, b' (no parens) still works", async () => {
  const { parseConditionText } = await load();
  const r = parseConditionText("Gender in Female, Male");
  assert.deepEqual(r.value, ["Female", "Male"]);
});

test("parseConditionText: 'not in (a, b)' → notContains", async () => {
  const { parseConditionText } = await load();
  const r = parseConditionText("Gender not in (Male, Other)");
  assert.equal(r.condition, "notContains");
  assert.deepEqual(r.value, ["Male", "Other"]);
});

test("parseConditionText: 'contains' for text fields", async () => {
  const { parseConditionText } = await load();
  assert.deepEqual(parseConditionText("Name contains Smith"), {
    dependsOn: "Name", condition: "contains", value: "Smith",
  });
});

test("parseConditionText: AND composition → compound", async () => {
  const { parseConditionText } = await load();
  const r = parseConditionText("Age >= 18 AND Gender = Female");
  assert.equal(r.compound, true);
  assert.equal(r.conjunction, "AND");
  assert.equal(r.parts.length, 2);
  assert.equal(r.parts[0].dependsOn, "Age");
  assert.equal(r.parts[1].dependsOn, "Gender");
});

test("parseConditionText: OR composition", async () => {
  const { parseConditionText } = await load();
  const r = parseConditionText("Gender = Male OR Gender = Other");
  assert.equal(r.compound, true);
  assert.equal(r.conjunction, "OR");
});

test("parseConditionText: mixed AND/OR rejected (defer to agent)", async () => {
  const { parseConditionText } = await load();
  assert.equal(parseConditionText("Age > 18 AND Gender = Female OR Pregnancy = Yes"), null);
});

test("parseConditionText: empty / whitespace / null → null", async () => {
  const { parseConditionText } = await load();
  assert.equal(parseConditionText(""), null);
  assert.equal(parseConditionText("   "), null);
  assert.equal(parseConditionText(null), null);
  assert.equal(parseConditionText(undefined), null);
});

test("parseConditionText: garbage input → null (no operator found)", async () => {
  const { parseConditionText } = await load();
  assert.equal(parseConditionText("just some words"), null);
});

test("parseConditionText: quoted values stripped", async () => {
  const { parseConditionText } = await load();
  assert.equal(parseConditionText('Gender = "Female"').value, "Female");
  assert.equal(parseConditionText("Gender = 'Female'").value, "Female");
});

// ═══════════════════════════════════════════════════════════════════════
// extractFormElementRuleFromText — end-to-end text → IR → JS (skip logic)
// ═══════════════════════════════════════════════════════════════════════

test("extractFormElementRuleFromText: 'Gender = Female' compiles to viewFilter JS", async () => {
  const { extractFormElementRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormElementRuleFromText("Gender = Female", conceptLookup, "registration");
  assert.ok(ir);
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /params\.entity/);
  assert.ok(js.includes(concepts.Gender.uuid));
  assert.ok(js.includes(concepts.Gender.answers[0].uuid));   // Female's UUID
});

test("extractFormElementRuleFromText: 'Age >= 18' compiles with numeric RHS", async () => {
  const { extractFormElementRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormElementRuleFromText("Age >= 18", conceptLookup, "registration");
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /greaterThanOrEqualTo/);
});

test("extractFormElementRuleFromText: 'is not defined' compiles without RHS", async () => {
  const { extractFormElementRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormElementRuleFromText("Pregnancy is not defined", conceptLookup, "registration");
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /notDefined/);
});

test("extractFormElementRuleFromText: 'in (Female, Male)' compiles to containsAnyAnswer", async () => {
  const { extractFormElementRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormElementRuleFromText("Gender in (Female, Male)", conceptLookup, "registration");
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  assert.match(js, /containsAnyAnswerConceptName/);
});

test("extractFormElementRuleFromText: AND-compound compiles", async () => {
  const { extractFormElementRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormElementRuleFromText("Age >= 18 AND Gender = Female", conceptLookup, "registration");
  const { js, error } = compile(ir, "viewFilter", "individual");
  assert.equal(error, undefined, error);
  // Both concept UUIDs must appear in the body
  assert.ok(js.includes(concepts.Age.uuid));
  assert.ok(js.includes(concepts.Gender.uuid));
});

test("extractFormElementRuleFromText: unknown concept → null (defer to agent)", async () => {
  const { extractFormElementRuleFromText } = await load();
  const ir = extractFormElementRuleFromText("Unknown = Foo", conceptLookup);
  assert.equal(ir, null);
});

test("extractFormElementRuleFromText: malformed text → null", async () => {
  const { extractFormElementRuleFromText } = await load();
  assert.equal(extractFormElementRuleFromText("nonsense here", conceptLookup), null);
});

// ═══════════════════════════════════════════════════════════════════════
// extractEligibilityRuleFromText — text → eligibility IR → JS
// ═══════════════════════════════════════════════════════════════════════

test("extractEligibilityRuleFromText: 'Gender = Female' compiles", async () => {
  const { extractEligibilityRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractEligibilityRuleFromText("Gender = Female", conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "eligibility", "individual");
  assert.equal(error, undefined, error);
  // Eligibility rules use individual scope by default and contain the
  // setEligibility action — compile() lowers it into the eligibility template
  assert.ok(js.length > 0);
});

test("extractEligibilityRuleFromText: AND-compound compiles", async () => {
  const { extractEligibilityRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractEligibilityRuleFromText("Age >= 18 AND Gender = Female", conceptLookup);
  const { js, error } = compile(ir, "eligibility", "individual");
  assert.equal(error, undefined, error);
  assert.ok(js.includes(concepts.Age.uuid));
});

// ═══════════════════════════════════════════════════════════════════════
// extractFormValidationRuleFromText — text → range → IR → JS
// ═══════════════════════════════════════════════════════════════════════

test("extractFormValidationRuleFromText: 'Weight must be between 1 and 200'", async () => {
  const { extractFormValidationRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormValidationRuleFromText("Weight must be between 1 and 200", "Weight", conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "formValidation", "programEncounter");
  assert.equal(error, undefined, error);
  assert.match(js, /validationResults/);
  // The bound numbers appear in the body
  assert.ok(js.includes("1") && js.includes("200"));
});

test("extractFormValidationRuleFromText: 'Age must be >= 18'", async () => {
  const { extractFormValidationRuleFromText } = await load();
  const { compile } = await loadCompile();
  const ir = extractFormValidationRuleFromText("Age must be >= 18", "Age", conceptLookup);
  assert.ok(ir);
  const { js, error } = compile(ir, "formValidation", "programEncounter");
  assert.equal(error, undefined, error);
});

test("extractFormValidationRuleFromText: 'range: 0 to 120'", async () => {
  const { extractFormValidationRuleFromText } = await load();
  const ir = extractFormValidationRuleFromText("range: 0 to 120", "Age", conceptLookup);
  assert.ok(ir);
});

test("extractFormValidationRuleFromText: malformed → null", async () => {
  const { extractFormValidationRuleFromText } = await load();
  assert.equal(extractFormValidationRuleFromText("no numbers here", "Weight", conceptLookup), null);
  assert.equal(extractFormValidationRuleFromText(null, "Weight", conceptLookup), null);
});

test("extractFormValidationRuleFromText: non-Numeric concept → null", async () => {
  const { extractFormValidationRuleFromText } = await load();
  // Gender is Coded, not Numeric — range validation doesn't apply
  assert.equal(extractFormValidationRuleFromText("between 1 and 5", "Gender", conceptLookup), null);
});
