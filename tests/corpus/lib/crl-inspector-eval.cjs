"use strict";
// Pure, deterministic seeded-defect catch scorer. Given an already-produced
// AiFinding[] (from src/crl/ai-judge.js via reviewBundle), checks whether ANY
// finding correctly flags the seeded defect's target (by uuid or name) with a
// "catch" verdict. No LLM call happens here — it only scores findings the
// caller already obtained from the AI-judged pass.
const { bundleDeepNames } = require("./deep-names.cjs");
// Reuse the SAME normalizer bundleDeepNames itself uses (minors 33/44) — the
// novelty check and the byName match must never diverge on voided-suffix
// stripping / whitespace collapse.
const { normalizeName } = require("../doorstep/lib/entity-names.cjs");

// The AiFinding.verdict values (contract §2.1 / the real ai-judge SYSTEM_PROMPT
// enum) that count as "the inspector correctly identified this as
// non-compliant" — "compliant" (or an absent verdict) never counts, even if the
// target name matches.
const CATCH_VERDICTS = new Set(["stray", "orphan", "contradicts-intent", "incoherent-name"]);

function inspectorCatch(cleanDir, seededDefect, aiFindings) {
  const uuids = new Set(seededDefect.uuids || []);
  const names = new Set((seededDefect.names || []).map(normalizeName));

  const clean = bundleDeepNames(cleanDir);
  const cleanNameUniverse = new Set([
    ...clean.concepts, ...clean.formElements, ...clean.forms,
    ...clean.codedAnswers, ...clean.ruleFields,
  ]);
  const seededWasNovel = ![...names].some((n) => cleanNameUniverse.has(n));

  const matched = [];
  for (const f of aiFindings || []) {
    if (!f || !f.target) continue;
    if (!CATCH_VERDICTS.has(f.verdict)) continue;
    const byUuid = f.target.uuid && uuids.has(f.target.uuid);
    const byName = f.target.name && names.has(normalizeName(f.target.name));
    if (byUuid || byName) matched.push(f);
  }

  return { caught: matched.length > 0, matched, matchedCount: matched.length, seededWasNovel, seededDefect };
}

module.exports = { inspectorCatch, CATCH_VERDICTS };
