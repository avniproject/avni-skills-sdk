// 23-repair-alt-invalid-name.cjs  (category: data-integrity)
//
// What it proves (Astitva class, epic #11 AC "FE/ALT enforcing eval cases"):
// ALT_INVALID_NAME is an INTEGRITY-ONLY trap the local validator misses. The
// poison introduces an addressLevelType whose name contains a character AVNI's
// LocationService rejects (here '>', in "Sub>District"). The plain validator
// does not check addressLevelType name chars, so it passes; the server rejects
// the upload. The agent must:
//   1. run bundle_integrity_check (the only thing that surfaces this),
//   2. rename the addressLevelType to a clean name (drop the illegal char) —
//      nothing else references it, so no FK repair is required,
//   3. finish with BOTH the validator and the integrity check reporting zero
//      errors.
//
// ENFORCING (not observe-only): fails if the agent never runs the integrity
// check, if any addressLevelType name still contains < > = " ' (or is empty),
// or if the final bundle is validator- or integrity-dirty.
//
// Gated exactly like every eval case: DEFINED here, run only under an explicit
// budgeted `npm run eval` (skips clean when ANTHROPIC_API_KEY is unset — it is
// NOT part of `npm test`).

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INTEGRITY_CHECK = "mcp__avni-bundle__bundle_integrity_check";
const ILLEGAL_ALT_CHARS = /[<>="']/;

module.exports = {
  name: "23-repair-alt-invalid-name",
  category: "data-integrity",
  description:
    "[data-integrity] Repair ALT_INVALID_NAME: rename an addressLevelType whose name carries an illegal char (< > = \" '); end validator + integrity clean.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgALTName" }),
  poison: "ALT_INVALID_NAME",

  prompt:
    "This bundle passes the plain validator but the AVNI server will reject it on upload. " +
    "Run the data-integrity check to find the problem, then fix it (keep the location level, " +
    "just make its name valid). Finish only when BOTH the validator and the integrity check " +
    "report zero errors.",

  maxTurns: 3,
  maxCostUsd: 0.35,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. The agent must have consulted the integrity check — it is the ONLY
    //    surface that reveals ALT_INVALID_NAME (the validator is blind to it).
    A.assertToolUsed(ctx.agentEvents, (t) => t.name === INTEGRITY_CHECK);

    // 2. No addressLevelType name still carries an illegal char (or is empty).
    const fp = path.join(ctx.bundleDir, "addressLevelTypes.json");
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
      const alts = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.addressLevelTypes) ? raw.addressLevelTypes : (Array.isArray(raw?.data) ? raw.data : []));
      for (const alt of alts) {
        const name = alt && typeof alt === "object" ? alt.name : alt;
        if (!name || ILLEGAL_ALT_CHARS.test(String(name))) {
          throw new Error(`addressLevelType name still invalid: ${JSON.stringify(name)}`);
        }
      }
    }

    // 3. Validator clean on the final bundle.
    await A.assertValidatorClean({ getValidator: ctx.getValidator });

    // 4. Integrity clean at rest (folded into validationAtCurrent on commit).
    const v = await ctx.getValidator();
    if (v.integrity && v.integrity.ok === false) {
      throw new Error(`integrity not clean: ${JSON.stringify(v.integrity.counts)}`);
    }
  },
};
