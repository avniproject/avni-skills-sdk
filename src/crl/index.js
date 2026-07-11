// src/crl/index.js — barrel re-exports of the CRL public surface (Phase 1 +
// Phase 2). Names follow the ACTUAL shipped P1 surface; deterministicRules/
// aiRules are aliases for the master §2.2 names.
export {
  loadComplianceDoc, loadSpecTemplate, deterministicRulesOf, aiRulesOf,
  deterministicRulesOf as deterministicRules, aiRulesOf as aiRules,
} from "./compliance-doc.js";
export { deterministicChecker } from "./deterministic-checker.js";
export { aiJudge, selectJudgeModel, buildBundleProjection, HAIKU_MODEL, SONNET_MODEL } from "./ai-judge.js";
export { executor } from "./executor.js";
export { reviewBundle, reviewSpec, crlGate } from "./review.js";
