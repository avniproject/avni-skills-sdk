#!/usr/bin/env node
/**
 * Multi-org generator + validator run.
 *
 * Generates a bundle for each org you list in `--manifest`, runs the AVNI
 * server-contract validator against each output, and prints a single comparison
 * table classifying errors as:
 *   - F2 cross-group concept reuse (semantic — needs an LLM agent)
 *   - program / subject resolution gaps (generator side, often SRS incompleteness)
 *   - form / concept / shape violations (server-contract bugs)
 *   - other
 *
 * Manifest is a JSON array. Each entry:
 *   { "org": "<name>", "forms": "<path-to-Forms.xlsx>", "modelling": "<optional>" }
 *
 * Usage:
 *   node scripts/multi-org-run.js --manifest=./manifest.json --out=./out
 *
 *   AVNI_SKILLS_PATH must point at a checkout of avniproject/avni-skills.
 */

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const args = Object.fromEntries(
  process.argv.slice(2).map(s => s.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true])
);

const AVNI_SKILLS_PATH =
  process.env.AVNI_SKILLS_PATH ||
  path.resolve(__dirname, "..", "..", "avni-skills");

if (!fs.existsSync(AVNI_SKILLS_PATH)) {
  console.error("avni-skills not found at " + AVNI_SKILLS_PATH);
  console.error("Set AVNI_SKILLS_PATH or clone avni-skills as a sibling of this repo.");
  process.exit(2);
}

const GENERATOR = path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "scripts", "generate_bundle_v2.js");
const { BundleValidator } = require(path.join(AVNI_SKILLS_PATH, "srs-bundle-generator", "validators", "bundle_validator"));

const manifestPath = args.manifest || path.join(__dirname, "..", "examples", "manifest.example.json");
const outBase = args.out || path.join(process.cwd(), "multi-org-out");

