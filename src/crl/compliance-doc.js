// src/crl/compliance-doc.js — loads the CRL's compliance-doc.yaml (deterministic
// + ai-judged rule catalogue) and spec-template.yaml (spec-completeness
// checklist, Phase 2). Mirrors src/pipeline.js's brain-resolution + js-yaml
// loading pattern (also used by tests/entities/spec-coverage.test.cjs) —
// js-yaml is NOT a direct dependency of this repo; it is resolved from the
// BRAIN's (avni-skills) node_modules via AVNI_SKILLS_PATH / sibling clone,
// the same coupling deterministic-checker.js already has for
// buildBundleGraph / BundleValidator. No new dependency, no lockfile churn.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveBrainPath() {
  if (process.env.AVNI_SKILLS_PATH) return process.env.AVNI_SKILLS_PATH;
  return path.resolve(__dirname, "..", "..", "..", "avni-skills");
}

let _yaml;
export function loadYaml() {
  if (_yaml) return _yaml;
  const brainPath = resolveBrainPath();
  const yamlPath = path.join(brainPath, "node_modules", "js-yaml");
  if (!fs.existsSync(yamlPath)) {
    throw new Error(
      `js-yaml not found at ${yamlPath}. compliance-doc.js resolves js-yaml from the brain's ` +
      `node_modules (AVNI_SKILLS_PATH env var, or the sibling ../avni-skills clone) — it is not ` +
      `a direct dependency of avni-skills-sdk, mirroring src/pipeline.js's resolveBrainPath(). ` +
      `Checkout avni-skills alongside this repo, or set AVNI_SKILLS_PATH.`
    );
  }
  _yaml = require(yamlPath);
  return _yaml;
}

const REFERENCE_DIR = path.resolve(__dirname, "..", "..", "skills", "avni-bundle-spec", "reference");
export const DEFAULT_COMPLIANCE_DOC_PATH = path.join(REFERENCE_DIR, "compliance-doc.yaml");
export const DEFAULT_SPEC_TEMPLATE_PATH = path.join(REFERENCE_DIR, "spec-template.yaml");
