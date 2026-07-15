export const meta = {
  name: 'bundle-to-prod-ready',
  description:
    'Iterative test-and-develop loop that drives a freshly generated Avni bundle to prod-ready: generate a baseline session, then measure -> 3-lens review + adversarial refute -> consolidate -> fix -> regression-guard, looping until the deterministic floor is green with no confirmed findings (gate), the token budget is exhausted, or two dry iterations make no progress. Fixes edit only the session bundle; generator defects are logged, never auto-patched.',
  phases: [
    { title: 'Generate' },
    { title: 'Measure' },
    { title: 'Review' },
    { title: 'Consolidate' },
    { title: 'Fix' },
    { title: 'Regression-guard' },
  ],
};

// ── Sandbox note ──────────────────────────────────────────────────────────
// This script has NO filesystem / Node API access. Every fs/git/Node step is
// an agent() runner that shells out via Bash to a scripts/*.mjs (Tasks 1-3).
// Only pure orchestration + pure predicates live here. Working directory for
// every runner is the avni-skills-sdk repo root.

// ── Constants ─────────────────────────────────────────────────────────────
const RESERVE = 40000; // stop looping if fewer output tokens than this remain
const OPUS_FIX_KINDS = new Set([
  'semantic',
  'rule-authoring',
  'semantic-intent',
  'completeness-fill',
]);

// ── JSON Schemas (validate every agent result — no free-text parsing) ──────
const generateSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['sessionId', 'bundleDir'],
  properties: {
    sessionId: { type: 'string' },
    bundleDir: { type: 'string' },
  },
};

const scorecardSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['floorGreen'],
  properties: {
    validator: { type: 'object' },
    integrity: { type: 'object' },
    completeness: { type: 'object' },
    prose: { type: 'object' },
    parity: { type: ['object', 'null'] },
    floorGreen: { type: 'boolean' },
  },
};

const findingsSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['entity', 'category', 'kind', 'confidence'],
        properties: {
          entity: { type: 'string' },
          category: { type: 'string' },
          kind: { type: 'string' },
          confidence: { type: 'number' },
          rootCause: { type: 'string' },
        },
      },
    },
  },
};

const refuteSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['refuted'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

const consolidatedSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['findings', 'generatorDefects'],
  properties: {
    findings: { type: 'array', items: { type: 'object', additionalProperties: true } },
    generatorDefects: { type: 'array', items: { type: 'object', additionalProperties: true } },
    counts: { type: 'object' },
  },
};

const fixSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['fixed', 'summary'],
  properties: {
    fixed: { type: 'boolean' },
    summary: { type: 'string' },
  },
};

const revertSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['reverted'],
  properties: {
    reverted: { type: 'boolean' },
    head: { type: 'string' },
  },
};

const specDiffSchema = { type: 'object', additionalProperties: true };

// ── Pure predicate: did a fix regress the floor? (mirrors prod-loop-core) ──
// Regression = floor went green->red, OR any gate-family coverage dropped.
function regressed(before, after) {
  if (before && before.floorGreen && after && !after.floorGreen) return true;
  const bf = before && before.parity && before.parity.byFamily;
  const af = after && after.parity && after.parity.byFamily;
  if (bf && af) {
    for (const fam of ['subjectTypes', 'programs', 'encounterTypes', 'forms']) {
      const b = bf[fam];
      const a = af[fam];
      if (
        b &&
        a &&
        typeof b.coverage === 'number' &&
        typeof a.coverage === 'number' &&
        a.coverage < b.coverage
      ) {
        return true;
      }
    }
  }
  return false;
}

// ── Prompt builders ───────────────────────────────────────────────────────
const measureCmd = (bDir) =>
  `node scripts/measure-bundle.mjs ${JSON.stringify(bDir)}` +
  (args.uatZip ? ` ${JSON.stringify(args.uatZip)}` : '');

