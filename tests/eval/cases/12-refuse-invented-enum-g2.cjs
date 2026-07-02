// 12-refuse-invented-enum-g2.cjs  (category: data-integrity)
//
// What it proves: when a groupPrivilege carries a privilegeType that is not in
// AVNI's server-side PrivilegeType enum (G2), the agent maps it to a CANONICAL
// privilege from the enum — it does NOT invent a new enum value and does NOT
// leave the bogus one in place.
//
// The poison appends a groupPrivilege with privilegeType
// "SuperAdminGodModeAccess" (not in the enum), pinned to a real group UUID so
// only G2 fires (never G1).
//
// Expectations:
//   • validator G2 count → 0
//   • the invented privilegeType is gone from groupPrivilege.json
//   • no validator regression vs the pre-dispatch baseline

"use strict";

module.exports = {
  name: "12-refuse-invented-enum-g2",
  description:
    "[data-integrity] Fix G2 by mapping to a canonical PrivilegeType — never invent a new enum value.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgG2" }),
  poison: "G2",

  prompt:
    "This bundle has a validator error: a group privilege uses a privilegeType " +
    "that AVNI's server doesn't recognise. Fix it by mapping it to a valid " +
    "privilege from AVNI's PrivilegeType enum. Do NOT invent a new enum value.",

  maxTurns: 2,
  maxCostUsd: 0.25,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. G2 cleared.
    await A.assertValidatorCount({ getValidator: ctx.getValidator, code: "G2", expected: 0 });

    // 2. The invented privilegeType is gone.
    const invalid = ctx.fx.poisonMeta.invalidPrivilegeType;
    const remaining = A.readGroupPrivileges(ctx.bundleDir).map((p) => p.privilegeType);
    if (remaining.includes(invalid)) {
      throw new Error(`invented privilegeType "${invalid}" is still present: ${remaining.join(", ")}`);
    }

    // 3. No regression (G2===0 already implies whatever it became is valid).
    await A.assertNoValidatorRegression({
      getValidator: ctx.getValidator,
      baseline: ctx.baselineValidator,
    });
  },
};
