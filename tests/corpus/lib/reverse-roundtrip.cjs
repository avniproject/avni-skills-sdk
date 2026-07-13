"use strict";
// Reverse-golden-input round trip:
//   reference bundle --reverse--> scoping.xlsx + modelling.xlsx --generate--> bundle'
//   diff(bundle', reference) on NAME COVERAGE  => generator fidelity given complete input.
// Because the input is seeded from the reference's own entities, any coverage
// shortfall is the generator dropping/mangling what it was explicitly given.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { reverseBundle } = require("./reverse-bundle.cjs");
const { generateFromXlsx } = require("../doorstep/lib/run-parity.cjs");
const { bundleActiveNames } = require("../doorstep/lib/entity-names.cjs");
const { diffNames } = require("../doorstep/lib/parity.cjs");

function readJson(fp) { try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; } }
function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
function activeConceptNames(dir) {
  const arr = readJson(path.join(dir, "concepts.json")) || [];
  const s = new Set();
  for (const c of arr) {
    if (!c || c.voided === true) continue;
    const n = norm(c.name);
    if (n) s.add(n);
  }
  return s;
}
function cov(present, total) { return total === 0 ? "n/a" : `${Math.round((present / total) * 100)}% (${present}/${total})`; }

// Concept names REACHABLE from live (non-voided) form elements + their live
// coded answers. This is the subset a form-driven generator can emit, so
// coverage against it is a fair generator-fidelity signal — unlike raw
// concepts.json coverage, which is inflated by rule/doc/voided-element concepts
// and coded-answer sub-concepts the reference carries but no live field uses.
function reachableConceptNames(dir) {
  const formsDir = path.join(dir, "forms");
  const s = new Set();
  if (!fs.existsSync(formsDir)) return s;
  for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
    const form = readJson(path.join(formsDir, f));
    if (!form || form.voided === true) continue;
    for (const grp of form.formElementGroups || []) {
      if (grp.voided === true) continue;
      for (const fe of grp.formElements || []) {
        if (fe.voided === true) continue;
        const c = fe.concept || {};
        if (c.name) s.add(norm(c.name));
        for (const a of c.answers || []) if (a && a.voided !== true && a.name) s.add(norm(a.name));
      }
    }
  }
  return s;
}

function roundTrip(org, referenceDir) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `rev-${org}-`));
  const rev = reverseBundle(referenceDir, outDir);

  let genDir, genErr = null;
  try {
    genDir = generateFromXlsx({ formsXlsx: rev.scopingPath, modelXlsx: rev.modellingPath, org });
  } catch (e) {
    genErr = (e.stderr || e.message || String(e)).slice(0, 1200);
  }

  console.log(`\n===== ${org} : reverse-golden-input round trip =====`);
  console.log(`reversed inputs: ${JSON.stringify(rev.stats)}`);
  console.log(`scoping:   ${rev.scopingPath}`);
  console.log(`modelling: ${rev.modellingPath}`);
  if (genErr) { console.log(`\n!! generation FAILED:\n${genErr}`); return { org, genErr, rev }; }

  const gen = bundleActiveNames(genDir);
  const ref = bundleActiveNames(referenceDir);
  const diff = diffNames(gen, ref);

  console.log(`\n-- name coverage (generated' vs reference) --`);
  for (const [k, c] of Object.entries(diff.classes)) {
    const tot = c.present.length + c.missing.length;
    console.log(`  ${k.padEnd(16)}: ${cov(c.present.length, tot).padEnd(16)}` +
      (c.missing.length ? ` MISSING[${c.missing.slice(0, 12).join(", ")}${c.missing.length > 12 ? ", …" : ""}]` : "") +
      (c.extra.length ? ` EXTRA[${c.extra.slice(0, 8).join(", ")}${c.extra.length > 8 ? ", …" : ""}]` : ""));
  }

  // concept coverage (entity-names doesn't cover concepts). Also report EXTRA
  // (concepts the generator made that the reference lacks) so under-generation
  // (subset) is distinguishable from mangling (churn).
  const genC = activeConceptNames(genDir), refC = activeConceptNames(referenceDir);
  let cPresent = 0; const cMissing = [];
  for (const n of refC) (genC.has(n) ? cPresent++ : cMissing.push(n));
  const cExtra = [...genC].filter((n) => !refC.has(n));
  console.log(`  ${"concepts (all)".padEnd(16)}: ${cov(cPresent, refC.size).padEnd(16)}` +
    ` [gen ${genC.size}, ref ${refC.size}, extra ${cExtra.length}]`);

  // reachability-fair: only reference concepts used by live form elements
  const refReach = reachableConceptNames(referenceDir);
  let rPresent = 0; const rMissing = [];
  for (const n of refReach) (genC.has(n) ? rPresent++ : rMissing.push(n));
  console.log(`  ${"concepts (live)".padEnd(16)}: ${cov(rPresent, refReach.size).padEnd(16)}` +
    ` [reachable-from-live-form-fields — fair generator-fidelity signal]` +
    (rMissing.length ? `\n${" ".repeat(20)}MISSING[${rMissing.slice(0, 14).join(", ")}${rMissing.length > 14 ? ", …" : ""}]` : ""));

  if (rev.notes.length) {
    console.log(`\n-- reverse notes (${rev.notes.length}) --`);
    for (const n of rev.notes.slice(0, 25)) console.log(`  · ${n}`);
    if (rev.notes.length > 25) console.log(`  … +${rev.notes.length - 25} more`);
  }
  return { org, diff, conceptCoverage: { present: cPresent, total: refC.size, missing: cMissing }, rev, genDir };
}

if (require.main === module) {
  const IMPL = process.env.SDK_CORPUS_IMPL_PATH || path.resolve(__dirname, "../../../../avni-impl-bundles");
  const org = process.argv[2] || "phulwari";
  const refDir = process.argv[3] || path.join(IMPL, "reference", org);
  if (!fs.existsSync(refDir)) { console.error(`reference not found: ${refDir}`); process.exit(1); }
  roundTrip(org, refDir);
}

module.exports = { roundTrip };
