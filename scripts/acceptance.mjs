#!/usr/bin/env node
// Adaptive end-to-end acceptance harness. One command → a scorecard (org × criterion),
// floor vs aspirational. Deterministic dimensions run always; agent dimensions run when
// ANTHROPIC_API_KEY is present (else amber/skipped). Exit non-zero only on a floor regression.
//   node scripts/acceptance.mjs [--real]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { runAcceptance, CRITERIA } = require("../tests/corpus/lib/acceptance-core.cjs");

const real = process.env.RUN_REAL === "1" || process.argv.includes("--real");
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const res = runAcceptance({ real, hasKey });

const ICON = { green: "🟢", red: "🔴", amber: "🟡", skip: "⚪" };
console.log(`\n=== Bundle-Authoring Acceptance Scorecard ===`);
console.log(`corpus: ${res.orgs.length} runnable org(s) [${real ? "real+committed" : "committed"}]  ·  agent key: ${hasKey ? "present" : "absent"}\n`);

console.log("Per-org deterministic floor — I4 deep parity:");
for (const o of res.orgs) {
  const d = o.dims["I4-parity"];
  console.log(`  ${ICON[d.status] || d.status} ${o.org.padEnd(16)} ${o.oracleOnly ? "[oracle]" : "[gen]   "} ${d.detail}`);
}
const c5 = res.global["C5-generic"];
console.log(`\nGlobal — ${ICON[c5.status]} C5 genericity: ${c5.detail}\n`);

console.log("Criteria coverage (six themes + floor):");
for (const c of CRITERIA) {
  const state = c.live ? "LIVE" : `pending (Story ${c.story})`;
  console.log(`  ${(c.tier === "floor" ? "floor " : "aspir.")} ${c.theme.padEnd(32)} ${state}${c.agent ? " [agent]" : ""}`);
}

const out = path.resolve(__dirname, "..", "acceptance-report.json");
fs.writeFileSync(out, JSON.stringify(res, null, 2));
console.log(`\nFLOOR: ${res.floorPass ? "PASS ✅" : "FAIL ❌ [" + res.floorReds.join(", ") + "]"}`);
console.log(`report: ${out}\n`);
process.exit(res.floorPass ? 0 : 1);
