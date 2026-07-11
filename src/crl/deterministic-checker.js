// src/crl/deterministic-checker.js — Phase 1 of the Compliance-Guided AI
// Review Layer: run every `tier: "deterministic"` rule in a ComplianceDoc
// against a bundle directory. Zero LLM — composes three EXISTING deterministic
// checkers, all already CI-safe:
//   • rule-body grounding   — src/rules-brain/validate.js (R1–R6)
//   • FK / data-integrity   — src/agents/bundle-mcp-server.js runBundleIntegrityCheck
//                              (MISSING_REQUIRED_REF / DANGLING_REF / FE_CONCEPT_NOT_OBJECT
//                              / ALT_INVALID_NAME — yaml-driven brain graph)
//   • shape/enum/closed-set — src/bundle.js validateBundle (brain's C/F/M/G/D validator)
//
// bundle-mcp-server.js is imported DYNAMICALLY (see loadIntegrityCheck below),
// never as a static top-level import — it pulls in @anthropic-ai/claude-agent-sdk
// + zod + xlsx for a single pure function, and Phase 4 wires bundle_review/
// bundle_scrub INTO bundle-mcp-server.js, which will import FROM src/crl/** —
// a static import here would close that into a load-time cycle.

import { validateBundleRules } from "../rules-brain/validate.js";
import { validateBundle } from "../bundle.js";
import { deterministicRulesOf } from "./compliance-doc.js";

let _mcp;
async function loadIntegrityCheck() {
  if (!_mcp) _mcp = await import("../agents/bundle-mcp-server.js");
  return _mcp.runBundleIntegrityCheck;
}

// Best-effort "<CODE>: " prefix extraction from validateBundle's bare-string
// errors/warnings (the brain's BundleValidator has no structured per-item
// finding shape — e.g. `this.errors.push('C1: Null concept...')`). Never drops
// the finding if extraction fails; `message` always carries the full original
// string.
function leadingCode(s) {
  const m = String(s).match(/^([\w/]+):/);
  return m ? m[1] : null;
}

async function collectSourceFindings(bundleDir) {
  const findings = [];

  const ruleAgg = await validateBundleRules(bundleDir);
  for (const level of ["errors", "warnings"]) {
    for (const item of ruleAgg[level] || []) {
      findings.push({ code: item.code, severity: item.level, message: item.message, source: "rule-grounding" });
    }
  }

  const runBundleIntegrityCheck = await loadIntegrityCheck();
  const integrity = runBundleIntegrityCheck(bundleDir);
  for (const f of integrity.findings || []) {
    findings.push({ code: f.code, severity: f.severity, message: f.message, file: f.file, locator: f.locator, source: "bundle-integrity" });
  }

  const shapeResult = validateBundle(bundleDir);
  for (const s of shapeResult.errors || []) findings.push({ code: leadingCode(s), severity: "error", message: s, source: "bundle-validator" });
  for (const s of shapeResult.warnings || []) findings.push({ code: leadingCode(s), severity: "warning", message: s, source: "bundle-validator" });

  return findings;
}

/**
 * Run every `tier: "deterministic"` rule in `doc` against `bundleDir`.
 *
 * IC-1: takes the WHOLE ComplianceDoc — `deterministicChecker(bundleDir, doc)`
 * — and filters to its own deterministic rules internally; callers never
 * pre-filter with deterministicRulesOf() themselves.
 *
 * A rule matches findings either by `codes` (exact code membership — used by
 * rule-grounding and FK/integrity, which have small closed code sets) or, if
 * `codes` is omitted, by `source` alone (used by "bundle-shape-valid", whose
 * ~30 C/F/M/G/D codes aren't worth enumerating).
 *
 * PerRuleResult.status is "red" iff at least one of ITS OWN matched findings
 * carries severity:"error" — keyed on the FINDING's severity, never the
 * rule's declared `severity` in compliance-doc.yaml. "bundle-shape-valid"
 * legitimately produces BOTH error- and warning-level items under one
 * logical rule; trusting a single declared severity would either mis-green a
 * rule that actually erred or mis-red one that only warned (MAJ-11).
 *
 * @returns {{ ok: boolean, byRule: Record<string, {ruleId:string, status:"green"|"red", findings:object[]}>, findings: object[] }}
 */
export async function deterministicChecker(bundleDir, doc) {
  const rules = deterministicRulesOf(doc);
  const allFindings = await collectSourceFindings(bundleDir);

  const byRule = {};
  for (const rule of rules) {
    const codes = Array.isArray(rule.codes) && rule.codes.length ? new Set(rule.codes) : null;
    const matched = codes
      ? allFindings.filter((f) => codes.has(f.code))
      : allFindings.filter((f) => f.source === rule.source);
    byRule[rule.id] = {
      ruleId: rule.id,
      status: matched.some((f) => f.severity === "error") ? "red" : "green",
      findings: matched,
    };
  }

  const ok = Object.values(byRule).every((r) => r.status !== "red");
  return { ok, byRule, findings: allFindings };
}
