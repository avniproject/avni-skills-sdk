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
const generate = !process.argv.includes("--fast"); // C4 generation on by default; --fast skips it
// CRL harness-eval criteria (CRL2a-5 + CRL6) are populated as honest "skip" dims
// pointing at the budget-gated eval cases that actually score them (they can't be
// a CI floor). Always on — the dims are cheap pointers, no LLM.
const res = await runAcceptance({ real, hasKey, generate, crl: true });

const ICON = { green: "🟢", red: "🔴", amber: "🟡", skip: "⚪" };
console.log(`\n=== Bundle-Authoring Acceptance Scorecard ===`);
console.log(`corpus: ${res.orgs.length} runnable org(s) [${real ? "real+committed" : "committed"}]  ·  agent key: ${hasKey ? "present" : "absent"}\n`);

console.log("Per-org deterministic floor — I4 deep parity + C3 rule grounding:");
for (const o of res.orgs) {
  const p = o.dims["I4-parity"];
  const rg = o.dims["C3-rule-grounding"];
  console.log(`  ${ICON[p.status] || p.status} ${o.org.padEnd(16)} ${o.oracleOnly ? "[oracle]" : "[gen]   "} parity: ${p.detail}`);
  if (rg) console.log(`     ${ICON[rg.status] || rg.status} rules:  ${rg.detail}`);
  const c4 = o.dims["C4-generate"];
  if (c4) console.log(`     ${ICON[c4.status] || c4.status} gen:    ${c4.detail}`);
}
const c5 = res.global["C5-generic"];
console.log(`\nGlobal — ${ICON[c5.status]} C5 genericity: ${c5.detail}\n`);

// CRL harness-eval criteria (CRL2a-5 + CRL6) — org-independent skip dims, all
// aspirational (scored by the budget-gated eval cases 25-29, not this harness).
const CRL_DIMS = ["CRL2a-scrub-precision", "CRL2b-scrub-recall", "CRL3-inspector", "CRL4-additive-safety", "CRL5-cost", "CRL6-spec-completeness"];
const crlSample = res.orgs.find((o) => CRL_DIMS.every((k) => o.dims[k]));
if (res.crl && crlSample) {
  console.log("CRL harness-eval criteria (aspirational — scored by tests/eval/cases/25-29, budget-gated):");
  for (const k of CRL_DIMS) {
    const d = crlSample.dims[k];
    console.log(`  ${ICON[d.status] || d.status} ${k.padEnd(24)} ${d.detail}`);
  }
  console.log("");
}

console.log("Criteria coverage (six themes + floor):");
for (const c of CRITERIA) {
  const live = c.live || (c.key === "C4-generate" && generate);
  const state = live ? "LIVE" : `pending (Story ${c.story})`;
  console.log(`  ${(c.tier === "floor" ? "floor " : "aspir.")} ${c.theme.padEnd(32)} ${state}${c.agent ? " [agent]" : ""}`);
}

const out = path.resolve(__dirname, "..", "acceptance-report.json");
fs.writeFileSync(out, JSON.stringify(res, null, 2));
console.log(`\nFLOOR: ${res.floorPass ? "PASS ✅" : "FAIL ❌ [" + res.floorReds.join(", ") + "]"}`);
console.log(`report: ${out}\n`);
process.exit(res.floorPass ? 0 : 1);
