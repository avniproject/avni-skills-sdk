// snapshot.cjs — freeze the OLD detection surface per org to baseline-detections.json.
//
// The OLD surface = normalize(checkIntegrityOnFileMap) ∪ normalize(graph.integrityCheck).
// This is the contract the NEW detector must not regress against. The runner
// (run.cjs) recomputes OLD live each run too — the baseline is the COMMITTED
// witness so reviewers can see exactly what the gate is asserting parity over
// without needing the proprietary corpus.
//
//   Run via:  npm run corpus:parity:snapshot
//   Gated on $SDK_CORPUS_PATH — skips (exit 0) when the corpus is absent.
//
// The baseline records ONLY normalised triples (class/file/locator + diagnostic
// context). It contains UUIDs that reference missing entities, never proprietary
// PII or SRS content — but since the real corpus produces ZERO dangling refs
// (these are production bundles that uploaded cleanly), the committed baseline is
// expected to be empty per org. If a future corpus has real dangling refs, the
// baseline will record their (non-PII) referenced UUIDs.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { listOrgs, corpusRoot } = require("../registry.cjs");
const { oldSurface } = require("./detectors.cjs");

// The COMMITTED witness must not enumerate the proprietary corpus's membership
// (CLAUDE.md §2 — the repo ships zero proprietary data). We key the baseline by
// a stable, salted short hash of the org name, not the org name itself. The hash
// is deterministic so the committed witness is reproducible, but it does not
// disclose which NGOs are in the corpus. The local run (run.cjs) prints REAL org
// names to the terminal — those are never written to a committed file.
const ORG_KEY_SALT = "avni-corpus-parity-v1";
function orgKey(orgName) {
  return "org_" + crypto.createHash("sha256")
    .update(ORG_KEY_SALT + "\0" + orgName)
    .digest("hex").slice(0, 12);
}

const BASELINE_PATH = path.join(__dirname, "baseline-detections.json");

function yellow(s) { return process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s; }
function green(s)  { return process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s; }

async function buildBaseline() {
  const orgs = listOrgs();
  const baseline = {
    _meta: {
      generated: new Date().toISOString(),
      detectors: ["checkIntegrityOnFileMap", "graph.integrityCheck"],
      note:
        "OLD detection surface (the two detectors being consolidated), normalised to " +
        "{class,file,locator} triples. The NEW bundle_integrity_check must lose none of these. " +
        "Validator (bundle_validator.js) findings are OUT OF SCOPE and excluded. " +
        "Org keys are salted hashes — the committed witness never enumerates the corpus's " +
        "NGO membership (CLAUDE.md §2). Real org names print to the terminal only.",
      orgCount: orgs.length,
    },
    orgs: {},
  };
  for (const o of orgs) {
    const { triples } = await oldSurface(o.bundleDir);
    // Key by salted hash, not org name (see header). triples carry only
    // {class,file,locator} + diagnostic context (referenced UUIDs), never PII.
    baseline.orgs[orgKey(o.org)] = triples;
  }
  return baseline;
}

async function main() {
  const root = corpusRoot();
  if (!fs.existsSync(root)) {
    console.log(yellow(`skipped: no SDK_CORPUS_PATH (corpus not at ${root})`));
    process.exit(0);
  }
  const baseline = await buildBaseline();
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  const total = Object.values(baseline.orgs).reduce((n, a) => n + a.length, 0);
  console.log(
    green(`✓ baseline frozen`) +
    ` — ${Object.keys(baseline.orgs).length} org(s), ${total} OLD detection(s) → ${path.relative(process.cwd(), BASELINE_PATH)}`,
  );
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { buildBaseline, BASELINE_PATH };
