/**
 * consolidate-findings.mjs — merge scorecard + review-panel findings.
 * CLI: node consolidate-findings.mjs <scorecardJsonPath> <reviewFindingsJsonPath>
 * Outputs: { findings: [...bundle-fixable, deduped], generatorDefects: [...], counts:{...} }
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dedupeFindings, classifyFinding } from "./prod-loop-core.mjs";

/**
 * Convert scorecard into finding objects and merge with review findings.
 * @param {object} scorecard - result from measure-bundle
 * @param {array} reviewFindings - findings from review panel
 * @returns {{ findings: array, generatorDefects: array, counts: object }}
 */
export function consolidate(scorecard, reviewFindings) {
  const allFindings = [];

  // 1. Convert scorecard.completeness.findings
  if (scorecard.completeness?.findings) {
    for (const finding of scorecard.completeness.findings) {
      allFindings.push({
        entity: finding.entity,
        category: finding.code,
        kind: "completeness-fill",
        source: "measure",
        confidence: 1,
      });
    }
  }

  // 2. Convert scorecard.prose.candidates into form entities
  if (scorecard.prose?.candidates) {
    for (const name of scorecard.prose.candidates) {
      allFindings.push({
        entity: `form:${name}`,
        category: "PROSE_AS_ENTITY",
        kind: "reclassify-stray",
        source: "measure",
        confidence: 1,
      });
    }
  }

  // 3. Convert scorecard.parity gaps
  if (scorecard.parity?.byFamily) {
    const gateFamilies = ["subjectTypes", "programs", "encounterTypes", "forms"];
    for (const family of gateFamilies) {
      const familyData = scorecard.parity.byFamily[family];
      if (familyData && familyData.missing > 0) {
        allFindings.push({
          entity: `parity:${family}`,
          category: "parity-gap",
          kind: "completeness-fill",
          source: "measure",
          confidence: 1,
        });
      }
    }
  }

  // 4. Merge with review findings
  allFindings.push(...(reviewFindings || []));

  // 5. Dedupe
  const deduped = dedupeFindings(allFindings);

  // 6. Classify and split
  const findings = [];
  const generatorDefects = [];

  for (const finding of deduped) {
    const classification = classifyFinding(finding);
    if (classification === "generator-defect") {
      generatorDefects.push(finding);
    } else {
      findings.push(finding);
    }
  }

  return {
    findings,
    generatorDefects,
    counts: {
      total: deduped.length,
      fixable: findings.length,
      generatorDefects: generatorDefects.length,
    },
  };
}

// CLI main guard
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [scorecardPath, reviewFindingsPath] = process.argv.slice(2);

  if (!scorecardPath || !reviewFindingsPath) {
    console.error("Usage: node consolidate-findings.mjs <scorecardJsonPath> <reviewFindingsJsonPath>");
    process.exit(1);
  }

  try {
    const scorecard = JSON.parse(fs.readFileSync(scorecardPath, "utf-8"));
    const reviewFindings = JSON.parse(fs.readFileSync(reviewFindingsPath, "utf-8"));
    const result = consolidate(scorecard, reviewFindings);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}
