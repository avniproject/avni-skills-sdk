#!/usr/bin/env node
"use strict";

// tests/eval/prose-scrub-eval.cjs — model-dependent EVAL for the AI layer of
// scrubProse(bundleDir, { ai: true }): crlGate scrub over the ai-judged
// "prose-as-entity-name" compliance rule (Haiku judge, src/crl/ai-judge.js).
//
// Plain Node script — NOT a `node --test` file, NOT matched by any `npm test`
// glob (package.json's "test" script only globs tests/entities, tests/discovery,
// tests/corpus/doorstep, scripts/recovery — never tests/eval/*.cjs directly),
// and NOT discovered by `npm run eval` (tests/eval/run.cjs only reads
// tests/eval/cases/*.cjs). Run it manually:
//
//   ANTHROPIC_API_KEY=sk-ant-... node tests/eval/prose-scrub-eval.cjs
//
// The deterministic layer (completenessFloor's looksLikeProse — numbering /
// trailing colon / "(N cards)" / >9 words) is already CI-tested in
// tests/entities/prose-scrub.test.cjs. This eval proves the AI layer catches
// what the deterministic layer structurally CANNOT — a short, unpunctuated,
// unnumbered sentence that still reads like a requirement line, not a form
// title — and that the AI layer never fires a false positive on the 5
// committed clean reference bundles.
//
// Two entities, budget-lean by design:
//   1. AI RECALL      — one synthetic bundle, one scrubProse({ai:true}) call.
//   2. AI FALSE-POS    — 5 reference-bundle scratch copies, one call each.
//
// Never mutates the committed reference bundles — always copies to a scratch
// tmp dir first (fs.cpSync into an mkdtemp'd dir), exactly like the
// deterministic guard in tests/entities/prose-scrub.test.cjs.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

async function loadScrubProse() {
  const m = await import(pathToFileURL(path.resolve(__dirname, "../../src/crl/prose-scrub.js")).href);
  return m.scrubProse;
}
async function loadCompletenessFloor() {
  const m = await import(pathToFileURL(path.resolve(__dirname, "../../src/completeness.js")).href);
  return m.completenessFloor;
}
async function loadBuildMinimalSkeleton() {
  const m = await import(pathToFileURL(path.resolve(__dirname, "../../src/agents/bundle-mcp-server.js")).href);
  return m.buildMinimalSkeleton;
}

function writeSkeleton(dir, files) {
  for (const [rel, val] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  }
}

// A short, unpunctuated, unnumbered sentence — reads like a requirement line
// lifted from a scoping doc, not a form title, but structurally invisible to
// looksLikeProse (src/completeness.js): no leading "N." / bullet, no trailing
// ":"/";", no "(N cards…)" marker, and only 7 words (<=9). Confirmed below
// (assertRecallPrecondition) that completenessFloor genuinely misses it before
// the AI pass is asked to catch it.
const PROSE_FORM_NAME = "weekly attendance is captured by the teacher";

const REFERENCE_ORGS = ["phulwari", "community", "farming", "social_security", "water_bodies"];

function log(...args) { console.log(...args); }

// Build a deterministic-clean bundle (buildMinimalSkeleton is proven
// validator-clean + integrity-clean — tests/entities/agent-author-mode.test.cjs)
// plus one extra prose-named, zero-element, unreferenced IndividualProfile
// form + its formMapping — so the ONLY thing for the AI pass to find is the
// prose name itself, not incidental deterministic noise elsewhere in the
// bundle (which would otherwise cost crlGate an extra AI retry pass).
function buildRecallBundle(buildMinimalSkeleton) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prose-eval-recall-"));
  const files = buildMinimalSkeleton();
  writeSkeleton(dir, files);

  const subjectType = files["subjectTypes.json"][0];
  const proseUuid = crypto.randomUUID();
  const mappingUuid = crypto.randomUUID();

  fs.writeFileSync(
    path.join(dir, "forms", `prose_${proseUuid}.json`),
    JSON.stringify({ name: PROSE_FORM_NAME, uuid: proseUuid, formType: "IndividualProfile", formElementGroups: [] }, null, 2),
  );

  const mappingsPath = path.join(dir, "formMappings.json");
  const mappings = JSON.parse(fs.readFileSync(mappingsPath, "utf8"));
  mappings.push({
    uuid: mappingUuid, formUUID: proseUuid, subjectTypeUUID: subjectType.uuid,
    formType: "IndividualProfile", formName: PROSE_FORM_NAME, enableApproval: false,
  });
  fs.writeFileSync(mappingsPath, JSON.stringify(mappings, null, 2));

  return dir;
}

// Confirm the deterministic pass genuinely misses PROSE_FORM_NAME — otherwise
// this eval would be testing the (already CI-tested) deterministic layer, not
// the AI layer.
function assertRecallPrecondition(floor) {
  const detCaught = (floor.findings || []).some(
    (f) => f.code === "PROSE_AS_ENTITY" && String(f.entity) === `form:${PROSE_FORM_NAME}`,
  );
  if (detCaught) {
    log(`  PRECONDITION FAIL: completenessFloor already flagged "${PROSE_FORM_NAME}" deterministically — `
      + `this fixture does not exercise the AI path. findings: ${JSON.stringify(floor.findings)}`);
    return false;
  }
  log(`  precondition OK: completenessFloor does NOT flag "${PROSE_FORM_NAME}" (genuinely AI-only)`);
  return true;
}

