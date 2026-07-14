// src/crl/prose-scrub.js — guardrailed prose cleanup (prune-only, names scope).
import fs from "node:fs";
import path from "node:path";
import { completenessFloor } from "../completeness.js";
import { executor } from "./executor.js";
import { crlGate } from "./review.js";
import { loadComplianceDoc } from "./compliance-doc.js";

// Resolve a "form:<name>" completeness finding to an executor prune target by
// matching the form file (forms/*.json) whose name equals <name>.
function resolveFormTargets(bundleDir, proseFormNames) {
  const formsDir = path.join(bundleDir, "forms");
  if (!fs.existsSync(formsDir)) return [];
  const want = new Set(proseFormNames);
  const targets = [];
  for (const f of fs.readdirSync(formsDir).filter((n) => n.endsWith(".json"))) {
    let form; try { form = JSON.parse(fs.readFileSync(path.join(formsDir, f), "utf8")); } catch { continue; }
    if (form && want.has(form.name)) {
      targets.push({ entityKind: "form", file: path.join("forms", f), uuid: form.uuid, name: form.name });
    }
  }
  return targets;
}

export async function scrubProse(bundleDir, { ai = false, confidenceThreshold = 0.85, doc = loadComplianceDoc() } = {}) {
  const out = { pruned: [], skipped: [], reverted: [], report: null };
  try {
    // ── stage 1: deterministic prose FORMS (free, high-precision) ──
    const floor = completenessFloor(bundleDir);
    const proseFormNames = (floor.findings || [])
      .filter((x) => x.code === "PROSE_AS_ENTITY" && String(x.entity).startsWith("form:"))
      .map((x) => String(x.entity).slice("form:".length));
    const detFindings = resolveFormTargets(bundleDir, proseFormNames).map((target) => ({
      ruleId: "prose-as-entity-name", target, action: "prune-candidate", confidence: 1.0,
    }));
    if (detFindings.length) {
      const ex = await executor(bundleDir, detFindings, { confidenceThreshold, doc });
      for (const a of ex.applied) out.pruned.push({ family: "form", name: a.target.name, reason: "deterministic", confidence: 1.0 });
      out.skipped.push(...ex.skipped);
      out.reverted.push(...ex.reverted);
    }
    // ── stage 2: AI pass (opt-in; only when a key is present) ──
    if (ai && process.env.ANTHROPIC_API_KEY) {
      const g = await crlGate(bundleDir, { confidenceThreshold, doc, hitl: false });
      const executed = g.review?.executed;
      if (executed) {
        for (const a of executed.applied || []) {
          if (a.ruleId === "prose-as-entity-name") out.pruned.push({ family: a.target?.entityKind || "form", name: a.target?.name, reason: "ai-judged", confidence: a.confidence });
        }
        out.skipped.push(...(executed.skipped || []));
        out.reverted.push(...(executed.reverted || []));
      }
    }
  } catch (e) {
    out.error = e.message; // never throw — degrade to whatever was pruned so far
  }
  out.report = `prose-scrub: pruned ${out.pruned.length}, skipped ${out.skipped.length}, reverted ${out.reverted.length}`;
  return out;
}
