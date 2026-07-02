// 22-repair-fe-concept-not-object.cjs  (category: data-integrity)
//
// What it proves (Durga class, epic #11 AC "FE/ALT enforcing eval cases"):
// FE_CONCEPT_NOT_OBJECT is an INTEGRITY-ONLY trap the local validator misses.
// The poison FLATTENS a formElement's `concept` from the required nested
// ConceptContract object down to a bare UUID STRING. The local validator still
// passes (the UUID resolves), but AVNI's server-side Jackson deserializer
// crashes mapping a string onto ConceptContract. The agent must:
//   1. run bundle_integrity_check (the only thing that surfaces this),
//   2. RE-INLINE the full nested concept object (name/uuid/dataType/…) — the
//      standalone concept still lives in concepts.json, so nothing is invented,
//   3. finish with BOTH the validator and the integrity check reporting zero
//      errors.
//
// ENFORCING (not observe-only): fails if the agent never runs the integrity
// check, if the concept stays flattened, or if the final bundle is validator-
// or integrity-dirty.
//
// Gated exactly like every eval case: DEFINED here, run only under an explicit
// budgeted `npm run eval` (skips clean when ANTHROPIC_API_KEY is unset — it is
// NOT part of `npm test`).

"use strict";

const INTEGRITY_CHECK = "mcp__avni-bundle__bundle_integrity_check";

module.exports = {
  name: "22-repair-fe-concept-not-object",
  category: "data-integrity",
  description:
    "[data-integrity] Repair FE_CONCEPT_NOT_OBJECT: re-inline a flattened formElement.concept (bare UUID → nested object); end validator + integrity clean.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgFEConcept" }),
  poison: "FE_CONCEPT_NOT_OBJECT",

  prompt:
    "This bundle passes the plain validator but will crash the AVNI server on upload. " +
    "Run the data-integrity check to find the problem, then fix it. Finish only when BOTH " +
    "the validator and the integrity check report zero errors.",

  maxTurns: 3,
  maxCostUsd: 0.35,

  assertions: async (ctx) => {
    const { assertions: A } = ctx;

    // 1. The agent must have consulted the integrity check — it is the ONLY
    //    surface that reveals FE_CONCEPT_NOT_OBJECT (the validator is blind to it).
    A.assertToolUsed(ctx.agentEvents, (t) => t.name === INTEGRITY_CHECK);

    // 2. The flattened concept was RE-INLINED as a nested object at the SAME uuid
    //    and name (not invented, not dropped). assertFormsEmbedConceptName only
    //    matches nested `{ uuid, name }` shapes — a still-flattened bare string
    //    matches nothing, so require at least one re-inlined element.
    const { uuid, conceptName } = ctx.fx.poisonMeta;
    const embedded = A.assertFormsEmbedConceptName(ctx.bundleDir, uuid, conceptName);
    if (!embedded || embedded < 1) {
      throw new Error(`formElement.concept for "${conceptName}" (${uuid}) was not re-inlined as a nested object`);
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
