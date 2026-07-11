// 28-inspector-catches-prose-form.cjs  (category: data-integrity)
//
// What it proves (CRL3, aspirational, MAJ-4): the CRL review layer's INSPECT
// mode flags a seeded PROSE-AS-FORM defect (a form element that's really a
// static instructions/notes blob, not a data-collection question) with a
// catch verdict — the design's #1 gap (real orgs storing documentation inside
// the form mechanism instead of real fields). Every other CRL eval case seeds
// concept-level orphans (NAJunk); this is the one case that exercises the
// OTHER flagship defect class.
//
// Deliberately uses the DEFAULT compliance-doc (no explicit doc override,
// unlike cases 25/26) — the committed compliance-doc.yaml already carries a
// prose-form ai-judged rule (`prose-should-be-form`, inputs:[artifact.forms]),
// so this case is the direct regression test that that shipped rule exists and
// actually fires against real content. inspectorCatch only requires the seeded
// element to be flagged by SOME catch verdict targeting it, so it is robust to
// which of the default doc's ai rules (prose/naming) the judge attributes it to.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REVIEW_MODULE = path.resolve(__dirname, "..", "..", "..", "src", "crl", "review.js");
async function loadReviewBundle() {
  const mod = await import(pathToFileURL(REVIEW_MODULE).href);
  return mod.reviewBundle;
}

module.exports = {
  name: "28-inspector-catches-prose-form",
  category: "data-integrity",
  description:
    "[data-integrity] CRL inspect mode flags a seeded prose-as-form defect (instructions/notes blob posing as a form field) with a catch verdict (CRL3, aspirational, MAJ-4).",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgProseForm" }),
  poison: "ProseForm",

  envOverrides: () => ({ SDK_CRL_GATE: "off" }), // MAJ-12 — see 25-scrub-strays.cjs

  // Directive + minimal: the chat turn here is only harness scaffolding to get a
  // session holding the poisoned bundle — the CRL inspect (below) is what's under
  // test, so keep the turn short and bounded (a lengthy investigation of the odd
  // prose element is what timed the un-directed prompt out).
  prompt:
    "Reply with a single short sentence confirming whether this bundle looks " +
    "upload-ready. Do not edit any files.",

  maxTurns: 1, // advisory only — not read by the runner
  timeoutMs: 300_000, // margin — the seeded prose element can lengthen the turn
  maxCostUsd: 0.70, // default doc = 4 ai rules, whole-config → Sonnet (+ possible re-judge) + chat turn

  assertions: async (ctx) => {
    const { inspectorCatch } = require("../../corpus/lib/crl-inspector-eval.cjs");

    // 0. Precondition: the seeded prose element survived into the inspect
    //    step (minor #8/34 pattern — check the specific artifact, not a
    //    blanket noChanges).
    const formPath = path.join(ctx.bundleDir, ctx.fx.poisonMeta.formFile);
    const formOnDisk = JSON.parse(fs.readFileSync(formPath, "utf8"));
    const stillThere = (formOnDisk.formElementGroups || []).some((g) =>
      (g.formElements || []).some((fe) => fe.uuid === ctx.fx.poisonMeta.feUuid),
    );
    if (!stillThere) {
      throw new Error(`seeded prose form element ${ctx.fx.poisonMeta.feUuid} is gone before the CRL inspect even ran`);
    }

    const reviewBundle = await loadReviewBundle();
    const review = await reviewBundle(ctx.bundleDir, { mode: "inspect" }); // default doc — see header comment

    // MAJ-7: thread the inspect review's own AI spend into the reported cost.
    const reviewCostUsd = review.ai && typeof review.ai.costUsd === "number" ? review.ai.costUsd : 0;
    ctx.recordReviewCost(reviewCostUsd);

    const seededDefect = {
      kind: "prose-form",
      file: ctx.fx.poisonMeta.formFile,
      uuids: [ctx.fx.poisonMeta.feUuid, ctx.fx.poisonMeta.conceptUuid],
      names: [ctx.fx.poisonMeta.feName],
    };
    const result = inspectorCatch(ctx.bundleDir, seededDefect, review.ai.findings);

    if (!result.caught) {
      throw new Error(
        `CRL3: inspector did not flag the seeded prose-form defect (${ctx.fx.poisonMeta.formFile}#${ctx.fx.poisonMeta.feUuid}). ` +
        `ai findings: ${JSON.stringify(review.ai.findings)}`,
      );
    }
  },
};
