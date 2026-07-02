#!/usr/bin/env node
// scripts/build-model-matrix.mjs
//
// (Re)builds the evidence-based model-qualification matrix (story #13, P5).
// API-FREE: it never calls an LLM. It either writes the DOCUMENTED interim seed
// or regenerates the matrix from an eval-results JSONL that a real (paid) eval
// run emitted. Deterministic + idempotent: same input → byte-identical output.
//
// ─── modes ───────────────────────────────────────────────────────────
//
//   node scripts/build-model-matrix.mjs --interim
//       Write the interim seed (clearly marked "interim — regenerate from a
//       real eval run"). Used to (re)generate the committed spec.
//
//   node scripts/build-model-matrix.mjs --in <results.jsonl> [--out <path>] [--threshold 1.0]
//       Regenerate the matrix from an eval-results JSONL, one JSON object per
//       line. Groups by model × category, computes pass-rates, and marks a
//       model qualified for a category iff its pass-rate ≥ threshold (default
//       1.0 = must pass every case in that category).
//
// ─── how to produce the eval-results JSONL (the paid step, run manually) ──
//
//   For EACH model you want to qualify, run the 20-case enforcing eval suite
//   against it, appending its per-case results to one shared JSONL file:
//
//     export ANTHROPIC_API_KEY=sk-ant-...          # the paid key
//     export SDK_EVAL_BUDGET_USD=5
//     export SDK_EVAL_RESULTS_JSONL=./eval-results.jsonl   # harness appends here
//     SDK_EVAL_MODEL=claude-sonnet-4-6 npm run eval
//     SDK_EVAL_MODEL=claude-haiku-4-5  npm run eval
//     SDK_EVAL_MODEL=claude-opus-4-8   npm run eval
//
//   Then regenerate the matrix (no key, no spend):
//
//     node scripts/build-model-matrix.mjs --in ./eval-results.jsonl
//
//   Each JSONL line has the shape the harness emits:
//     { runId, model, date, name, category, status, cost, durationMs }
//   Only `model`, `category`, and `status` are load-bearing here; `status` is
//   counted as pass/fail (pending/skipped are ignored so a budget-halted run
//   never mis-qualifies a model on a partial category).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATRIX_PATH,
  CATEGORIES,
  computeChecksum,
  deriveToolTiers,
  costRankOf,
} from "../src/model-matrix.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_MODEL = "claude-sonnet-4-6"; // the #11 default — the no-evidence floor

// ─── args ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { interim: false, in: null, out: null, threshold: 1.0, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--interim") out.interim = true;
    else if (a === "--in") out.in = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--threshold") out.threshold = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

const HELP = `build-model-matrix.mjs — (re)build spec/model-qualification.json (API-free)

  --interim               write the documented interim seed
  --in <results.jsonl>    regenerate from an eval-results JSONL
  --out <path>            output path (default: spec/model-qualification.json)
  --threshold <0..1>      qualification pass-rate cutoff (default 1.0)
  -h, --help              this help

See the file header for how to produce the eval-results JSONL (the paid step).`;

// ─── shared matrix assembly ─────────────────────────────────────────

// Assemble the full matrix doc from a { model → entry } map + provenance.
function assembleMatrix({ models, source, generatedAt, note, runIds }) {
  const orderedModels = {};
  for (const model of Object.keys(models).sort((a, b) => {
    const d = costRankOf(a) - costRankOf(b);
    return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
  })) {
    orderedModels[model] = models[model];
  }
  const doc = {
    version: 1,
    source,
    generatedAt: generatedAt ?? null,
    ...(runIds && runIds.length ? { runIds } : {}),
    note,
    categories: [...CATEGORIES],
    fallbackModel: FALLBACK_MODEL,
    models: orderedModels,
    checksum: computeChecksum(orderedModels),
  };
  return doc;
}

// ─── interim seed ────────────────────────────────────────────────────
//
// DOCUMENTED interim qualification — a JUDGMENT, not eval data. Marked so it is
// impossible to mistake for real evidence: source="interim", runId=null,
// passRate=null, and a rationale on every cell. MUST be replaced by real numbers
// via `--in <eval-results.jsonl>` once the paid eval run is done.
const INTERIM = {
  // #11 default: safe across the board pending evidence.
  "claude-sonnet-4-6": {
    "data-integrity": true, "safety-refusal": true, "correctness": true,
    "no-thrash": true, "srs-authorship": true,
    _why: "interim: #11 default — treated as safe across all categories pending eval evidence",
  },
  // Cheapest model: interim-qualified ONLY for the low-risk no-thrash category
  // (explain / verify / pure-question — no structural mutation). Deliberately
  // NOT qualified for structural categories so the interim never downgrades
  // data-integrity/correctness/srs-authorship to it without real evidence.
  "claude-haiku-4-5": {
    "data-integrity": false, "safety-refusal": false, "correctness": false,
    "no-thrash": true, "srs-authorship": false,
    _why: "interim: cheapest model — low-risk explain/verify only; not trusted for structural work pending eval",
  },
  // Strongest model: interim-qualified across the board, the escalation target
  // for the hardest categories once evidence differentiates it from sonnet.
  "claude-opus-4-8": {
    "data-integrity": true, "safety-refusal": true, "correctness": true,
    "no-thrash": true, "srs-authorship": true,
    _why: "interim: strongest model — qualified for the hardest categories",
  },
};

