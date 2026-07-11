// 26-inspector-catches-seeded.cjs  (category: data-integrity)
//
// What it proves (CRL3, aspirational): the CRL review layer's INSPECT mode
// (reviewBundle(bundleDir, {mode:"inspect"})) flags a seeded orphan-concept
// defect with an ai-judged "orphan"/"stray" verdict targeting the right
// entity — the whole-config inspector doesn't just miss it silently.
//
// Reuses the same NAJunk poison as case 25 (orphan, unreferenced dataType:NA
// concepts) — a concrete instance of the design doc's "orphan concept" defect
// class. The chat prompt is verification-only so the seeded defect survives
// into the CRL inspect call untouched.

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

function buildCleanBeforeSeed(bundleDir, junkNames) {
  const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-clean-"));
  fs.cpSync(bundleDir, cleanDir, { recursive: true });
  const cp = path.join(cleanDir, "concepts.json");
  const concepts = JSON.parse(fs.readFileSync(cp, "utf8"));
  const junk = new Set(junkNames.map((n) => n.toLowerCase()));
  const kept = concepts.filter((c) => !junk.has(String(c.name || "").toLowerCase()));
  fs.writeFileSync(cp, JSON.stringify(kept, null, 2));
  return cleanDir;
}

// MAJ-3 belt-and-suspenders — identical literal to 25-scrub-strays.cjs (REAL
// flat P1 shape); see that file's header comment for the full rationale.
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
  name: "26-inspector-catches-seeded",
  category: "data-integrity",
  description:
    "[data-integrity] CRL inspect mode flags a seeded orphan-concept defect with the right ai-judged verdict (CRL3, aspirational).",

  setupFixture: ({ fixture }) => fixture.buildCleanSrsBuffers({ org: "TestOrgInspector" }),
  poison: "NAJunk",

  envOverrides: () => ({ SDK_CRL_GATE: "off" }), // MAJ-12 — see 25-scrub-strays.cjs

  prompt:
    "Please double-check this bundle is upload-ready. Only change something if it " +
    "is actually broken — otherwise just confirm it looks good.",

  maxTurns: 1, // advisory only — not read by the runner
  maxCostUsd: 0.60, // whole-config review (no delta) routes to Sonnet + chat turn — minor fix #43

  assertions: async (ctx) => {
    const { inspectorCatch } = require("../../corpus/lib/crl-inspector-eval.cjs");
    const { assertions: A } = ctx;

    // 0. Precondition: the SPECIFIC seeded junk survived into the inspect
    //    step (see 25-scrub-strays.cjs's assertion 0 — minor #8/34).
    for (const name of ctx.fx.poisonMeta.junkNames) {
      A.assertConceptExists(ctx.bundleDir, name, { dataType: "NA" });
    }

    const cleanDir = buildCleanBeforeSeed(ctx.bundleDir, ctx.fx.poisonMeta.junkNames);

    const reviewBundle = await loadReviewBundle();
    const review = await reviewBundle(ctx.bundleDir, { mode: "inspect", doc: AI_ORPHAN_CONCEPT_DOC });

    // MAJ-7: thread the inspect review's own AI spend into the reported cost.
    const reviewCostUsd = review.ai && typeof review.ai.costUsd === "number" ? review.ai.costUsd : 0;
    ctx.recordReviewCost(reviewCostUsd);
    A.assertCostUnder(reviewCostUsd, 0.35, { label: "26-inspector-catches-seeded (CRL inspect review)" });

    const seededDefect = {
      kind: "orphan-concept",
      file: "concepts.json",
      uuids: ctx.fx.poisonMeta.junkUuids,
      names: ctx.fx.poisonMeta.junkNames,
    };
    const result = inspectorCatch(cleanDir, seededDefect, review.ai.findings);

    if (!result.seededWasNovel) {
      throw new Error("test fixture bug: the seeded defect names already existed in the clean bundle");
    }
    if (!result.caught) {
      throw new Error(
        `CRL3: inspector did not flag the seeded orphan concept(s) ${JSON.stringify(ctx.fx.poisonMeta.junkNames)}. ` +
        `ai findings: ${JSON.stringify(review.ai.findings)}`,
      );
    }
  },
};
