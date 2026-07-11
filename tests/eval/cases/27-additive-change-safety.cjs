// 27-additive-change-safety.cjs  (category: no-thrash)
//
// What it proves (CRL4, aspirational): an additive change to a mature,
// multi-form bundle touches ONLY the requested delta (+ its blast radius) —
// no collateral drift elsewhere in the bundle. Reuses the deep-differ
// (diffDeep/bundleDeepNames) to compare the pre-turn and post-turn bundle,
// and reviewBundle(mode:"inspect", delta) — WITH a real, computed
// delta.blastRadius (MAJ-5) — to confirm the change stays server-compliant
// and that the CRL actually reviewed the new field's dependents, not just
// the raw file diff.
//
// The fixture is buildLargeSrs (a multi-subject-type "mature-shaped" bundle,
// the same fixture family case 17 uses for large-bundle testing). The prompt
// asks for ONE additive field on ONE form.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const REVIEW_MODULE = path.resolve(__dirname, "..", "..", "..", "src", "crl", "review.js");
async function loadReviewBundle() {
  const mod = await import(pathToFileURL(REVIEW_MODULE).href);
  return mod.reviewBundle;
}

// findReferencesOnDir is already shipped (src/agents/bundle-mcp-server.js) —
// not a Phase-2/4 precondition. Used directly (MAJ-5) so this case's blast-
// radius computation has zero dependency on where/whether Phase 4 wires
// buildCrlDelta into the per-turn gate.
const BUNDLE_MCP_MODULE = path.resolve(__dirname, "..", "..", "..", "src", "agents", "bundle-mcp-server.js");
async function loadFindReferencesOnDir() {
  const mod = await import(pathToFileURL(BUNDLE_MCP_MODULE).href);
  return mod.findReferencesOnDir;
}

// Reconstruct the bundle tree exactly as it was at `sha`, into a fresh dir,
// via `git archive` (bundleDir is the SDK server's per-session git repo).
// Piped directly through `tar`'s stdin — no intermediate tar file to name
// collision-safely or clean up.
function snapshotAtSha(bundleDir, sha) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-before-"));
  const tarBuf = execFileSync("git", ["archive", "--format=tar", sha], {
    cwd: bundleDir, maxBuffer: 1024 * 1024 * 100,
  });
  execFileSync("tar", ["-xf", "-", "-C", outDir], { input: tarBuf });
  return outDir;
}

// MAJ-5: merge N RefResult objects (one findReferencesOnDir call per newly-
// added entity) into a single blastRadius, same field names, unioned.
function mergeRefResults(results) {
  const byFile = {};
  const references = [];
  for (const r of results) {
    if (!r || !r.ok) continue;
    references.push(...r.references);
    for (const [f, refs] of Object.entries(r.byFile || {})) {
      (byFile[f] ||= []).push(...refs);
    }
  }
  return { ok: true, totalReferences: references.length, filesAffected: Object.keys(byFile).length, byFile, references };
}

