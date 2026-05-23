#!/usr/bin/env node
// extract-rule-corpus.mjs — walk every bundle in $SDK_CORPUS_PATH and emit
// a real-world rule corpus document grouped by rule type.
//
// What gets extracted (per bundle):
//   - subjectTypes.json[].{subjectSummaryRule, programEligibilityCheckRule,
//                          memberAdditionEligibilityCheckRule}
//   - programs.json[].{enrolmentSummaryRule, enrolmentEligibilityCheckRule,
//                       manualEnrolmentEligibilityCheckRule}
//   - encounterTypes.json[].encounterEligibilityCheckRule
//   - forms/*.json[].{decisionRule, validationRule, visitScheduleRule,
//                      checklistsRule, editFormRule}
//   - forms/*.json[].formElementGroups[].formElements[].rule
//
// Output: docs/rules-corpus-from-21-orgs.md
//   - Aggregate counts table
//   - Per-rule-type section with up to N=20 representative examples
//     (sorted by length, dedup by body hash, ≥1 from each org)
//
// Usage:
//   SDK_CORPUS_PATH=/path/to/orgs-bundle node scripts/extract-rule-corpus.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CORPUS = process.env.SDK_CORPUS_PATH ||
  "/Users/samanvay/Downloads/All/orgs-bundle";

if (!fs.existsSync(CORPUS)) {
  console.error(`corpus not found at ${CORPUS}`);
  console.error(`set SDK_CORPUS_PATH to the directory containing the org bundles.`);
  process.exit(2);
}

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_PATH = path.join(SDK_DIR, "docs", "rules-corpus-from-21-orgs.md");

// ─── Rule field map ────────────────────────────────────────────────
// Each entry: { file glob, entityShape, ruleFields[] }
// "entityShape" is informational — used in the output header.

function asArray(v, wrappedKey) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (wrappedKey && Array.isArray(v[wrappedKey])) return v[wrappedKey];
  return [];
}

function readJsonOr(fp, fallback) {
  if (!fs.existsSync(fp)) return fallback;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return fallback; }
}

function ruleKey(body) {
  // Hash the trimmed body so identical rules dedupe even if pasted across orgs
  return crypto.createHash("sha1").update(body.trim()).digest("hex").slice(0, 12);
}

// ─── Extractor ─────────────────────────────────────────────────────
const examples = {};   // ruleType → [{ org, locator, hash, body }]

function record(ruleType, org, locator, body) {
  if (typeof body !== "string" || !body.trim()) return;
  (examples[ruleType] ||= []).push({
    org, locator,
    hash: ruleKey(body),
    body: body.trim(),
  });
}

function walkBundle(orgDir) {
  const org = path.basename(orgDir);

  // ── subjectTypes
  for (const st of asArray(readJsonOr(path.join(orgDir, "subjectTypes.json"), []))) {
    if (st.subjectSummaryRule)               record("subjectSummary",        org, `subjectType[${st.name}]`,                    st.subjectSummaryRule);
    if (st.programEligibilityCheckRule)      record("eligibility-subject",   org, `subjectType[${st.name}]`,                    st.programEligibilityCheckRule);
    if (st.memberAdditionEligibilityCheckRule) record("eligibility-member",  org, `subjectType[${st.name}]`,                    st.memberAdditionEligibilityCheckRule);
  }

  // ── programs
  for (const p of asArray(readJsonOr(path.join(orgDir, "programs.json"), []))) {
    if (p.enrolmentSummaryRule)              record("enrolmentSummary",      org, `program[${p.name}]`,                          p.enrolmentSummaryRule);
    if (p.enrolmentEligibilityCheckRule)     record("eligibility-enrolment", org, `program[${p.name}]`,                          p.enrolmentEligibilityCheckRule);
    if (p.manualEnrolmentEligibilityCheckRule) record("eligibility-manual",  org, `program[${p.name}]`,                          p.manualEnrolmentEligibilityCheckRule);
  }

  // ── encounterTypes
  for (const e of asArray(readJsonOr(path.join(orgDir, "encounterTypes.json"), []))) {
    if (e.encounterEligibilityCheckRule)     record("eligibility-encounter", org, `encounterType[${e.name}]`,                    e.encounterEligibilityCheckRule);
  }

  // ── forms
  const formsDir = path.join(orgDir, "forms");
  if (fs.existsSync(formsDir)) {
    for (const fn of fs.readdirSync(formsDir)) {
      if (!fn.endsWith(".json")) continue;
      const f = readJsonOr(path.join(formsDir, fn), null);
      if (!f) continue;
      const fbase = `form[${f.name || fn}]`;
      if (f.decisionRule)        record("decision",       org, fbase, f.decisionRule);
      if (f.validationRule)      record("formValidation", org, fbase, f.validationRule);
      if (f.visitScheduleRule)   record("visitSchedule",  org, fbase, f.visitScheduleRule);
      if (f.checklistsRule)      record("checklists",     org, fbase, f.checklistsRule);
      if (f.editFormRule)        record("editForm",       org, fbase, f.editFormRule);
      for (const grp of (f.formElementGroups || [])) {
        for (const fe of (grp.formElements || [])) {
          if (typeof fe.rule === "string" && fe.rule.trim()) {
            record("formElement-skipLogic", org, `${fbase}.fe[${fe.name}]`, fe.rule);
          }
        }
      }
    }
  }
}

