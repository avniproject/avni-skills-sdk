// Evidence-based MODEL-QUALIFICATION MATRIX + selection logic (story #13, P5).
//
// The keyword router was deleted in #11; #11 then left a FIXED default
// (claude-sonnet-4-6) with a `// TODO(#13)`. This module replaces that fixed
// default with model selection driven by EVIDENCE: the 20-case enforcing eval
// suite (tests/eval/) run per-model yields which models are QUALIFIED for which
// task categories. Since the paid eval run is deferred, this ships the
// MECHANISM (matrix + selectModel + a regenerate-from-eval-results script) seeded
// with a DOCUMENTED interim qualification, ready to be repopulated from a real
// eval run via `scripts/build-model-matrix.mjs`.
//
// NO BEHAVIOR REGRESSION: absent evidence for a request's category, selection
// falls back to the #11 default (DEFAULT_MODEL, claude-sonnet-4-6) so nothing
// breaks and a weaker model is NEVER silently chosen without evidence.
//
// Provenance discipline mirrors the brain's spec/fk-matrix.yaml: the matrix
// carries a checksum over its qualification payload so a stray edit is caught
// by a mutation-proven test (change a value → checksum test goes RED).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The #11 default / no-evidence fallback floor. Kept as a literal here (rather
// than importing agent.js, which would drag the whole agent→pipeline→brain
// chain into this small, dependency-free module). It is PINNED to agent.js's
// DEFAULT_MODEL by a test (model-matrix.test.cjs) so the two can never drift —
// the same "pin to the live source" discipline the brain's fk-matrix uses.
export const FALLBACK_DEFAULT_MODEL = "claude-sonnet-4-6";

// The canonical matrix lives at <repo>/spec/model-qualification.json. JSON (not
// YAML) deliberately: no new dependency, and the #11 TODO already named
// "model-qualification.json" as the target artifact.
export const MATRIX_PATH = path.resolve(__dirname, "..", "spec", "model-qualification.json");

// The five eval categories (tests/eval/README.md). The matrix is keyed by these
// so the regenerator can map per-model eval pass-rates → qualification 1:1.
export const CATEGORIES = Object.freeze([
  "data-integrity",
  "safety-refusal",
  "correctness",
  "no-thrash",
  "srs-authorship",
]);

// Categories that carry structural / data-mutation risk. A model must be
// qualified for at least one of these to earn the write/structural/export tool
// tiers (see deriveToolTiers). The low-risk categories (safety-refusal,
// no-thrash) are read/explain/verify shaped and only earn the read tier.
export const STRUCTURAL_CATEGORIES = Object.freeze([
  "data-integrity",
  "correctness",
  "srs-authorship",
]);

// Deterministic cost ordering used by the "cheapest qualified" selection policy
// (lower = cheaper). Grounded in the published per-MTok pricing tiers
// (haiku < sonnet < opus < fable). Unknown models sort last so they are never
// preferred purely on cost. This is the ONLY cost heuristic; qualification
// itself is evidence-driven.
export const MODEL_COST_RANK = Object.freeze({
  "claude-haiku-4-5": 1,
  "claude-sonnet-4-6": 2,
  "claude-opus-4-8": 3,
  "claude-fable-5": 4,
});
export const UNKNOWN_COST_RANK = 50;

export function costRankOf(model) {
  return Object.prototype.hasOwnProperty.call(MODEL_COST_RANK, model)
    ? MODEL_COST_RANK[model]
    : UNKNOWN_COST_RANK;
}

// ─── checksum / provenance ──────────────────────────────────────────
//
// Deterministic (key-sorted) serialization so the checksum is stable regardless
// of JSON key order. Arrays keep their order (order is meaningful for
// categories / toolTiers and is built deterministically by the generator).
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

// The checksum is computed over the `models` payload ONLY — the evidence that
// selection depends on. Volatile provenance fields (generatedAt, source, note)
// are excluded so re-running the regenerator on identical eval input is
// idempotent, while any change to a qualification value flips the checksum.
export function computeChecksum(models) {
  const hex = crypto.createHash("sha256").update(stableStringify(models), "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function verifyChecksum(matrix) {
  if (!matrix || typeof matrix !== "object" || !matrix.models) return false;
  return matrix.checksum === computeChecksum(matrix.models);
}

// ─── loader (cached) ─────────────────────────────────────────────────

let _cache = null;

export function loadMatrix() {
  if (_cache) return _cache;
  const text = fs.readFileSync(MATRIX_PATH, "utf8");
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== "object" || !doc.models || typeof doc.models !== "object") {
    throw new Error(`model-qualification.json did not parse to an object with a "models" map`);
  }
  _cache = doc;
  return doc;
}

