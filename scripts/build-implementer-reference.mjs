#!/usr/bin/env node
// build-implementer-reference.mjs — fetch + distil avniproject/avni-ai's
// `dify/merged.md` into a focused implementer skill under
// `skills/avni-implementer-reference/`.
//
// `merged.md` (10,880 lines) concatenates four content domains:
//   ✓ readme/Implementers/*               (implementer reference)
//   ✓ webapp-documentation/sideBarDocumentation/ (UI docs)
//   ✓ sample-implementations/            (real-world patterns)
//   ✗ case-studies/                       (NGO field stories — drop)
//   ✗ readme/End User Guide/             (app-user docs — drop)
//   ✗ readme/General/ (non-architecture)  (marketing/roadmap — drop)
//   ✗ faqs/                               (vendor comparisons — drop)
//   ✗ scripts/, prompts.md                (build/internal — drop)
//
// We keep the technical-implementer sections (75% of merged.md) and split
// by sub-domain into multiple .md files so the agent's `Skill` tool can
// load them on demand without slurping 440KB into one prompt.
//
// Usage:
//   node scripts/build-implementer-reference.mjs
//
// Idempotent — re-run when upstream `merged.md` changes.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SDK_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SKILL_DIR = path.join(SDK_DIR, "skills", "avni-implementer-reference");
const TMP_MERGED = "/tmp/avni-merged-fetch.md";

// ─── Buckets — file-path prefix → output filename ───────────────────
// Each bucket gets one .md file; SKILL.md indexes them all.
const BUCKETS = [
  {
    out: "advanced-features.md",
    title: "Advanced feature guide",
    prefixes: ["readme/Implementers/advanced-feature-guide/"],
  },
  {
    out: "how-to.md",
    title: "How-do-I guides",
    prefixes: ["readme/Implementers/how-do-i/"],
  },
  {
    out: "basic-features.md",
    title: "Basic feature guide",
    prefixes: ["readme/Implementers/basic-feature-guide/"],
  },
  {
    out: "webapp-docs.md",
    title: "Webapp / sidebar documentation",
    prefixes: ["webapp-documentation/sideBarDocumentation/"],
  },
  {
    out: "sample-implementations.md",
    title: "Sample implementations (real-world patterns)",
    prefixes: ["sample-implementations/"],
  },
  {
    out: "reporting.md",
    title: "Reporting + business analytics",
    prefixes: [
      "readme/Implementers/reporting-and-business-analytics/",
      "readme/General/architecture/reporting-in-avni/",
    ],
  },
  {
    out: "architecture.md",
    title: "Architecture + terminology",
    prefixes: [
      "readme/General/architecture/",     // not the reporting sub-path (already in reporting)
      "readme/Implementers/",             // the bare Implementers/ root file (if any)
    ],
    excludePrefixes: [
      "readme/General/architecture/reporting-in-avni/",  // claimed by reporting.md
      "readme/Implementers/advanced-feature-guide/",
      "readme/Implementers/how-do-i/",
      "readme/Implementers/basic-feature-guide/",
      "readme/Implementers/reporting-and-business-analytics/",
    ],
  },
];

