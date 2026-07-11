// 25-scrub-strays.cjs  (category: data-integrity)
//
// What it proves (CRL2a / CRL2b — both aspirational per MAJ-8/IC-8; the
// CI-enforced precision floor is the P2 executor guardrail tests, not this
// eval): the CRL review layer's SCRUB mode (src/crl/review.js
// reviewBundle(bundleDir, {mode:"scrub"})) prunes injected strays from a
// poisoned bundle with precision ≈ 1.0 (CRL2a — it must NEVER prune a real,
// referenced/present entry) and reasonable recall (CRL2b — how many of the
// known strays it actually catches).
//
// The poison (NAJunk, reused from tests/eval/lib/fixture.cjs) appends three
// unreferenced dataType:"NA" concepts to an otherwise-clean bundle. The chat
// prompt is deliberately VERIFICATION-ONLY (mirrors case 15) so the
// conversational agent does not itself prune anything — the CRL scrub, not the
// chat turn, is what's under test.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REVIEW_MODULE = path.resolve(__dirname, "..", "..", "..", "src", "crl", "review.js");
async function loadReviewBundle() {
  const mod = await import(pathToFileURL(REVIEW_MODULE).href);
  return mod.reviewBundle;
}

function buildOracleWithoutJunk(bundleDir, junkNames) {
  const oracleDir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-oracle-"));
  fs.cpSync(bundleDir, oracleDir, { recursive: true });
  const cp = path.join(oracleDir, "concepts.json");
  const concepts = JSON.parse(fs.readFileSync(cp, "utf8"));
  const junk = new Set(junkNames.map((n) => n.toLowerCase()));
  const kept = concepts.filter((c) => !junk.has(String(c.name || "").toLowerCase()));
  fs.writeFileSync(cp, JSON.stringify(kept, null, 2));
  return oracleDir;
}

// MAJ-3 belt-and-suspenders: don't depend solely on the default
// compliance-doc.yaml carrying a concept-level orphan rule — ship it inline
// too. Authored in the REAL, committed P1 flat shape (tier/class/action/inputs,
// NO judge{} block) — the same shape src/crl/compliance-doc.js's aiRulesOf()
// and the committed compliance-doc.yaml's `orphan-stray-concept` rule use, and
// the shape tests/entities/crl-review.test.cjs's orphanConceptDoc() proves live.
const AI_ORPHAN_CONCEPT_DOC = {
  version: 1,
  rules: [
    {
      id: "orphan-stray-concept",
      tier: "ai-judged",
      class: "stray",
      severity: "warning",
      action: "prune-candidate",
      inputs: ["artifact.concepts", "scopingCtx", "deterministicFindings"],
      description:
        "A concept that no form/rule/answer references and reads as leftover import/edit junk is a stray — prune-candidate. Judge against the concept's name + whether anything in the bundle uses it.",
    },
  ],
};

module.exports = {
  name: "25-scrub-strays",
  category: "data-integrity",
  description:
    "[data-integrity] CRL scrub mode prunes injected NA-junk strays with zero present-loss (CRL2a) and useful recall (CRL2b) — both aspirational.",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgScrub" }),
  poison: "NAJunk",

  // MAJ-12: this case tests the CRL scrub layer in isolation via a direct
  // reviewBundle() call in assertions() below, NOT the per-turn integration
  // Phase 4 wires into commitWorkspaceChanges. Force the gate off at server
  // boot so — regardless of merge order relative to Phase 4 — the chat turn
  // dispatched below never double-fires an unbudgeted, untracked CRL pass.
  envOverrides: () => ({ SDK_CRL_GATE: "off" }),

  prompt:
    "Please double-check this bundle is upload-ready. Only change something if it " +
    "is actually broken — otherwise just confirm it looks good.",

  maxTurns: 1, // advisory only — tests/eval/lib/runner.cjs never reads this field
  maxCostUsd: 0.60, // whole-config review (no delta) routes to Sonnet + chat turn — minor fix #43

  assertions: async (ctx) => {
    const { scrubScore } = require("../../corpus/lib/crl-scrub-eval.cjs");
    const { assertions: A } = ctx;

    // 0. Precondition: the SPECIFIC seeded junk survived into the scrub step.
    //    NOT a blanket "no chat edits at all" check (minor #8/34) — the chat
    //    turn is free to make an unrelated benign no-op edit; what matters for
    //    CRL2a/2b is only that the junk this case seeded is still there for
    //    the CRL scrub to act on.
    for (const name of ctx.fx.poisonMeta.junkNames) {
      A.assertConceptExists(ctx.bundleDir, name, { dataType: "NA" });
    }

    const oracleDir = buildOracleWithoutJunk(ctx.bundleDir, ctx.fx.poisonMeta.junkNames);

    // 1. Baseline: exactly the 3 known strays, zero present-loss.
    const before = scrubScore(ctx.bundleDir, oracleDir);
    if (before.extraCount !== 3) {
      throw new Error(`expected 3 strays pre-scrub, got ${before.extraCount}: ${JSON.stringify(before.extraByClass)}`);
    }
    if (before.presentLossCount !== 0) {
      throw new Error(`unexpected present-loss before scrub even ran: ${JSON.stringify(before.missingByClass)}`);
    }

    // 2. Run the CRL scrub — mutates ctx.bundleDir in place.
    const reviewBundle = await loadReviewBundle();
    const review = await reviewBundle(ctx.bundleDir, { mode: "scrub", doc: AI_ORPHAN_CONCEPT_DOC });

    // 2b. MAJ-7 / CRL5: this review call's own AI spend is a SEPARATE cost
    // from the chat turn — thread it into the case's reported cost (recordReviewCost)
    // so run.cjs's running-cost gate + maxCostUsd account for it, and bound it
    // explicitly here as this phase's ONE recorded CRL5 datapoint.
    const reviewCostUsd = review.ai && typeof review.ai.costUsd === "number" ? review.ai.costUsd : 0;
    ctx.recordReviewCost(reviewCostUsd);
    A.assertCostUnder(reviewCostUsd, 0.35, { label: "25-scrub-strays (CRL scrub review, CRL5 datapoint)" });

    // 3. CRL2a: never prune a real/present entry.
    const after = scrubScore(ctx.bundleDir, oracleDir);
    if (after.presentLossCount !== 0) {
      throw new Error(
        `CRL2a precision guardrail violated: ${after.presentLossCount} real entr(y/ies) wrongly pruned — ` +
        JSON.stringify(after.missingByClass),
      );
    }

    // 4. CRL2a, restated on the executor's own report: no kept concept
    //    (Hindu/Muslim/Christian/Other) was ever applied as a prune.
    const keptLower = new Set(ctx.fx.poisonMeta.keepNANames.map((n) => n.toLowerCase()));
    const wronglyApplied = (review.executed?.applied || [])
      .filter((a) => a.target?.name && keptLower.has(String(a.target.name).toLowerCase()));
    if (wronglyApplied.length) {
      throw new Error(`executor pruned a referenced NA concept: ${JSON.stringify(wronglyApplied)}`);
    }

    // 5. CRL2b (aspirational): at least half the known strays actually caught.
    const recall = (before.extraCount - after.extraCount) / before.extraCount;
    if (recall < 0.5) {
      throw new Error(`CRL2b recall too low: caught ${before.extraCount - after.extraCount}/${before.extraCount} strays (${recall.toFixed(2)})`);
    }
  },
};