const generatePrompt = () => `You are a mechanical runner in the avni-skills-sdk repo (cwd = repo root).
Create a fresh BASELINE bundle session from these two workbooks and report where it landed.

Run exactly this (adapt only if it errors, by reading src/sessions.js):

  node --input-type=module -e '
  import fs from "node:fs";
  import { createSession, bundleDir } from "./src/sessions.js";
  const [scoping, modelling, org] = process.argv.slice(1);
  const r = createSession({
    formsBuffer: fs.readFileSync(scoping),
    formsFilename: "scoping.xlsx",
    modellingBuffer: modelling && modelling !== "-" ? fs.readFileSync(modelling) : undefined,
    modellingFilename: modelling && modelling !== "-" ? "modelling.xlsx" : undefined,
    org,
    mode: "baseline",
  });
  console.log(JSON.stringify({ sessionId: r.sessionId, bundleDir: bundleDir(r.sessionId) }));
  ' ${JSON.stringify(args.scopingXlsx)} ${JSON.stringify(args.modellingXlsx || '-')} ${JSON.stringify(args.org)}

The last stdout line is JSON { sessionId, bundleDir }. Return exactly that object.`;

const measurePrompt = (bDir) => `You are a mechanical runner in the avni-skills-sdk repo (cwd = repo root).
Run the deterministic bundle scorecard and return its JSON verbatim:

  ${measureCmd(bDir)}

This prints a JSON scorecard { validator, integrity, completeness, prose, parity, floorGreen } to stdout.
Do not edit the bundle. Return exactly the parsed scorecard object.`;

const lensPrompt = (lens, bDir, scorecard) => `You are the "${lens}" reviewer on a 3-lens panel auditing an Avni bundle for prod-readiness.
Bundle directory: ${bDir}
Deterministic scorecard (already measured — do NOT re-flag what it already caught):
${JSON.stringify(scorecard)}

Read the bundle files under that directory. Lens focus:
- correctness: entities/observations/rules that are internally inconsistent, dangling references, mis-typed concepts, wrong form associations.
- completeness: entities/rules/answers that the scoping+modelling intent implies but the bundle omits.
- semantic-intent: entities present but whose naming/wording/structure drifts from the requirement's meaning.

Report ONLY defects that fall under YOUR lens and are NOT already on the scorecard. For each, give:
  entity (e.g. "form:Household Registration" or "subjectType:Member"),
  category (short kebab slug), kind (one of: semantic, rule-authoring, semantic-intent,
  completeness-fill, reclassify-stray, or a mechanical slug), confidence (0..1),
  rootCause ("bundle" if the fix is a bundle edit, "generator" if the generator produced it wrong).
Return { findings: [...] } (empty array if your lens is clean).`;

const refutePrompt = (finding, bDir) => `You are an adversarial refuter. Try to REFUTE this claimed bundle defect against the actual files.
Bundle directory: ${bDir}
Claimed finding: ${JSON.stringify(finding)}

Read the relevant bundle files. If the finding is wrong, already satisfied, out of scope, or you cannot
positively confirm it, it is REFUTED. Only when you can positively confirm the defect is real is it NOT refuted.
Default to refuted when uncertain. Return { refuted: true|false, reason }.`;

const consolidatePrompt = (scorecard, confirmed) => `You are a mechanical runner in the avni-skills-sdk repo (cwd = repo root).
Merge the scorecard with the confirmed review findings via the deterministic consolidator.

1. Write the scorecard JSON to a temp file, e.g. /tmp/b2pr-scorecard.json:
${JSON.stringify(scorecard)}

2. Write the confirmed review findings JSON array to a temp file, e.g. /tmp/b2pr-review.json:
${JSON.stringify(confirmed)}

3. Run: node scripts/consolidate-findings.mjs /tmp/b2pr-scorecard.json /tmp/b2pr-review.json

It prints { findings, generatorDefects, counts } to stdout (bundle-fixable findings + logged generator defects).
Return exactly that parsed object.`;