async function runRecall(scrubProse, completenessFloor, buildMinimalSkeleton) {
  log("--- 1. AI recall (synthetic prose form the deterministic pass misses) ---");
  log(`  fixture form name: "${PROSE_FORM_NAME}" (${PROSE_FORM_NAME.split(/\s+/).length} words, no numbering/colon)`);

  const dir = buildRecallBundle(buildMinimalSkeleton);
  try {
    const floor = completenessFloor(dir);
    const preconditionOk = assertRecallPrecondition(floor);

    const r = await scrubProse(dir, { ai: true });
    const hit = r.pruned.find((p) => p.name === PROSE_FORM_NAME && p.reason === "ai-judged");

    if (hit) {
      log(`  PASS: AI pass pruned "${PROSE_FORM_NAME}" (confidence=${hit.confidence})`);
    } else {
      log(`  FAIL: AI pass did NOT prune "${PROSE_FORM_NAME}".`);
      log(`    pruned:   ${JSON.stringify(r.pruned)}`);
      log(`    skipped:  ${JSON.stringify(r.skipped)}`);
      log(`    reverted: ${JSON.stringify(r.reverted)}`);
      if (r.error) log(`    error: ${r.error}`);
      const skippedAsReferenced = r.skipped.find(
        (s) => s.ruleId === "prose-as-entity-name" && s.target?.name === PROSE_FORM_NAME && s.reason === "referenced",
      );
      if (skippedAsReferenced) {
        log(`    likely cause: the AI judge does not receive real on-disk file paths for forms `
          + `(buildBundleProjection's form entries carry name/uuid/formType/elements only, no "file"), `
          + `so it guessed target.file="${skippedAsReferenced.target.file}" instead of the real `
          + `forms/*_<uuid>.json path. The executor's own-file exclusion in externalReferences() keys off `
          + `an exact target.file match, so the form's OWN uuid/name fields are then miscounted as an `
          + `EXTERNAL reference and guardrail 1 skips the prune as "referenced".`);
      }
    }
    return { pass: !!hit, preconditionOk, result: r };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runFalsePositiveGuard(scrubProse) {
  log("");
  log("--- 2. AI false-positive guard (5 clean reference bundles) ---");
  const implDir = path.resolve(__dirname, "../../../avni-impl-bundles/reference");
  const results = [];

  for (const org of REFERENCE_ORGS) {
    const srcDir = path.join(implDir, org);
    if (!fs.existsSync(srcDir)) {
      log(`  SKIP ${org}: reference bundle not found at ${srcDir} (optional in this checkout)`);
      results.push({ org, status: "skip" });
      continue;
    }
    // Copy to a scratch dir — NEVER mutate the committed reference bundle.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `prose-eval-ref-${org}-`));
    try {
      fs.cpSync(srcDir, scratch, { recursive: true });
      const r = await scrubProse(scratch, { ai: true });
      if (r.pruned.length === 0) {
        log(`  PASS ${org}: 0 prunes`);
        results.push({ org, status: "pass" });
      } else {
        log(`  FAIL ${org}: ${r.pruned.length} false-positive prune(s): ${JSON.stringify(r.pruned)}`);
        results.push({ org, status: "fail", pruned: r.pruned });
      }
      if (r.error) log(`    (scrubProse reported an internal error: ${r.error})`);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  return results;
}

function printSummary({ recall, falsePositives }) {
  const evaluated = falsePositives.filter((x) => x.status !== "skip");
  const skippedCount = falsePositives.filter((x) => x.status === "skip").length;
  const fpPrunes = evaluated.filter((x) => x.status === "fail").reduce((n, x) => n + x.pruned.length, 0);
  const truePositives = recall.pass ? 1 : 0;
  const falseNegatives = recall.pass ? 0 : 1;
  const precisionDenom = truePositives + fpPrunes;
  const recallDenom = truePositives + falseNegatives;
  const precision = precisionDenom === 0 ? 1 : truePositives / precisionDenom;
  const recallScore = recallDenom === 0 ? 1 : truePositives / recallDenom;

  log("");
  log("=== summary ===");
  log(`  recall fixture:      ${recall.pass ? "CAUGHT" : "MISSED"} ("${PROSE_FORM_NAME}")`);
  log(`  reference bundles:   ${evaluated.length} evaluated, ${skippedCount} skipped, ${fpPrunes} false-positive prune(s)`);
  log(`  precision: ${precision.toFixed(3)}   recall: ${recallScore.toFixed(3)}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    log("SKIP: no ANTHROPIC_API_KEY");
    process.exit(0);
  }

  log("=== prose-scrub AI eval (scrubProse(bundleDir, { ai: true })) ===");
  log("");

  const [scrubProse, completenessFloor, buildMinimalSkeleton] = await Promise.all([
    loadScrubProse(), loadCompletenessFloor(), loadBuildMinimalSkeleton(),
  ]);

  const recall = await runRecall(scrubProse, completenessFloor, buildMinimalSkeleton);
  const falsePositives = await runFalsePositiveGuard(scrubProse);

  printSummary({ recall, falsePositives });

  const failed = !recall.pass || !recall.preconditionOk || falsePositives.some((x) => x.status === "fail");

  log("");
  log(failed ? "FAIL" : "ALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("FAIL: unhandled error —", (e && e.stack) || e);
  process.exit(1);
});