function buildInterim() {
  const models = {};
  for (const [model, table] of Object.entries(INTERIM)) {
    const qualification = {};
    for (const cat of CATEGORIES) {
      qualification[cat] = {
        qualified: !!table[cat],
        source: "interim",
        runId: null,
        passed: null,
        total: null,
        passRate: null,
        rationale: table._why,
      };
    }
    models[model] = {
      costRank: costRankOf(model),
      toolTiers: deriveToolTiers(qualification),
      qualification,
    };
  }
  return assembleMatrix({
    models,
    source: "interim-seed",
    generatedAt: null,
    note:
      "INTERIM SEED — this qualification is a documented judgment, NOT eval data. " +
      "Regenerate from a real eval run: run the 20-case suite per model with " +
      "SDK_EVAL_RESULTS_JSONL set (see scripts/build-model-matrix.mjs header), then " +
      "`node scripts/build-model-matrix.mjs --in <results.jsonl>`. Until then, selection " +
      "falls back to the #11 default (claude-sonnet-4-6) for any category with no qualified model.",
  });
}

// ─── regenerate from eval-results JSONL ─────────────────────────────

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); }
    catch (e) { throw new Error(`bad JSONL line in ${file}: ${e.message}\n  ${t.slice(0, 200)}`); }
    rows.push(obj);
  }
  return rows;
}

function buildFromResults(rows, threshold) {
  // group[model][category] = { passed, total, runIds:Set, dates:Set }
  const group = {};
  let maxDate = null;
  const allRunIds = new Set();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const { model, category, status } = r;
    if (!model || !category) continue;
    // Count only decisive outcomes; pending/skipped(budget) are ignored so a
    // partial run can't accidentally qualify (or disqualify) a category.
    if (status !== "pass" && status !== "fail") continue;
    group[model] = group[model] || {};
    const g = (group[model][category] = group[model][category] || { passed: 0, total: 0, runIds: new Set(), dates: new Set() });
    g.total += 1;
    if (status === "pass") g.passed += 1;
    if (r.runId) { g.runIds.add(r.runId); allRunIds.add(r.runId); }
    if (r.date) { g.dates.add(r.date); if (!maxDate || r.date > maxDate) maxDate = r.date; }
  }

  const models = {};
  for (const model of Object.keys(group)) {
    const qualification = {};
    for (const cat of CATEGORIES) {
      const g = group[model][cat];
      if (!g) {
        // No cases seen for this category → not qualified, no evidence.
        qualification[cat] = {
          qualified: false, source: "eval-run", runId: null,
          passed: 0, total: 0, passRate: null,
          rationale: "no eval cases observed for this category",
        };
        continue;
      }
      const passRate = g.total > 0 ? g.passed / g.total : 0;
      qualification[cat] = {
        qualified: g.total > 0 && passRate >= threshold,
        source: "eval-run",
        runId: [...g.runIds].sort().join(",") || null,
        passed: g.passed,
        total: g.total,
        passRate: Number(passRate.toFixed(4)),
      };
    }
    models[model] = {
      costRank: costRankOf(model),
      toolTiers: deriveToolTiers(qualification),
      qualification,
    };
  }

  return assembleMatrix({
    models,
    source: "eval-run",
    generatedAt: maxDate,
    runIds: [...allRunIds].sort(),
    note:
      `Regenerated from eval results (threshold=${threshold}; a model is qualified for a ` +
      `category iff it passed every counted case). Rebuild: ` +
      `node scripts/build-model-matrix.mjs --in <results.jsonl>.`,
  });
}

// Stable, human-diffable serialization. 2-space indent, trailing newline.
export function serializeMatrix(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

// Exported so tests can build a matrix from synthetic JSONL rows without disk.
export { buildFromResults, buildInterim };

// ─── main ────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.interim && !args.in)) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  const outPath = args.out ? path.resolve(args.out) : MATRIX_PATH;
  let doc;
  if (args.interim) {
    doc = buildInterim();
  } else {
    const rows = readJsonl(path.resolve(args.in));
    doc = buildFromResults(rows, args.threshold);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serializeMatrix(doc));
  console.error(`wrote ${outPath} (source=${doc.source}, models=${Object.keys(doc.models).length}, checksum=${doc.checksum.slice(0, 16)}…)`);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