// ─── Fetch merged.md ────────────────────────────────────────────────
function fetchMerged() {
  console.log("fetching dify/merged.md from avniproject/avni-ai @ app-configurator-dev …");
  try {
    execFileSync("gh", [
      "api",
      "repos/avniproject/avni-ai/contents/dify/merged.md?ref=app-configurator-dev",
      "-H", "Accept: application/vnd.github.raw",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).slice(0, 0);  // for stderr only
    const buf = execFileSync("gh", [
      "api",
      "repos/avniproject/avni-ai/contents/dify/merged.md?ref=app-configurator-dev",
      "-H", "Accept: application/vnd.github.raw",
    ], { encoding: "utf8" });
    fs.writeFileSync(TMP_MERGED, buf);
    return buf;
  } catch (e) {
    console.error("failed to fetch merged.md via gh CLI:", e.message);
    console.error("ensure `gh auth status` is logged in to an account with read access.");
    process.exit(1);
  }
}

// ─── Split on `# File: ./...` boundaries ────────────────────────────
function splitSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^# File: \.\/(.+)$/);
    if (m) {
      if (current) sections.push(current);
      current = { path: m[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function matchesBucket(filePath, bucket) {
  const prefixMatch = bucket.prefixes.some((p) => filePath.startsWith(p));
  if (!prefixMatch) return false;
  const excluded = (bucket.excludePrefixes || []).some((p) => filePath.startsWith(p));
  return !excluded;
}

// ─── Main ───────────────────────────────────────────────────────────
const merged = fetchMerged();
console.log(`fetched ${merged.length} bytes / ${merged.split("\n").length} lines`);

const sections = splitSections(merged);
console.log(`split into ${sections.length} file-sections`);

fs.mkdirSync(SKILL_DIR, { recursive: true });

// Walk buckets in order; assign each section to the first matching bucket.
const assigned = sections.map((s) => {
  const bucket = BUCKETS.find((b) => matchesBucket(s.path, b));
  return { ...s, bucket: bucket?.out || null };
});
const totals = {};
for (const s of assigned) {
  const key = s.bucket || "_DROPPED";
  totals[key] = (totals[key] || 0) + 1;
}

console.log("\nbucket counts:");
for (const [k, n] of Object.entries(totals).sort()) {
  console.log(`  ${k.padEnd(30)} ${n}`);
}

// Write one .md per bucket
for (const bucket of BUCKETS) {
  const mine = assigned.filter((s) => s.bucket === bucket.out);
  if (mine.length === 0) {
    console.warn(`  ⚠ bucket ${bucket.out} matched 0 sections — check prefixes`);
    continue;
  }
  const body = [
    `# ${bucket.title}`,
    "",
    `> ${mine.length} sections vendored from \`avniproject/avni-ai/dify/merged.md\` (branch \`app-configurator-dev\`).`,
    `> Regenerate via \`node scripts/build-implementer-reference.mjs\` when upstream changes.`,
    "",
    "---",
    "",
  ];
  for (const s of mine) {
    body.push(`## \`${s.path}\``);
    body.push("");
    body.push(s.lines.join("\n").trim());
    body.push("");
    body.push("---");
    body.push("");
  }
  fs.writeFileSync(path.join(SKILL_DIR, bucket.out), body.join("\n"));
  console.log(`  wrote ${bucket.out}  (${mine.length} sections)`);
}

// SKILL.md frontmatter + index
const totalKept = BUCKETS.reduce((acc, b) => acc + assigned.filter((s) => s.bucket === b.out).length, 0);
const totalDropped = (totals._DROPPED || 0);
const skillMd = `---
name: AVNI Implementer Reference
description: Canonical AVNI implementer documentation — advanced features, how-to guides, sidebar docs, sample implementations, reporting, architecture. Distilled from avni-ai/dify/merged.md (drops case studies + end-user guide + faqs + general marketing).
version: ${new Date().toISOString().slice(0, 10)}
---

# AVNI Implementer Reference

This skill bundles the **technical implementer's reference** vendored from
\`avniproject/avni-ai/dify/merged.md\` (branch \`app-configurator-dev\`).

The kept content covers four domains useful for bundle authoring:
1. **Advanced features** — auth, audit, draft-save, encryption, fast-sync,
   approval workflow, etc.
2. **How-to guides** — task-oriented (e.g. "how do I set up a worklist?")
3. **Basic features** — onboarding reference for new implementers
4. **Webapp / sidebar docs** — UI conventions referenced when authoring forms
5. **Sample implementations** — real-world patterns
6. **Reporting** — Metabase, ETL, dashboards
7. **Architecture + terminology** — entity model, definitions

**Dropped from upstream:** case studies (NGO field stories), End User Guide
(for app users not implementers), FAQs (vendor comparisons), general
marketing/roadmap, internal scripts/prompts.

Stats: kept **${totalKept}** sections, dropped **${totalDropped}** sections
out of ${sections.length} total in upstream merged.md.

## Files

| File | Domain | Use when |
|---|---|---|
| [advanced-features.md](advanced-features.md) | advanced-feature-guide | authoring auth/audit/encryption/sync configs, debugging non-trivial features |
| [how-to.md](how-to.md) | how-do-i | a concrete task you've not done before — search here first |
| [basic-features.md](basic-features.md) | basic-feature-guide | onboarding or basic form-config questions |
| [webapp-docs.md](webapp-docs.md) | webapp sidebar | UI conventions, form widget options |
| [sample-implementations.md](sample-implementations.md) | sample bundles | real-world reference patterns |
| [reporting.md](reporting.md) | reporting / Metabase / ETL | reportCard / reportDashboard authoring |
| [architecture.md](architecture.md) | architecture / definitions | entity-model questions, terminology |

## How the agent should use this

Prefer **Read** of a specific supporting file (Glob \`avni-implementer-reference/*.md\`)
over loading the whole skill. The files are large — each is hundreds of KB
of reference content. Search for the section header (every chunk starts
with a \`## \\\`<original path>\\\`\` heading) to locate what you need without
reading whole files.
`;
fs.writeFileSync(path.join(SKILL_DIR, "SKILL.md"), skillMd);
console.log(`\n  wrote SKILL.md`);

const total = totalKept;
console.log(`\n✓ skill built: skills/avni-implementer-reference/  (${total} sections across ${BUCKETS.length} files)`);