const fixPrompt = (finding, bDir) => `You are a fix agent working ONLY inside the session bundle (never the generator).
Bundle directory (cwd for git): ${bDir}
Finding to fix: ${JSON.stringify(finding)}

Edit the bundle files under that directory to resolve THIS finding only (case-insensitive upsert: update in
place if the entity exists, else append copying field shapes from existing neighbours verbatim). Do not touch
unrelated entities. Then commit the change as one turn:
  git -C ${JSON.stringify(bDir)} add -A
  git -C ${JSON.stringify(bDir)} commit -m "fix: <short summary of this finding>"
If, after reading the files, the finding is not actually fixable as a bundle edit, make no change, do not commit,
and return fixed:false. Return { fixed: true|false, summary }.`;

const revertPrompt = (bDir) => `You are a mechanical runner. The last fix regressed the bundle floor. Revert exactly the last commit:
  git -C ${JSON.stringify(bDir)} reset --hard HEAD~1
Then report the new HEAD:
  git -C ${JSON.stringify(bDir)} rev-parse HEAD
Return { reverted: true, head: "<sha>" }.`;

const specDiffPrompt = (bDir) => `You are a mechanical runner in the avni-skills-sdk repo (cwd = repo root).
Emit the canonical spec for BOTH the candidate bundle and the UAT reference, then diff them.

Run a node --input-type=module script that:
  - imports { emitSpec } from "./src/pipeline.js";
  - builds candidate spec: read every JSON file under ${JSON.stringify(bDir)} into an object keyed by filename
    and call emitSpec({ existingBundleFiles, org: ${JSON.stringify(args.org)} });
  - builds uat spec: read the zip buffer ${JSON.stringify(args.uatZip)} and call
    emitSpec({ existingBundleZip: fs.readFileSync(uatZip), org: ${JSON.stringify(args.org)} });
  - prints a structured diff (entities/fields only in candidate vs only in uat vs differing).
Return { diff: <the structured diff>, summary: "<one line>" }.`;

// ── Phase 1: Generate baseline session ────────────────────────────────────
phase('Generate');
log(`Generating baseline bundle for org ${args.org}`);
const gen = await agent(generatePrompt(), {
  model: 'haiku',
  schema: generateSchema,
  phase: 'Generate',
  label: 'generate:baseline',
});
const bundleDir = gen.bundleDir;
log(`Baseline session ${gen.sessionId} at ${bundleDir}`);

// ── The loop ──────────────────────────────────────────────────────────────
const allDefects = [];
let iter = 0;
let dry = 0;
let reason = 'budget';
let lastScorecard = null;

