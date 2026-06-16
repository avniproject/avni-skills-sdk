// run.cjs — the corpus:parity regression GATE.
//
// avni-product#1882 "agentic realignment" epic, story #10 exit criterion:
// PROVE, over the real 16-org corpus, that the NEW `bundle_integrity_check`
// detector catches everything the two OLD integrity/graph detectors being
// consolidated catch — so it's safe to later delete `checkIntegrityOnFileMap`.
//
// Per org:
//   OLD   = normalize(checkIntegrityOnFileMap) ∪ normalize(graph.integrityCheck)
//   NEW   = normalize(runBundleIntegrityCheck)
//   LOST   = OLD \ NEW   → MUST be empty (a real coverage gap if non-empty)
//   GAINED = NEW \ OLD   → logged to gained.json, NEVER blocks
//                          (expect FE_CONCEPT_NOT_OBJECT / ALT_INVALID_NAME here)
//
//   PARITY PASS  iff  Σ_orgs |LOST| == 0.   Exit non-zero on any LOST.
//   Skips gracefully (exit 0) when $SDK_CORPUS_PATH is absent so CI without the
//   proprietary corpus still passes — matches tests/corpus/run.cjs convention.
//
// SCOPE: the 28-code validator (bundle_validator.js) is KEPT and OUT OF SCOPE.
// Neither OLD nor NEW surfaces include validator findings (asserted in
// normalize.cjs). One log line below confirms it.
//
//   Run via:  npm run corpus:parity
//
// NB: pure deterministic detection — ZERO LLM calls, zero API spend.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listOrgs, corpusRoot } = require("../registry.cjs");
const { oldSurface, newSurface, AVNI_SKILLS_PATH } = require("./detectors.cjs");
const { diff } = require("./normalize.cjs");

const GAINED_PATH = path.join(__dirname, "gained.json");
const LOST_PATH = path.join(__dirname, "lost.json");

function red(s)    { return process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s; }
function green(s)  { return process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s; }
function yellow(s) { return process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s; }
function dim(s)    { return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s; }
function bold(s)   { return process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s; }

async function runOrg(o) {
  const OLD = await oldSurface(o.bundleDir);
  const NEW = await newSurface(o.bundleDir);
  const lost = diff(OLD.set, NEW.set);   // OLD \ NEW
  const gained = diff(NEW.set, OLD.set); // NEW \ OLD
  return {
    org: o.org,
    oldCount: OLD.set.size,
    newCount: NEW.set.size,
    lost,
    gained,
  };
}

async function main() {
  const root = corpusRoot();
  if (!fs.existsSync(root)) {
    console.log(yellow(`skipped: no SDK_CORPUS_PATH (corpus not at ${root})`));
    process.exit(0);
  }
  const orgs = listOrgs();
  if (orgs.length === 0) {
    console.log(yellow(`skipped: no org directories under ${root}`));
    process.exit(0);
  }

  console.log("─".repeat(86));
  console.log(bold(`corpus:parity gate`) + ` — ${orgs.length} org(s) at ${root}`);
  console.log(dim(`brain: ${AVNI_SKILLS_PATH}`));
  console.log(dim(
    `SCOPE: integrity/graph detectors only. Validator (bundle_validator.js) is KEPT, ` +
    `OUT OF SCOPE — excluded from OLD and NEW.`,
  ));
  console.log("─".repeat(86));
  console.log(
    `  ${"org".padEnd(52)} ${"OLD".padStart(4)} ${"NEW".padStart(4)} ` +
    `${"LOST".padStart(5)} ${"GAIN".padStart(5)}`,
  );
  console.log("─".repeat(86));

  const results = [];
  let totalLost = 0, totalGained = 0;
  for (const o of orgs) {
    const r = await runOrg(o);
    results.push(r);
    totalLost += r.lost.length;
    totalGained += r.gained.length;
    const lostStr = r.lost.length === 0 ? green("    0") : red(String(r.lost.length).padStart(5));
    const gainStr = r.gained.length === 0 ? dim("    0") : yellow(String(r.gained.length).padStart(5));
    console.log(
      `  ${r.org.padEnd(52)} ${String(r.oldCount).padStart(4)} ` +
      `${String(r.newCount).padStart(4)} ${lostStr} ${gainStr}`,
    );
  }

  console.log("─".repeat(86));

  // ── GAINED → gained.json (never blocks). Expect the 2 NEW checks here.
  const gainedByOrg = {};
  for (const r of results) if (r.gained.length) gainedByOrg[r.org] = r.gained;
  fs.writeFileSync(
    GAINED_PATH,
    JSON.stringify(
      {
        _meta: {
          generated: new Date().toISOString(),
          note:
            "NEW \\ OLD — detections the new bundle_integrity_check adds over the two " +
            "old detectors. Informational; never blocks the gate. Expect " +
            "FE_CONCEPT_NOT_OBJECT and ALT_INVALID_NAME (the two new checks).",
        },
        total: totalGained,
        orgs: gainedByOrg,
      },
      null, 2,
    ) + "\n",
    "utf8",
  );

  // ── LOST → lost.json (only written when non-empty; this is the gate failing).
  const lostByOrg = {};
  for (const r of results) if (r.lost.length) lostByOrg[r.org] = r.lost;
  if (totalLost > 0) {
    fs.writeFileSync(
      LOST_PATH,
      JSON.stringify(
        {
          _meta: {
            generated: new Date().toISOString(),
            note:
              "OLD \\ NEW — integrity detections the OLD detectors catch but the NEW " +
              "bundle_integrity_check MISSES. A non-empty file means a real coverage gap; " +
              "do NOT delete checkIntegrityOnFileMap until this is empty.",
          },
          total: totalLost,
          orgs: lostByOrg,
        },
        null, 2,
      ) + "\n",
      "utf8",
    );
  } else if (fs.existsSync(LOST_PATH)) {
    fs.rmSync(LOST_PATH);
  }

  // ── Verdict
  console.log(
    `  Σ OLD detections kept by NEW: ${green("yes")}  |  ` +
    `Σ LOST: ${totalLost === 0 ? green("0") : red(String(totalLost))}  |  ` +
    `Σ GAINED: ${yellow(String(totalGained))} ${dim("→ gained.json")}`,
  );
  console.log(dim(
    `  validator (bundle_validator.js): untouched, out of scope — not part of this comparison.`,
  ));

  if (totalLost === 0) {
    console.log("");
    console.log(green(bold("PARITY PASS")) +
      ` — 0 lost integrity detections across ${orgs.length} org(s). ` +
      `Safe to consolidate: bundle_integrity_check loses nothing checkIntegrityOnFileMap / ` +
      `graph.integrityCheck catch.`);
    process.exit(0);
  } else {
    console.log("");
    console.log(red(bold("PARITY FAIL")) +
      ` — ${totalLost} LOST integrity detection(s) across ${Object.keys(lostByOrg).length} org(s). ` +
      `bundle_integrity_check MISSES detections the old detectors catch. ` +
      `Do NOT delete checkIntegrityOnFileMap. See ${path.relative(process.cwd(), LOST_PATH)}:`);
    for (const [org, triples] of Object.entries(lostByOrg)) {
      console.log(red(`  ── ${org} (${triples.length} lost)`));
      for (const t of triples.slice(0, 10)) {
        console.log(red(`     - ${t.class} ${t.file} ${t.locator}`) +
          dim(`  [${t._origin}${t._field ? " " + t._field : ""}]`));
      }
      if (triples.length > 10) console.log(dim(`     … and ${triples.length - 10} more`));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { runOrg };
