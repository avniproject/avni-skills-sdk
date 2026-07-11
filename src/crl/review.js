// src/crl/review.js — the assembled three-pass CRL API: deterministic →
// ai-judged → executor. `reviewBundle` runs it over a live bundle directory;
// `reviewSpec` over a materialized spec artifact; `crlGate` wraps reviewBundle
// in scrub mode with bounded self-heal + HITL escalation.
//
// CRIT-1: the AI pass is ALWAYS key-guarded here (runAiPass) — aiJudge is only
// invoked when there is a non-empty ai-judged rule set AND ANTHROPIC_API_KEY is
// set. Without this guard, every keyless review against the real
// compliance-doc.yaml (which necessarily has ai-judged rules) would throw and
// discard the deterministic pass with it. A keyless review returns a valid
// ReviewResult, never throws.
//
// CRIT-2: when the AI pass DOES run over a bundle, artifact.files is populated
// with a real bounded content projection (buildBundleProjection) so the model
// sees real concept/form content, not {kind,bundleDir}.

import { loadComplianceDoc, aiRulesOf } from "./compliance-doc.js";
import { deterministicChecker } from "./deterministic-checker.js";
import { aiJudge, buildBundleProjection } from "./ai-judge.js";
import { executor } from "./executor.js";

// Actions the executor can actually resolve; a high-confidence unresolved one
// is a real breach that fails the gate. Advisory "flag-only" findings do not.
const ACTIONABLE = new Set(["prune-candidate", "fix-candidate"]);

// Merged per-rule report keyed on the ACTUAL P1 checker shape (byRule / green|
// red), reconciled from the master §2.3 perRule[] wording.
function buildReviewReport(det, ai) {
  const rules = Object.values(det.byRule).map((r) => ({ ruleId: r.ruleId, tag: "deterministic", status: r.status }));
  for (const f of ai.findings) rules.push({ ruleId: f.ruleId, tag: "ai-judged", class: f.class, severity: f.severity, status: "flagged" });
  return { rules, ok: det.ok, costUsd: ai.costUsd || 0 };
}

function unresolvedHighConfidenceBreach(ai, confidenceThreshold) {
  return ai.findings.some((f) => f.verdict !== "compliant" && f.confidence >= confidenceThreshold && ACTIONABLE.has(f.action));
}

// CRIT-1 key-guard. artifactBuilder is only called when the AI pass actually
// runs (so a keyless review never even builds the projection).
async function runAiPass(doc, delta, scopingCtx, deterministicFindings, artifactBuilder, confidenceThreshold) {
  const judged = aiRulesOf(doc);
  if (judged.length === 0 || !process.env.ANTHROPIC_API_KEY) {
    return { findings: [], confidence: 1, costUsd: 0 };
  }
  return aiJudge(artifactBuilder(), judged, delta, { ...scopingCtx, deterministicFindings, confidenceThreshold });
}

// A high-confidence unresolved breach after review — deterministic errors +
// actionable ai findings the executor could not resolve — becomes the HITL
// escalation payload.
function computeEscalate(deterministic, ai, confidenceThreshold) {
  const breaches = [
    ...deterministic.findings.filter((f) => f.severity === "error"),
    ...ai.findings.filter((f) => f.confidence >= confidenceThreshold && ACTIONABLE.has(f.action)),
  ];
  return breaches.length > 0 ? { reason: "unresolved compliance breach after review", findings: breaches } : null;
}

export async function reviewBundle(bundleDir, opts = {}) {
  const {
    mode = "inspect",
    delta = null,
    scopingCtx = {},
    doc = loadComplianceDoc(),
    apply = false,
    confidenceThreshold = 0.85,
  } = opts;

  const deterministic = await deterministicChecker(bundleDir, doc);
  const ai = await runAiPass(doc, delta, scopingCtx, deterministic.findings, () => ({
    kind: "bundle", bundleDir, files: buildBundleProjection(bundleDir),
  }), confidenceThreshold);

  const result = {
    ok: deterministic.ok && !unresolvedHighConfidenceBreach(ai, confidenceThreshold),
    mode,
    kind: "bundle",
    deterministic,
    ai,
    report: buildReviewReport(deterministic, ai),
  };

  // Pass 3 — executor (scrub / explicit apply). ok is re-derived from the
  // post-scrub state: deterministic clean, nothing reverted, no actionable ai
  // finding left unresolved (referenced/below-threshold skip).
  if (apply || mode === "scrub") {
    const executed = await executor(bundleDir, ai.findings, { confidenceThreshold, doc });
    result.executed = executed;
    const unresolvedActionable = executed.skipped.some((s) => s.reason === "referenced" || s.reason === "below-threshold");
    result.ok = deterministic.ok && executed.reverted.length === 0 && !unresolvedActionable;
  }

  if (!result.ok) {
    const escalate = computeEscalate(deterministic, ai, confidenceThreshold);
    if (escalate) result.escalate = escalate;
  }

  return result;
}
