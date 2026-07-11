// 29-spec-completeness.cjs  (category: correctness)
//
// What it proves (CRL6, aspirational — O-1): the CRL's SPEC half
// (src/crl/review.js reviewSpec) scores an intermediate spec artifact for
// intent-COMPLETENESS against a stated intent, and flags a spec that silently
// under-delivers on that intent (e.g. models only the enrolment form of a
// stated two-form antenatal workflow, omitting the required monthly-visit
// encounter form). This is the "intent" mirror of the bundle-side inspector
// (cases 25/26/28): reviewSpec judges spec-vs-intent, never server-compliance.
//
// reviewSpec is called directly in assertions() with an explicit ai-judged
// spec-completeness doc (REAL flat P1 shape) + a scopingCtx.orgAsk carrying the
// FULL stated intent. The harness chat turn is only scaffolding (kept short +
// directive); the spec review, independent of the fixture bundle, is what's
// under test.

"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REVIEW_MODULE = path.resolve(__dirname, "..", "..", "..", "src", "crl", "review.js");
async function loadReviewSpec() {
  const mod = await import(pathToFileURL(REVIEW_MODULE).href);
  return mod.reviewSpec;
}

// An INCOMPLETE spec: the antenatal-care programme's enrolment form only. The
// stated intent (SCOPING_INTENT below) additionally requires a monthly
// antenatal-visit encounter form capturing weight + blood pressure — which this
// spec never models. Same valid shape applySpec accepts (proven in
// tests/entities/crl-review.test.cjs).
const INCOMPLETE_SPEC = `
subjectTypes:
  - {name: Mother, type: Person}
programs:
  - name: ANC
    targetSubjectType: Mother
    enrolmentForm:
      sections:
        - {name: Enroll, fields: [{name: LMP, dataType: Date}]}
`;

const FULL_INTENT =
  "The antenatal-care (ANC) programme must capture BOTH: (1) enrolment — record " +
  "LMP at enrolment; AND (2) a monthly antenatal VISIT encounter form recording " +
  "the mother's weight and blood pressure at every visit. The spec must model " +
  "both the enrolment form and the monthly visit encounter form.";

// ai-judged spec-completeness rule in the REAL committed flat shape (mirrors
// spec-template.yaml's `spec-completeness` section: tier/class/action/inputs).
const SPEC_COMPLETENESS_DOC = {
  version: 1,
  rules: [
    {
      id: "spec-completeness",
      tier: "ai-judged",
      class: "incomplete-intent",
      severity: "warning",
      action: "flag-only",
      inputs: ["spec", "scopingCtx"],
      description:
        "The spec must fully capture the stated intent. Flag any entity, form, encounter, or workflow step the stated intent explicitly asked for that the spec omits (e.g. a required monthly visit / encounter form that is missing).",
    },
  ],
};

module.exports = {
  name: "29-spec-completeness",
  category: "correctness",
  description:
    "[correctness] CRL reviewSpec flags a spec that under-delivers on its stated intent — a missing required encounter form (CRL6, aspirational, O-1).",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgSpecComplete" }),

  envOverrides: () => ({ SDK_CRL_GATE: "off" }), // MAJ-12 — see 25-scrub-strays.cjs

  // Directive + minimal — the chat turn is only harness scaffolding; the
  // reviewSpec call below (independent of this bundle) is what's under test.
  prompt:
    "Reply with a single short sentence confirming whether this bundle looks " +
    "upload-ready. Do not edit any files.",

  maxTurns: 1, // advisory only — not read by the runner
  timeoutMs: 300_000,
  maxCostUsd: 0.60, // whole-spec review (delta null) routes to Sonnet + chat turn

  assertions: async (ctx) => {
    const reviewSpec = await loadReviewSpec();
    const review = await reviewSpec(INCOMPLETE_SPEC, {
      doc: SPEC_COMPLETENESS_DOC,
      scopingCtx: { orgAsk: FULL_INTENT },
    });

    // MAJ-7: thread the spec review's own AI spend into the reported cost.
    const reviewCostUsd = review.ai && typeof review.ai.costUsd === "number" ? review.ai.costUsd : 0;
    ctx.recordReviewCost(reviewCostUsd);

    if (review.kind !== "spec") {
      throw new Error(`expected reviewSpec kind:"spec", got ${JSON.stringify(review.kind)}`);
    }
    // CRL6: the completeness judge must flag the under-delivering spec. stampFindings
    // maps any non-"compliant" finding to the single rule's id, so this is robust to
    // which verdict token the model chooses.
    if (!review.ai.findings.some((f) => f.ruleId === "spec-completeness")) {
      throw new Error(
        "CRL6: reviewSpec did not flag the incomplete spec against the stated intent " +
        "(the missing monthly-visit encounter form). ai findings: " +
        JSON.stringify(review.ai.findings),
      );
    }
  },
};
