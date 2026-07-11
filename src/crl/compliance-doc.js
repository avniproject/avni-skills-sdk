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

const VALID_TIERS = new Set(["deterministic", "ai-judged"]);
const VALID_SEVERITIES = new Set(["error", "warning"]);

function assertRuleShape(rule, docPath) {
  if (!rule || typeof rule !== "object") throw new Error(`${docPath}: every rules[] entry must be a mapping, got ${JSON.stringify(rule)}`);
  if (!rule.id) throw new Error(`${docPath}: a rule is missing "id"`);
  if (!VALID_TIERS.has(rule.tier)) throw new Error(`${docPath}: rule "${rule.id}" has tier "${rule.tier}" (expected deterministic|ai-judged)`);
  if (!VALID_SEVERITIES.has(rule.severity)) throw new Error(`${docPath}: rule "${rule.id}" has severity "${rule.severity}" (expected error|warning)`);
  if (rule.tier === "deterministic" && !rule.source) throw new Error(`${docPath}: deterministic rule "${rule.id}" is missing "source"`);
  if (rule.tier === "ai-judged" && !rule.class) throw new Error(`${docPath}: ai-judged rule "${rule.id}" is missing "class"`);
}

/**
 * Load + structurally validate compliance-doc.yaml. Throws on malformed YAML
 * or a rule missing a required field — a fail-loud doc, never a half-parsed
 * one silently under-covering the bundle.
 */
export function loadComplianceDoc(docPath = DEFAULT_COMPLIANCE_DOC_PATH) {
  const yaml = loadYaml();
  const raw = fs.readFileSync(docPath, "utf8");
  const doc = yaml.load(raw);
  if (!doc || !Array.isArray(doc.rules)) {
    throw new Error(`${docPath}: expected a YAML mapping with a top-level "rules" array`);
  }
  const seen = new Set();
  for (const rule of doc.rules) {
    assertRuleShape(rule, docPath);
    if (seen.has(rule.id)) throw new Error(`${docPath}: duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
  }
  return doc;
}

/**
 * Load spec-template.yaml (Phase 2's reviewSpec consumes this; not wired to
 * a caller yet — see open question O-1 in the CRL reconciliation).
 */
export function loadSpecTemplate(templatePath = DEFAULT_SPEC_TEMPLATE_PATH) {
  const yaml = loadYaml();
  const raw = fs.readFileSync(templatePath, "utf8");
  const doc = yaml.load(raw);
  if (!doc || !Array.isArray(doc.sections)) {
    throw new Error(`${templatePath}: expected a YAML mapping with a top-level "sections" array`);
  }
  return doc;
}

export function deterministicRulesOf(doc) {
  return (doc.rules || []).filter((r) => r.tier === "deterministic");
}

export function aiRulesOf(doc) {
  return (doc.rules || []).filter((r) => r.tier === "ai-judged");
}