const orgs = fs.readdirSync(CORPUS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "specs" && !d.name.startsWith("."))
  .map((d) => path.join(CORPUS, d.name));

console.log(`walking ${orgs.length} bundles in ${CORPUS} …`);
for (const o of orgs) walkBundle(o);

// ─── Output ────────────────────────────────────────────────────────
const ruleTypes = Object.keys(examples).sort();
const totalRules = ruleTypes.reduce((s, k) => s + examples[k].length, 0);

// Per-type: dedupe by hash, sort by length descending, cap at 20, ensure
// at least one example per source org (if practical).
function selectRepresentatives(arr, maxPicks = 20) {
  const byHash = new Map();
  for (const r of arr) if (!byHash.has(r.hash)) byHash.set(r.hash, r);
  const unique = [...byHash.values()];
  unique.sort((a, b) => b.body.length - a.body.length);
  // Greedy diversity: prefer one per org first
  const seenOrgs = new Set();
  const picked = [];
  for (const r of unique) {
    if (picked.length >= maxPicks) break;
    if (!seenOrgs.has(r.org)) {
      picked.push(r);
      seenOrgs.add(r.org);
    }
  }
  for (const r of unique) {
    if (picked.length >= maxPicks) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

const lines = [];
lines.push("# Rule corpus — extracted from 21 real org bundles");
lines.push("");
lines.push(`> Generated by \`scripts/extract-rule-corpus.mjs\` from \`$SDK_CORPUS_PATH = ${CORPUS}\` on ${new Date().toISOString().slice(0, 10)}.`);
lines.push(`> Re-run when the corpus changes. The corpus itself stays OUT of the repo (CLAUDE.md §2).`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Aggregate counts");
lines.push("");
lines.push(`Total rules extracted: **${totalRules}** across ${ruleTypes.length} rule types from ${orgs.length} bundles.`);
lines.push("");
lines.push("| rule type | total | unique bodies | orgs |");
lines.push("|---|---:|---:|---:|");
for (const t of ruleTypes) {
  const all = examples[t];
  const unique = new Set(all.map((r) => r.hash)).size;
  const orgs = new Set(all.map((r) => r.org)).size;
  lines.push(`| \`${t}\` | ${all.length} | ${unique} | ${orgs} |`);
}
lines.push("");
lines.push("---");
lines.push("");

for (const t of ruleTypes) {
  const all = examples[t];
  const picks = selectRepresentatives(all, 15);
  lines.push(`## \`${t}\` — ${all.length} extracted, showing ${picks.length} representative${picks.length === 1 ? "" : "s"}`);
  lines.push("");
  lines.push(`Sources: ${[...new Set(all.map((r) => r.org))].slice(0, 8).join(", ")}${all.length > 8 ? ", …" : ""}`);
  lines.push("");
  for (const r of picks) {
    lines.push(`### \`${r.org}\` · \`${r.locator}\`  (${r.body.length} bytes)`);
    lines.push("");
    lines.push("```javascript");
    lines.push(r.body);
    lines.push("```");
    lines.push("");
  }
  lines.push("---");
  lines.push("");
}

fs.writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`\n✓ wrote ${OUT_PATH}`);
console.log(`  rule types: ${ruleTypes.length}`);
console.log(`  total rules: ${totalRules}`);
console.log(`  total examples shown: ${ruleTypes.reduce((s, t) => s + selectRepresentatives(examples[t], 15).length, 0)}`);
