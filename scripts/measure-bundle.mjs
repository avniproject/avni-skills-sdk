// scripts/measure-bundle.mjs — deterministic bundle scorecard (no LLM). The
// MEASURE runner-agent executes this; the workflow gate + regression-guard read
// its JSON. Reuses the shipped evals; parity only when a UAT zip is provided.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validateBundle } from "../src/bundle.js";
import { completenessFloor } from "../src/completeness.js";
import { scrubProse } from "../src/crl/prose-scrub.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { bundleActiveNames } = require("../tests/corpus/doorstep/lib/entity-names.cjs");
const { diffNames } = require("../tests/corpus/doorstep/lib/parity.cjs");

function isF2(e) { const s = typeof e === "string" ? e : (e?.code || e?.message || ""); return /^\s*F2\b/.test(s) || String(e?.code).toUpperCase() === "F2"; }

export async function measure(bundleDir, uatZip) {
  const v = validateBundle(bundleDir);
  const nonF2 = (v.errors || []).filter((e) => !isF2(e)).length;
  const cf = completenessFloor(bundleDir);
  // prose: DRY probe on a COPY so measure never mutates the bundle.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "meas-prose-"));
  fs.cpSync(bundleDir, copy, { recursive: true });
  const pr = await scrubProse(copy, { ai: false });
  fs.rmSync(copy, { recursive: true, force: true });

  let parity = null;
  if (uatZip && fs.existsSync(uatZip)) {
    const uatDir = fs.mkdtempSync(path.join(os.tmpdir(), "meas-uat-"));
    execFileSync("unzip", ["-o", uatZip, "-d", uatDir], { stdio: ["ignore", "ignore", "ignore"] });
    let root = uatDir;
    if (!fs.existsSync(path.join(root, "subjectTypes.json"))) {
      const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
      if (dirs.length === 1) root = path.join(root, dirs[0].name);
    }
    const d = diffNames(bundleActiveNames(bundleDir), bundleActiveNames(root));
    const byFamily = {}; let pass = true;
    for (const [k, c] of Object.entries(d.classes)) {
      const tot = c.present.length + c.missing.length;
      const cov = tot ? c.present.length / tot : 1;
      byFamily[k] = { coverage: cov, missing: c.missing.length, extra: c.extra.length };
      if (["subjectTypes", "programs", "encounterTypes", "forms"].includes(k) && c.missing.length) pass = false;
    }
    parity = { byFamily, coveragePass: pass };
    fs.rmSync(uatDir, { recursive: true, force: true });
  }
  const floorGreen = nonF2 === 0 && (cf.evaluated && cf.green) && pr.pruned.length === 0 && (parity === null || parity.coveragePass);
  return {
    validator: { nonF2Errors: nonF2, warnings: (v.warnings || []).length },
    integrity: { ok: v.valid || nonF2 === 0 },
    completeness: { green: cf.green, findings: cf.findings },
    prose: { clean: pr.pruned.length === 0, candidates: pr.pruned.map((p) => p.name) },
    parity,
    floorGreen,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, uat] = process.argv.slice(2);
  measure(dir, uat).then((sc) => console.log(JSON.stringify(sc, null, 2)));
}