module.exports = {
  name: "27-additive-change-safety",
  category: "no-thrash",
  description:
    "[no-thrash] An additive field on one form touches only that delta + its blast radius — no collateral drift elsewhere (CRL4, aspirational; consumes a real delta.blastRadius per MAJ-5).",

  setupFixture: ({ fixture }) => fixture.buildLargeSrs({ org: "TestOrgAdditive", formCount: 6 }),

  // MAJ-12: unlike 25/26/28, this case DOES author a real, committed chat
  // turn (the additive field) — the case most exposed to the per-turn CRL
  // gate double-firing once Phase 4 lands. Force it off; this case's own
  // explicit reviewBundle(mode:"inspect", delta) call below is the thing
  // under test, not the per-turn integration.
  envOverrides: () => ({ SDK_CRL_GATE: "off" }),

  prompt:
    "Add a new optional Text field called 'Emergency Contact' to the Beneficiary " +
    "Registration form. Do not touch any other form or subject type.",

  maxTurns: 2, // advisory only — not read by the runner
  timeoutMs: 300_000,
  maxCostUsd: 0.60,

  assertions: async (ctx) => {
    const { bundleDeepNames } = require("../../corpus/lib/deep-names.cjs");
    const { diffDeep } = require("../../corpus/lib/deep-diff.cjs");
    const { normalizeName } = require("../../corpus/doorstep/lib/entity-names.cjs");

    if (ctx.turnEvent && ctx.turnEvent.noChanges === true) {
      throw new Error("expected the agent to author the additive change, but nothing was committed");
    }
    if (!ctx.preDispatchSha) throw new Error("no preDispatchSha captured — cannot snapshot the before-state");

    const beforeDir = snapshotAtSha(ctx.bundleDir, ctx.preDispatchSha);
    const before = bundleDeepNames(beforeDir);
    const after = bundleDeepNames(ctx.bundleDir);
    const diff = diffDeep(after, before);

    // 1. Nothing real disappeared, in ANY class — no collateral deletion.
    for (const [k, c] of Object.entries(diff.classes)) {
      if (c.missing.length) {
        throw new Error(`collateral drift: class "${k}" lost ${JSON.stringify(c.missing)} that existed before the turn`);
      }
    }

    // 2. The only classes allowed new ("extra") entries are the ones the
    //    additive field touches: the new concept + the new form element (and,
    //    if the agent grouped it under a fresh section, a new formGroup).
    //    Everything else (subjectTypes/programs/encounterTypes/forms/
    //    formMappings/codedAnswers/ruleFields) must be untouched.
    const ALLOWED_EXTRA_CLASSES = new Set(["concepts", "formElements", "formGroups"]);
    for (const [k, c] of Object.entries(diff.classes)) {
      if (c.extra.length && !ALLOWED_EXTRA_CLASSES.has(k)) {
        throw new Error(`collateral drift: class "${k}" gained ${JSON.stringify(c.extra)} outside the requested delta`);
      }
    }
    if (diff.classes.concepts.extra.length === 0 && diff.classes.formElements.extra.length === 0) {
      throw new Error("expected the additive change to actually add a concept/form element — nothing was added");
    }

    // 3. Blast radius on disk: the changed FILES must be a small, explainable
    //    set — concepts.json (the new concept) + the target form file. Derive
    //    the target form filename from the bundle (its form.name normalizes to
    //    "beneficiary registration") rather than hardcoding it, so this is
    //    robust to the generator's space-vs-underscore filename convention.
    const changedFiles = execFileSync(
      "git", ["diff", "--name-only", ctx.preDispatchSha, "HEAD"],
      { cwd: ctx.bundleDir, encoding: "utf8" },
    ).split("\n").filter(Boolean);
    const formName = (rel) => {
      try { return normalizeName(JSON.parse(fs.readFileSync(path.join(ctx.bundleDir, rel), "utf8")).name); }
      catch { return ""; }
    };
    const unexpected = changedFiles.filter((f) => {
      if (f === "concepts.json") return false;
      if (f.startsWith("forms/") && f.endsWith(".json") && formName(f) === "beneficiary registration") return false;
      return true;
    });
    if (unexpected.length) {
      throw new Error(`collateral drift: unexpected files changed outside the blast radius: ${JSON.stringify(unexpected)} (all changed: ${JSON.stringify(changedFiles)})`);
    }

    // 4. MAJ-5: compute the REAL blast radius via findReferencesOnDir for
    //    every newly-added concept, and feed it into reviewBundle's delta —
    //    the CRL's "a change silently breaks an unreviewed dependent" guard
    //    only works if delta.blastRadius is actually populated, not just the
    //    raw changedFiles diff.
    const conceptsAfter = JSON.parse(fs.readFileSync(path.join(ctx.bundleDir, "concepts.json"), "utf8"));
    const newConceptNames = new Set(diff.classes.concepts.extra);
    const newConcepts = conceptsAfter.filter((c) => newConceptNames.has(normalizeName(c.name)));
    if (newConcepts.length === 0) {
      throw new Error(`expected to find the newly-added concept(s) ${JSON.stringify([...newConceptNames])} in concepts.json`);
    }
    const findReferencesOnDir = await loadFindReferencesOnDir();
    const refResults = newConcepts.map((c) => findReferencesOnDir(ctx.bundleDir, { uuid: c.uuid }));
    const blastRadius = mergeRefResults(refResults);
    // Every new concept must be referenced by AT LEAST the form element that
    // was just added for it — a concept with zero references is itself a
    // stray (cases 25/26's territory), not a valid additive change.
    if (blastRadius.totalReferences === 0) {
      throw new Error(`new concept(s) ${JSON.stringify([...newConceptNames])} have zero references — additive change didn't wire the field up`);
    }

    // 5. The change stays server-compliant under the CRL's deterministic
    //    pass, reviewed WITH the real delta (changedFiles + blastRadius) so
    //    dependents are actually in scope, not just the raw diff.
    const reviewBundle = await loadReviewBundle();
    const review = await reviewBundle(ctx.bundleDir, {
      mode: "inspect",
      delta: { changedFiles, blastRadius, sinceSha: ctx.preDispatchSha },
    });
    // MAJ-7: thread the review's own AI spend into the reported cost. (A delta
    // review routes to Haiku, so this is cheap — but still real spend.)
    const reviewCostUsd = review.ai && typeof review.ai.costUsd === "number" ? review.ai.costUsd : 0;
    ctx.recordReviewCost(reviewCostUsd);

    if (!review.deterministic.ok) {
      throw new Error(`CRL4: additive change is not deterministically compliant: ${JSON.stringify(review.deterministic.findings)}`);
    }
  },
};