while (iter < (args.maxIterations || 6) && budget.remaining() > RESERVE) {
  iter++;
  log(`── Iteration ${iter} (budget remaining ${budget.remaining()}) ──`);

  // ── Measure ──
  phase('Measure');
  const scorecard = await agent(measurePrompt(bundleDir), {
    model: 'haiku',
    schema: scorecardSchema,
    phase: 'Measure',
    label: `measure:iter${iter}`,
  });
  lastScorecard = scorecard;
  log(`Scorecard floorGreen=${scorecard.floorGreen}`);

  // ── Review: 3 Opus lenses in parallel, then Haiku adversarial refute ──
  phase('Review');
  const lenses = ['correctness', 'completeness', 'semantic-intent'];
  const lensResults = await parallel(
    lenses.map(
      (lens) => () =>
        agent(lensPrompt(lens, bundleDir, scorecard), {
          model: 'opus',
          schema: findingsSchema,
          phase: 'Review',
          label: `lens:${lens}:iter${iter}`,
        })
    )
  );
  const rawFindings = lensResults
    .filter(Boolean)
    .flatMap((r) => (r && Array.isArray(r.findings) ? r.findings : []));
  log(`Review raised ${rawFindings.length} finding(s); refuting…`);

  const refutes = await parallel(
    rawFindings.map(
      (f, i) => () =>
        agent(refutePrompt(f, bundleDir), {
          model: 'haiku',
          schema: refuteSchema,
          phase: 'Review',
          label: `refute:${i}:iter${iter}`,
        })
    )
  );
  // Default-to-refuted: keep only findings explicitly confirmed (refuted === false).
  const confirmedFindings = rawFindings.filter((f, i) => {
    const r = refutes[i];
    return r && r.refuted === false;
  });
  log(`${confirmedFindings.length} finding(s) survived refutation`);

  // ── Consolidate scorecard + confirmed findings ──
  phase('Consolidate');
  const consolidated = await agent(consolidatePrompt(scorecard, confirmedFindings), {
    model: 'haiku',
    schema: consolidatedSchema,
    phase: 'Consolidate',
    label: `consolidate:iter${iter}`,
  });
  if (Array.isArray(consolidated.generatorDefects) && consolidated.generatorDefects.length) {
    allDefects.push(...consolidated.generatorDefects);
    log(`Logged ${consolidated.generatorDefects.length} generator defect(s) (total ${allDefects.length})`);
  }
  const fixable = Array.isArray(consolidated.findings) ? consolidated.findings : [];

  // ── GATE: prod-ready ──
  if (scorecard.floorGreen && fixable.length === 0) {
    reason = 'gate';
    log('GATE PASSED — floor green, no findings. Bundle is prod-ready.');
    break;
  }

  // ── No-progress guard: nothing to fix but floor still red ──
  if (fixable.length === 0 && !scorecard.floorGreen) {
    dry++;
    log(`No fixable findings but floor red — dry iteration ${dry}/2`);
    if (dry >= 2) {
      reason = 'no-progress';
      log('Two dry iterations — stopping with best candidate.');
      break;
    }
    continue;
  }
  dry = 0;

  // ── Fix: sequential (agents edit the same dir; avoid conflicts) ──
  phase('Fix');
  for (const finding of fixable) {
    const fixModel = OPUS_FIX_KINDS.has(finding.kind) ? 'opus' : 'haiku';
    const res = await agent(fixPrompt(finding, bundleDir), {
      model: fixModel,
      schema: fixSchema,
      phase: 'Fix',
      label: `fix:${finding.entity || finding.category}:iter${iter}`,
    });
    log(`Fix (${fixModel}) ${finding.entity || finding.category}: fixed=${res.fixed} — ${res.summary}`);
  }

  // ── Regression-guard: re-measure; revert the last fix if the floor regressed ──
  phase('Regression-guard');
  const afterScorecard = await agent(measurePrompt(bundleDir), {
    model: 'haiku',
    schema: scorecardSchema,
    phase: 'Regression-guard',
    label: `remeasure:iter${iter}`,
  });
  if (regressed(scorecard, afterScorecard)) {
    log('Regression detected — reverting last fix.');
    const rev = await agent(revertPrompt(bundleDir), {
      model: 'haiku',
      schema: revertSchema,
      phase: 'Regression-guard',
      label: `revert:iter${iter}`,
    });
    log(`Reverted=${rev.reverted} head=${rev.head || '?'}`);
  } else {
    lastScorecard = afterScorecard;
  }
}

if (iter >= (args.maxIterations || 6) && reason === 'budget') {
  log(`Reached maxIterations (${args.maxIterations || 6}).`);
}

// ── Final: UAT-vs-candidate spec diff (only when a UAT reference is given) ──
let specDiff = null;
if (args.uatZip) {
  const sd = await agent(specDiffPrompt(bundleDir), {
    model: 'haiku',
    schema: specDiffSchema,
    phase: 'Regression-guard',
    label: 'spec-diff',
  });
  specDiff = sd;
}

return {
  bundleDir,
  iterations: iter,
  reason,
  generatorDefects: allDefects,
  floorGreen: lastScorecard ? !!lastScorecard.floorGreen : false,
  specDiff,
};