if (!fs.existsSync(manifestPath)) {
  console.error("Manifest not found: " + manifestPath);
  process.exit(2);
}
fs.mkdirSync(outBase, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function classifyError(e) {
  if (/^F2:/.test(e)) return "F2_semantic";
  if (/^F[1-9]:/.test(e)) return "form_validation";
  if (/^C[1-9]:/.test(e)) return "concept_validation";
  if (/^D[1-9]:/.test(e)) return "duplicate_validation";
  if (/^M[1-9]:/.test(e)) return "mapping_validation";
  if (/Form not found/i.test(e)) return "mapping_validation";
  if (/Missing operational file|Missing required file/i.test(e)) return "missing_file";
  if (/programUUID but it's missing|references program UUID/i.test(e)) return "program_resolution";
  if (/subjectTypeUUID/i.test(e)) return "subject_resolution";
  if (/encounterTypeUUID/i.test(e)) return "encounter_resolution";
  if (/bare array|wrapper key/i.test(e)) return "shape_violation";
  if (/Inconsistent dataType/i.test(e)) return "dataType_drift";
  return "other";
}

const rows = [];
for (const entry of manifest) {
  const { org, forms, modelling } = entry;
  if (!fs.existsSync(forms)) {
    rows.push({ org, ok: false, error: "forms file not found: " + forms });
    continue;
  }
  const out = path.join(outBase, org);
  fs.rmSync(out, { recursive: true, force: true });

  const cliArgs = ["--forms", forms, "--org", org, "--output", out, "--no-validate"];
  if (modelling && fs.existsSync(modelling)) {
    cliArgs.unshift("--srs", modelling);
  }

  let ok = false, generationMs = 0, generatorError = null;
  const t0 = Date.now();
  try {
    execSync(`node "${GENERATOR}" ${cliArgs.map(a => `"${a}"`).join(" ")}`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    ok = true;
  } catch (e) {
    generatorError = (e.stderr?.toString() || e.message).slice(0, 250).replace(/\n/g, " ");
  }
  generationMs = Date.now() - t0;

  let validatorResult = null, classified = {}, counts = {};
  if (ok) {
    try {
      const orig = console.log; console.log = () => {};
      const r = new BundleValidator(out).validate();
      console.log = orig;
      validatorResult = { errors: r.errors.length, warnings: r.warnings.length };
      for (const e of r.errors) {
        const cat = classifyError(e);
        classified[cat] = (classified[cat] || 0) + 1;
      }
      counts = {
        concepts:        (JSON.parse(fs.readFileSync(path.join(out, "concepts.json"))) || []).length,
        forms:           fs.existsSync(path.join(out, "forms")) ? fs.readdirSync(path.join(out, "forms")).length : 0,
        programs:        (JSON.parse(fs.readFileSync(path.join(out, "programs.json"))) || []).length,
        encounterTypes:  (JSON.parse(fs.readFileSync(path.join(out, "encounterTypes.json"))) || []).length,
        subjectTypes:    (JSON.parse(fs.readFileSync(path.join(out, "subjectTypes.json"))) || []).length,
      };
    } catch (e) {
      validatorResult = { error: e.message.slice(0, 200) };
    }
  }
  rows.push({ org, ok, generationMs, generatorError, validatorResult, classified, counts });
}

console.log("\nMULTI-ORG GENERATOR RUN — " + manifest.length + " orgs\n");
console.log("Generation:");
console.log("  org              gen?  ms       concepts  forms  prog  enc  subj");
console.log("  " + "-".repeat(70));
for (const r of rows) {
  if (!r.ok) {
    console.log(`  ${r.org.padEnd(15)}   X     (${r.generatorError ?? "missing input"})`.slice(0, 100));
    continue;
  }
  const c = r.counts;
  console.log(`  ${r.org.padEnd(15)}   ✓   ${String(r.generationMs).padStart(5)}ms   ${String(c.concepts).padStart(7)}  ${String(c.forms).padStart(5)}  ${String(c.programs).padStart(4)}  ${String(c.encounterTypes).padStart(3)}  ${String(c.subjectTypes).padStart(4)}`);
}

console.log("\nValidator (errors classified):");
console.log("  org             total  F2-sem  prog-res  subj-res  form  concept  shape  other");
console.log("  " + "-".repeat(80));
for (const r of rows) {
  if (!r.ok || !r.validatorResult || r.validatorResult.error) continue;
  const c = r.classified;
  const fmt = (k, w = 7) => String(c[k] || 0).padStart(w);
  console.log(`  ${r.org.padEnd(14)} ${String(r.validatorResult.errors).padStart(5)}  ${fmt("F2_semantic")}  ${fmt("program_resolution")}  ${fmt("subject_resolution")}  ${fmt("form_validation")}  ${fmt("concept_validation")}  ${fmt("shape_violation")}  ${fmt("other", 5)}`);
}

console.log("\nClassification key:");
console.log("  F2-sem    = cross-group concept reuse — semantic, agent loop's job");
console.log("  prog-res  = program UUID dangling (often: SRS lacks Modelling)");
console.log("  subj-res  = subject UUID dangling (auto-create should catch most)");
console.log("  form/concept/shape = AVNI server contract violations");

fs.writeFileSync(path.join(outBase, "results.json"), JSON.stringify(rows, null, 2));
console.log("\nFull results: " + path.join(outBase, "results.json"));

const totalErrors = rows.reduce((s, r) => s + (r.validatorResult?.errors || 0), 0);
const totalGenerator = rows.reduce((s, r) => {
  const c = r.classified || {};
  return s + (c.form_validation || 0) + (c.concept_validation || 0) + (c.shape_violation || 0)
    + (c.duplicate_validation || 0) + (c.subject_resolution || 0) + (c.encounter_resolution || 0)
    + (c.other || 0);
}, 0);
const totalSemantic = rows.reduce((s, r) => s + ((r.classified || {}).F2_semantic || 0), 0);
const totalProgRes = rows.reduce((s, r) => s + ((r.classified || {}).program_resolution || 0), 0);

console.log("\nAggregate across all orgs:");
console.log(`  Total errors        : ${totalErrors}`);
console.log(`  F2 semantic (LLM)   : ${totalSemantic} (${((totalSemantic/Math.max(1,totalErrors))*100).toFixed(1)}%)`);
console.log(`  Program resolution  : ${totalProgRes} (${((totalProgRes/Math.max(1,totalErrors))*100).toFixed(1)}%)`);
console.log(`  Generator-side bugs : ${totalGenerator} (${((totalGenerator/Math.max(1,totalErrors))*100).toFixed(1)}%)`);
