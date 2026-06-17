// tests/discovery/bundle-spec-checksum.test.cjs
//
// Asserts the avni-bundle-spec Skill's STAGED fk-matrix.yaml copy is in sync
// with the brain's canonical fk-matrix.yaml — so the Skill can never silently
// drift. The staged file carries a generated provenance header; we strip it
// (split on the END marker) and byte-compare ONLY the body against the brain.
//
// Needs AVNI_SKILLS_PATH (or a sibling avni-skills) — the same dependency the
// rest of the SDK has. If the brain is absent the test SKIPS cleanly (it is a
// drift guard, not a brain-availability gate).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SDK_DIR = path.resolve(__dirname, "..", "..");
const STAGED = path.join(SDK_DIR, "skills", "avni-bundle-spec", "reference", "fk-matrix.yaml");

const PROVENANCE_END_MARKER =
  "# ─── END PROVENANCE (verbatim brain copy below this line) ───";

function resolveBrainPath() {
  if (process.env.AVNI_SKILLS_PATH) return process.env.AVNI_SKILLS_PATH;
  return path.resolve(SDK_DIR, "..", "avni-skills");
}
function canonicalMatrixPath() {
  return path.join(resolveBrainPath(), "srs-bundle-generator", "spec", "fk-matrix.yaml");
}
function sha256(s) { return crypto.createHash("sha256").update(s, "utf8").digest("hex"); }

// Split a staged file into { header, body } on the END marker — mirrors the
// build script's splitStaged.
function stagedBody(text) {
  const idx = text.indexOf(PROVENANCE_END_MARKER);
  if (idx === -1) return null; // no provenance header present
  const afterMarker = text.slice(idx + PROVENANCE_END_MARKER.length);
  return afterMarker.replace(/^\n/, "").replace(/^\n/, "");
}

test("avni-bundle-spec: staged fk-matrix.yaml exists and carries a provenance header", () => {
  assert.ok(fs.existsSync(STAGED),
    `staged fk-matrix.yaml missing at ${STAGED}. Run: npm run build:bundle-spec-skill`);
  const text = fs.readFileSync(STAGED, "utf8");
  assert.ok(text.includes(PROVENANCE_END_MARKER),
    "staged copy is missing its provenance END marker — re-run the build script");
  assert.match(text, /source-repo: avniproject\/avni-skills/, "provenance must name the source repo");
  assert.match(text, /source-sha:\s+[0-9a-f]{7,40}|source-sha:\s+unknown/, "provenance must record a source sha");
  assert.match(text, /body-sha256:\s+[0-9a-f]{64}/, "provenance must record the body checksum");
});

test("avni-bundle-spec: staged fk-matrix body matches the brain canonical (no drift)", (t) => {
  const canonical = canonicalMatrixPath();
  if (!fs.existsSync(canonical)) {
    t.skip(`brain canonical not found at ${canonical} (set AVNI_SKILLS_PATH) — drift guard skipped`);
    return;
  }
  const stagedText = fs.readFileSync(STAGED, "utf8");
  const body = stagedBody(stagedText);
  assert.ok(body != null, "staged copy has no provenance marker — cannot isolate body");

  const canonicalBody = fs.readFileSync(canonical, "utf8");
  assert.equal(
    sha256(body), sha256(canonicalBody),
    "STAGED fk-matrix body has drifted from the brain canonical. " +
    "The brain changed — re-run `npm run build:bundle-spec-skill` to restage.",
  );
});

test("avni-bundle-spec: the recorded body-sha256 in the header matches the actual staged body", () => {
  const text = fs.readFileSync(STAGED, "utf8");
  const body = stagedBody(text);
  assert.ok(body != null);
  const recorded = (text.match(/body-sha256:\s+([0-9a-f]{64})/) || [])[1];
  assert.ok(recorded, "no body-sha256 recorded in the provenance header");
  assert.equal(sha256(body), recorded,
    "the provenance header's body-sha256 does not match the actual staged body — header is stale");
});
