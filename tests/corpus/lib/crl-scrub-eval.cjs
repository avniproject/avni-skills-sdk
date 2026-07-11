"use strict";
// Pure, deterministic scrub scorer: diffs a bundle dir against an oracle dir
// and reports strays still present (extra) vs real entries wrongly removed
// (missing = present-loss). No LLM — reuses bundleDeepNames/diffDeep, the SAME
// engine the I4-parity floor uses. Callers (tests/eval/cases/25-scrub-strays.cjs)
// call this TWICE — once against the pre-scrub bundle, once post-scrub — to
// derive precision (never prune a real entry) and recall (strays actually caught).
const { bundleDeepNames } = require("./deep-names.cjs");
const { diffDeep } = require("./deep-diff.cjs");

function scrubScore(scrubbedDir, oracleDir) {
  const gen = bundleDeepNames(scrubbedDir);
  const oracle = bundleDeepNames(oracleDir);
  const diff = diffDeep(gen, oracle);
  let extraCount = 0, presentLossCount = 0;
  const extraByClass = {}, missingByClass = {};
  for (const [k, c] of Object.entries(diff.classes)) {
    if (c.extra.length) { extraByClass[k] = c.extra; extraCount += c.extra.length; }
    if (c.missing.length) { missingByClass[k] = c.missing; presentLossCount += c.missing.length; }
  }
  return { extraCount, presentLossCount, extraByClass, missingByClass, classes: diff.classes };
}

module.exports = { scrubScore };
