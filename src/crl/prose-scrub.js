// src/crl/prose-scrub.js — guardrailed prose cleanup (prune-only, names scope).
import fs from "node:fs";
import path from "node:path";
import { completenessFloor } from "../completeness.js";
import { executor } from "./executor.js";
import { reviewBundle } from "./review.js";
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

export async function scrubProse(bundleDir, { ai = false, confidenceThreshold = 0.85, doc: docOpt } = {}) {
  const out = { pruned: [], skipped: [], reverted: [], report: null };
  try {
    // loadComplianceDoc() can throw (missing avni-skills sibling, malformed/
    // mid-edit yaml) — call it INSIDE the try so a doc-load failure degrades to
    // a partial report like every other failure, never a rejected promise. (A
    // default-parameter default would evaluate outside this try.)
    const doc = docOpt || loadComplianceDoc();
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
    // Scope the AI scrub to PROSE ONLY. crlGate/reviewBundle-scrub would apply
    // the WHOLE ai-judged rule set (also orphan-stray-concept prunes + fixes) —
    // out of this feature's scope, and those mutations would land on disk but
    // never appear in out.pruned (a "never-silent" violation, and an uncommitted
    // change if out.pruned stayed empty). Instead: run the ai pass in inspect
    // mode (no mutation), keep only prose-as-entity-name prune-candidates, and
    // apply THOSE through the guardrailed executor ourselves — so the executor
    // is the sole mutator and out.pruned reflects every on-disk change exactly.
    if (ai && process.env.ANTHROPIC_API_KEY) {
      // Judge ONLY the prose rule: a prose-scoped doc keeps every deterministic
      // rule (no LLM cost) but drops all OTHER ai-judged rules, so the ai pass
      // doesn't spend tokens/time/escalations judging orphans/naming/etc. across
      // the whole bundle. The executor below still revalidates against the FULL
      // doc, so a prune that breaks any deterministic rule is still reverted.
      const proseDoc = { ...doc, rules: (doc.rules || []).filter((r) => r.tier !== "ai-judged" || r.id === "prose-as-entity-name") };
      const review = await reviewBundle(bundleDir, { mode: "inspect", doc: proseDoc, confidenceThreshold });
      const proseFindings = (review.ai?.findings || []).filter(
        (f) => f.ruleId === "prose-as-entity-name" && f.action === "prune-candidate",
      );
      if (proseFindings.length) {
        const confByUuid = new Map(proseFindings.map((f) => [f.target?.uuid, f.confidence]));
        const ex = await executor(bundleDir, proseFindings, { confidenceThreshold, doc });
        for (const a of ex.applied) {
          out.pruned.push({ family: a.target?.entityKind || "form", name: a.target?.name, reason: "ai-judged", confidence: confByUuid.get(a.target?.uuid) });
        }
        out.skipped.push(...ex.skipped);
        out.reverted.push(...ex.reverted);
      }
    }
  } catch (e) {
    out.error = e.message; // never throw — degrade to whatever was pruned so far
  }
  out.report = `prose-scrub: pruned ${out.pruned.length}, skipped ${out.skipped.length}, reverted ${out.reverted.length}`;
  return out;
}