// Test seam — drop the cache so a test that writes a fresh matrix file (or
// injects one) isn't served a stale copy.
export function _clearMatrixCache() {
  _cache = null;
}

// ─── tool tiers (evidence-driven tool promotion) ────────────────────
//
// Per-model tool tiers derived from its qualification: a model qualified for a
// STRUCTURAL category (data-integrity / correctness / srs-authorship) earns the
// write/structural/export tiers; a model qualified only for low-risk categories
// gets read-only. This steers a model not qualified for structural work away
// from data-mutating tools without WEAKENING any deterministic gate — the gates
// (integrity check, post-turn detector, path-jail) still run regardless.
export function deriveToolTiers(qualification) {
  const tiers = ["read"];
  const qualifiedFor = (cat) => !!(qualification && qualification[cat] && qualification[cat].qualified);
  if (STRUCTURAL_CATEGORIES.some(qualifiedFor)) {
    tiers.push("write", "structural", "export");
  }
  return tiers;
}

export function toolTiersFor(model, matrix = loadMatrix()) {
  const entry = matrix.models && matrix.models[model];
  if (entry && Array.isArray(entry.toolTiers)) return entry.toolTiers;
  if (entry && entry.qualification) return deriveToolTiers(entry.qualification);
  return ["read"]; // unknown model → most conservative tier
}

export function isToolTierQualified(model, tier, matrix = loadMatrix()) {
  return toolTiersFor(model, matrix).includes(tier);
}

// ─── category derivation from cheap request signals ─────────────────
//
// Signals must be cheap + evidence-grounded. `mode` (author vs edit, story #12)
// and a `structural` hint are enough:
//   • author mode           → srs-authorship (building a bundle FROM an SRS)
//   • edit + structural work → data-integrity (the default assumption for edits)
//   • edit + non-structural  → no-thrash (a pure question / explain / verify)
// The call site passes only `mode` today (edit defaults to structural=true), so
// production keeps routing edits through data-integrity — see selectModel.
export function deriveCategory({ mode = "edit", structural } = {}) {
  if (mode === "author") return "srs-authorship";
  if (structural === false) return "no-thrash";
  return "data-integrity";
}

// ─── selection ──────────────────────────────────────────────────────
//
// Priority (highest first):
//   1. SDK_MODEL env  — operator global override / kill-switch (STILL wins).
//   2. requested      — the caller's explicit `model` in the /messages payload.
//   3. matrix         — the cheapest QUALIFIED model for the derived category.
//   4. DEFAULT_MODEL  — the #11 default (claude-sonnet-4-6) when the matrix has
//                       NO evidence for the category. This is the no-regression
//                       floor: absent evidence we never downgrade below it.
//
// "Cheapest qualified" only ever picks a model the matrix marks qualified for
// the category, so a cheaper model is chosen ONLY where evidence (or the clearly
// marked interim seed) says it passes — never a silent downgrade without
// evidence.
export function selectModel(signals = {}) {
  const {
    requested,
    mode = "edit",
    structural,
    matrix = loadMatrix(),
    // `env` lets tests disable the operator override (pass env: null); default
    // reads the live SDK_MODEL so the override applies in production.
    env,
  } = signals;

  const envOverride = env !== undefined ? env : process.env.SDK_MODEL;
  if (typeof envOverride === "string" && envOverride.trim()) {
    return { model: envOverride.trim(), reason: "env:SDK_MODEL (operator override)", source: "override", category: null };
  }

  if (typeof requested === "string" && requested.trim()) {
    return { model: requested.trim(), reason: "explicit (caller specified)", source: "caller", category: null };
  }

  const category = deriveCategory({ mode, structural });
  const fallbackModel = (matrix && matrix.fallbackModel) || FALLBACK_DEFAULT_MODEL;

  const models = (matrix && matrix.models) || {};
  const qualified = Object.keys(models).filter((m) => {
    const q = models[m] && models[m].qualification && models[m].qualification[category];
    return !!(q && q.qualified);
  });

  if (qualified.length === 0) {
    // No evidence for this category → the #11 default. NO downgrade.
    return {
      model: fallbackModel,
      reason: `fallback: no qualified model for "${category}" (#11 default)`,
      source: "fallback",
      category,
    };
  }

  // Cheapest qualified wins (evidence-gated). Deterministic tie-break by name.
  qualified.sort((a, b) => {
    const d = costRankOf(a) - costRankOf(b);
    return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
  });
  const chosen = qualified[0];
  return {
    model: chosen,
    reason: `matrix: cheapest qualified for "${category}" (${matrix.source || "unknown source"})`,
    source: "matrix",
    category,
  };
}
