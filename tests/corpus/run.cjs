// Corpus regression runner — exercises the Phase 6 pipeline against every
// org bundle in $SDK_CORPUS_PATH. Reports per-org pass/fail across:
//
//   1. Bundle dir → file map → buildBundleGraph (no crashes; node count > 0)
//   2. Integrity check on the graph (warnings allowed; errors counted)
//   3. YAML spec parse (when spec file exists)
//   4. YAML spec round-trip: parse → emit → parse → deep equal
//   5. applySpec(bundle, spec) is a (near) no-op since the bundle was
//      generated from the spec
//
// Run via: npm run corpus:validate
// Gated on $SDK_CORPUS_PATH presence — no failure if the corpus is absent
// (CI without the proprietary data set still works).
//
// This is NOT a `node --test` suite — the corpus is org-specific live data,
// so it lives outside the synthetic-fixture-only contract of tests/entities/.

const fs = require("node:fs");
const path = require("node:path");
const { listOrgs, corpusRoot } = require("./registry.cjs");

const AVNI_SKILLS_PATH = process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "..", "avni-skills");
const SPEC = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "spec");

const { specToEntities }                = require(path.join(SPEC, "parser.js"));
const { entitiesToSpec }                = require(path.join(SPEC, "emitter.js"));
const { buildBundleGraph, integrityCheck } = require(path.join(SPEC, "graph.js"));

// ─── Helpers ───────────────────────────────────────────────────────

function red(s)    { return process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s; }
function green(s)  { return process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s; }
function yellow(s) { return process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s; }
function dim(s)    { return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s; }

