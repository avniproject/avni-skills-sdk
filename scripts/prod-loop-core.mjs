/**
 * Pure loop predicates for the prod-ready workflow.
 * No filesystem, no LLM calls, no Node APIs — only pure logic.
 */

/**
 * Check if scorecard floor is green.
 * @param {object} scorecard
 * @returns {boolean}
 */
export function floorGreen(scorecard) {
  return !!scorecard.floorGreen;
}

/**
 * Determine if the loop should exit.
 * Exit only when floor is green AND there are no confirmed findings to fix.
 * @param {object} scorecard
 * @param {array} confirmedFindings
 * @returns {boolean}
 */
export function shouldExit(scorecard, confirmedFindings) {
  return !!scorecard.floorGreen && confirmedFindings.length === 0;
}

/**
 * Determine if a fix regressed.
 * A regression occurs if:
 *  - Floor went from green to red, OR
 *  - Gate-family coverage dropped (when both have parity)
 * @param {object} before - scorecard before fix
 * @param {object} after - scorecard after fix
 * @returns {boolean}
 */
export function regressed(before, after) {
  // Check green→red regression
  if (before.floorGreen && !after.floorGreen) {
    return true;
  }

  // Check per-gate-family coverage drop
  if (before.parity && after.parity && before.parity.byFamily && after.parity.byFamily) {
    const gateFamilies = ["subjectTypes", "programs", "encounterTypes", "forms"];
    for (const family of gateFamilies) {
      const beforeCov = before.parity.byFamily[family];
      const afterCov = after.parity.byFamily[family];
      // If coverage exists before but is lower after, that's a regression
      if (beforeCov !== undefined && afterCov !== undefined && afterCov < beforeCov) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Pick the LLM model for fixing a finding.
 * Opus for semantic/rule-authoring work; Haiku for mechanical fixes.
 * Never returns Sonnet.
 * @param {object} finding
 * @returns {"haiku"|"opus"}
 */
export function pickFixModel(finding) {
  const OPUS = new Set(["semantic", "rule-authoring", "semantic-intent", "completeness-fill"]);
  return OPUS.has(finding.kind) ? "opus" : "haiku";
}

/**
 * Classify a finding as bundle-fixable or generator-defect.
 * Generator defects (rootCause=generator or certain categories) are logged, not auto-patched.
 * @param {object} finding
 * @returns {"bundle-fixable"|"generator-defect"}
 */
export function classifyFinding(finding) {
  const GENERATOR_DEFECT_CATEGORIES = new Set([
    "program-vs-subjecttype",
    "prose-parse",
    "missing-family-scaffold"
  ]);

  if (finding.rootCause === "generator" || GENERATOR_DEFECT_CATEGORIES.has(finding.category)) {
    return "generator-defect";
  }
  return "bundle-fixable";
}

/**
 * Deduplicate findings by entity|category, keeping the highest confidence.
 * Preserve first-seen order of surviving keys.
 * @param {array} findings
 * @returns {array}
 */
export function dedupeFindings(findings) {
  const seen = new Map(); // key -> { finding, confidence }
  const order = []; // track first-seen order

  for (const finding of findings) {
    const key = `${finding.entity}|${finding.category}`;
    const confidence = finding.confidence ?? 0;

    if (!seen.has(key)) {
      seen.set(key, { finding, confidence });
      order.push(key);
    } else {
      const current = seen.get(key);
      if (confidence > current.confidence) {
        // Update to the higher-confidence version
        current.finding = finding;
        current.confidence = confidence;
      }
    }
  }

  // Return findings in first-seen order
  return order.map((key) => seen.get(key).finding);
}
