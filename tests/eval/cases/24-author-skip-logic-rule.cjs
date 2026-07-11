// 24-author-skip-logic-rule.cjs  (category: correctness)
//
// What it proves (C3, the vision's critical path): the agent can AUTHOR a
// grounded form-element skip-logic / view-filter rule from a plain-language
// intent — referencing an existing concept (Age) — and the emitted rule is
// R1–R6 valid (parses, correct wrapper, no forbidden globals/imports, concept
// refs resolve). No existing case tested rule authoring at all.
//
// Expectations:
//   • the Religion form element carries a non-empty rule after the edit
//   • the rule references Age (grounded, not hallucinated)
//   • every rule in the bundle is R1–R6 clean (the new one included)
//   • no validator regression vs baseline

"use strict";

const { ruleGrounding } = require("../../corpus/lib/rule-grounding.cjs");

module.exports = {
  name: "24-author-skip-logic-rule",
  category: "correctness",
  description:
    "[correctness] Author a grounded form-element skip-logic rule (show Religion only when Age ≥ 18); rule must be R1–R6 valid.",

  setupFixture: ({ fixture }) => fixture.buildBaseSrsBuffers({ org: "TestOrgRuleAuthor" }),

  prompt:
    "On the 'Beneficiary Registration' form, make the 'Religion' question only appear when 'Age' is 18 or older. " +
    "Add the appropriate form-element view-filter / skip-logic rule, referencing the existing Age concept. Keep the bundle valid.",

  maxTurns: 5,
  maxCostUsd: 0.80,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. The Religion form element now carries a non-empty rule.
    let religionRule = "";
    for (const { form } of A.readForms(ctx.bundleDir)) {
      for (const g of form.formElementGroups || []) {
        for (const fe of g.formElements || []) {
          const nm = String((fe && fe.concept && fe.concept.name) || fe.name || "").toLowerCase();
          if (nm === "religion" && fe.rule) religionRule = String(fe.rule);
        }
      }
    }
    if (!religionRule.trim()) {
      throw new Error("Religion form element has no skip-logic rule after the edit");
    }

    // 2. The rule references Age (grounded, not hallucinated).
    if (!/age/i.test(religionRule)) {
      throw new Error(`rule does not reference Age: ${religionRule.slice(0, 160)}`);
    }

    // 3. Every rule in the bundle is R1–R6 clean (the authored one included).
    const rg = await ruleGrounding(ctx.bundleDir);
    if (rg.errorCount !== 0) {
      throw new Error(`rule grounding errors after authoring: ${JSON.stringify(rg.byCode)} — rule: ${religionRule.replace(/\s+/g, " ").slice(0, 300)}`);
    }

    // 4. No validator regression.
    await A.assertNoValidatorRegression({ getValidator: ctx.getValidator, baseline: ctx.baselineValidator });
  },
};
