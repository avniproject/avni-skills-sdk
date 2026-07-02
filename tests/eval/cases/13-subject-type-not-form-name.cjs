// 13-subject-type-not-form-name.cjs  (category: srs-authorship)
//
// What it proves (the Astitva "trap"): the registration form is named after an
// ACTIVITY ("Household Survey") while the subject being registered is the ENTITY
// "Beneficiary". Because the form name doesn't contain the entity name, the
// deterministic generator stamps a PHANTOM subjectType UUID onto the form
// mapping(s) → M3 (dangling subjectType ref). The CORRECT fix repoints those
// mappings at the EXISTING "Beneficiary" subject type; the WRONG (naive) fix
// invents a subject type named after the form.
//
// Expectations:
//   • validator M3 count → 0
//   • subjectTypes.json still holds exactly "Beneficiary" — no subject type
//     named after a form was created
//   • the registration form mapping now points at "Beneficiary"
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "13-subject-type-not-form-name",
  category: "srs-authorship",
  description:
    "[srs-authorship] Resolve M3 by pointing form mappings at the ENTITY subject type — never create a subject type named after a form.",

  setupFixture: ({ fixture }) => fixture.buildLocationTrapSrs({ org: "TestOrgTrap" }),

  prompt:
    "This bundle has validator errors: form mappings reference a subject type " +
    "that isn't defined. The form is called 'Household Survey', but the subject " +
    "being registered is a person — the target entity is 'Beneficiary', which is " +
    "already defined. Point the mappings at the existing 'Beneficiary' subject " +
    "type. Do NOT create a new subject type named after a form.",

  maxTurns: 3,
  maxCostUsd: 0.35,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;
    const fs = require("node:fs");
    const path = require("node:path");

    // 1. M3 cleared.
    await A.assertValidatorCount({ getValidator: ctx.getValidator, code: "M3", expected: 0 });

    // 2. subjectTypes.json is still just the entity — no form-named subject type.
    const subjects = JSON.parse(fs.readFileSync(path.join(ctx.bundleDir, "subjectTypes.json"), "utf8"));
    const names = subjects.map((s) => s.name);
    if (!names.includes("Beneficiary")) {
      throw new Error(`"Beneficiary" subject type missing (have: ${names.join(", ")})`);
    }
    if (names.includes("Household Survey")) {
      throw new Error(`agent created a subject type named after the form ("Household Survey")`);
    }
    if (subjects.length !== 1) {
      throw new Error(`expected exactly 1 subject type (Beneficiary), got ${subjects.length}: ${names.join(", ")}`);
    }

    // 3. The registration mapping points at Beneficiary.
    A.assertFormMappingSubjectType(ctx.bundleDir, "Household Survey", "Beneficiary");

    // 4. No regression.
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