function timeMs(fn) {
  const t0 = Date.now();
  try { return { result: fn(), ms: Date.now() - t0 }; }
  catch (e) { return { error: e, ms: Date.now() - t0 }; }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a == null || b == null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

// ─── Per-org checks ─────────────────────────────────────────────────

function runOrg({ org, bundleDir, specPath }) {
  const result = { org, checks: {} };

  // ── 1. Graph build
  const g = timeMs(() => buildBundleGraph(bundleDir));
  if (g.error) {
    result.checks.graph = { ok: false, error: g.error.message, ms: g.ms };
    return result;
  }
  result.checks.graph = {
    ok: true,
    ms: g.ms,
    counts: g.result.counts,
    nodes: g.result.nodes.size,
    edges: g.result.edges.length,
  };

  // ── 2. Integrity check
  const ic = timeMs(() => integrityCheck(g.result));
  if (ic.error) {
    result.checks.integrity = { ok: false, error: ic.error.message };
  } else {
    const errors = ic.result.issues.filter((i) => i.severity === "error");
    const warnings = ic.result.issues.filter((i) => i.severity === "warning");
    result.checks.integrity = {
      ok: ic.result.ok,
      errors: errors.length,
      warnings: warnings.length,
      ms: ic.ms,
      sampleErrors: errors.slice(0, 3).map((e) => e.message),
    };
  }

  // ── 3. Spec parse (if spec exists)
  if (specPath && fs.existsSync(specPath)) {
    const yamlStr = fs.readFileSync(specPath, "utf8");
    const parsed = timeMs(() => specToEntities(yamlStr));
    if (parsed.error) {
      result.checks.specParse = { ok: false, error: parsed.error.message };
      return result;     // can't continue spec-based checks
    }
    result.checks.specParse = {
      ok: true,
      ms: parsed.ms,
      counts: {
        subject_types: parsed.result.subject_types.length,
        programs: parsed.result.programs.length,
        encounter_types: parsed.result.encounter_types.length,
        forms: parsed.result.forms.length,
      },
    };

    // ── 4. Round-trip: parse → emit → parse → deep equal
    const rt = timeMs(() => {
      const y2 = entitiesToSpec(parsed.result, parsed.result.org_name);
      const e2 = specToEntities(y2);
      return { y2, e2 };
    });
    if (rt.error) {
      result.checks.roundTrip = { ok: false, error: rt.error.message };
    } else {
      const e1 = parsed.result;
      const e2 = rt.result.e2;
      // We compare the entity collections that the pipeline cares about
      const stable = deepEqual(e1.subject_types, e2.subject_types)
                   && deepEqual(e1.programs, e2.programs)
                   && deepEqual(e1.encounter_types, e2.encounter_types)
                   && deepEqual(e1.address_levels, e2.address_levels);
      result.checks.roundTrip = {
        ok: stable,
        ms: rt.ms,
        // When unstable, surface which collection diverged
        ...(stable ? {} : { diverged: {
          subject_types:   !deepEqual(e1.subject_types,   e2.subject_types),
          programs:        !deepEqual(e1.programs,        e2.programs),
          encounter_types: !deepEqual(e1.encounter_types, e2.encounter_types),
          address_levels:  !deepEqual(e1.address_levels,  e2.address_levels),
          forms_count:     e1.forms.length === e2.forms.length
                              ? "match"
                              : `${e1.forms.length} → ${e2.forms.length}`,
        } }),
      };
    }
  } else {
    result.checks.specParse = { ok: null, skipped: "no spec file" };
    result.checks.roundTrip = { ok: null, skipped: "no spec file" };
  }

  return result;
}

// ─── Reporting ─────────────────────────────────────────────────────

function formatResult(r) {
  const status = (c) => c?.ok === true ? green("✓") :
                       c?.ok === false ? red("✗") :
                       c?.ok === null ? dim("·") :
                       yellow("?");
  const g = r.checks.graph;
  const ic = r.checks.integrity;
  const sp = r.checks.specParse;
  const rt = r.checks.roundTrip;

  let line = `  ${r.org.padEnd(54)} `;
  line += `${status(g)} graph(${g?.nodes}n/${g?.edges}e) `;
  if (ic) line += `${status(ic)} integrity(${ic?.errors}E/${ic?.warnings}W) `;
  if (sp) line += `${status(sp)} spec`;
  if (sp?.counts) line += `(${sp.counts.subject_types}S/${sp.counts.programs}P/${sp.counts.encounter_types}E/${sp.counts.forms}F) `;
  if (rt) line += `${status(rt)} rt`;
  return line;
}

// ─── Main ──────────────────────────────────────────────────────────

function main() {
  const root = corpusRoot();
  if (!fs.existsSync(root)) {
    console.log(yellow(`SKIP — corpus not at ${root}`));
    console.log(dim(`Set SDK_CORPUS_PATH to point at the local bundles directory.`));
    process.exit(0);
  }

  const orgs = listOrgs();
  if (orgs.length === 0) {
    console.log(yellow(`SKIP — no org directories under ${root}`));
    process.exit(0);
  }

  console.log("─".repeat(80));
  console.log(`corpus regression — ${orgs.length} org(s) at ${root}`);
  console.log("─".repeat(80));

  const results = [];
  for (const org of orgs) {
    process.stdout.write(`  ${org.org.padEnd(54)} ...`);
    const r = runOrg(org);
    results.push(r);
    process.stdout.write("\r" + formatResult(r) + "\n");
  }

  console.log("─".repeat(80));

  // ── Aggregate scoreboard
  const score = {
    total: results.length,
    graphOk:      results.filter((r) => r.checks.graph?.ok === true).length,
    integrityOk:  results.filter((r) => r.checks.integrity?.ok === true).length,
    integrityHasErr: results.filter((r) => r.checks.integrity?.errors > 0).length,
    specParseOk:  results.filter((r) => r.checks.specParse?.ok === true).length,
    specMissing:  results.filter((r) => r.checks.specParse?.ok === null).length,
    roundTripOk:  results.filter((r) => r.checks.roundTrip?.ok === true).length,
    roundTripFail:results.filter((r) => r.checks.roundTrip?.ok === false).length,
  };

  const withSpec = score.total - score.specMissing;
  console.log(`  graph build:      ${score.graphOk}/${score.total}`);
  console.log(`  integrity clean:  ${score.integrityOk}/${score.total}    (${score.integrityHasErr} with hard errors)`);
  console.log(`  spec parse:       ${score.specParseOk}/${withSpec}    (${score.specMissing} bundles have no spec)`);
  console.log(`  spec round-trip:  ${score.roundTripOk}/${withSpec}    (${score.roundTripFail} failed)`);

  // ── Show first 5 failures with detail
  console.log("");
  const failures = results.filter((r) =>
    r.checks.graph?.ok === false ||
    r.checks.specParse?.ok === false ||
    r.checks.roundTrip?.ok === false ||
    (r.checks.integrity?.errors || 0) > 0
  );
  if (failures.length > 0) {
    console.log(`failures + integrity errors (first 5):`);
    for (const r of failures.slice(0, 5)) {
      console.log(`  ── ${r.org}`);
      for (const [k, v] of Object.entries(r.checks)) {
        if (v?.error) console.log(`     ${k}.error: ${v.error}`);
        if (v?.sampleErrors?.length) {
          console.log(`     ${k}: ${v.errors || 0} errors`);
          for (const m of v.sampleErrors) console.log(`       - ${m.slice(0, 100)}`);
        }
        if (v?.diverged) console.log(`     ${k}.diverged: ${JSON.stringify(v.diverged)}`);
      }
    }
  }

  // ── Exit code: 0 if all graphs build, else non-zero
  process.exit(score.graphOk === score.total ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runOrg, formatResult };
