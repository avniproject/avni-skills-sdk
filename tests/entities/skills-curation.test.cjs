// Curated skills set for the bundle-authoring agent. Verifies that the
// allow-list in src/skills.js stays tight (no growth-by-default) and that
// it contains exactly the load-bearing skills.

const { test } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return await import("../../src/skills.js?t=" + Date.now());
}

test("listBundleAuthoringSkills returns a strict subset of listSkills", async () => {
  const { listSkills, listBundleAuthoringSkills } = await load();
  const all = listSkills().map((s) => s.slug);
  const curated = listBundleAuthoringSkills().map((s) => s.slug);
  for (const slug of curated) {
    assert.ok(all.includes(slug), `${slug} is in the curated list but not in listSkills`);
  }
  assert.ok(curated.length <= all.length);
});

test("curated set contains the 7 load-bearing skills", async () => {
  const { listBundleAuthoringSkills } = await load();
  const slugs = listBundleAuthoringSkills().map((s) => s.slug).sort();
  // These are the skills the agent actually needs for bundle authoring.
  // Audit committed in src/skills.js LOAD_BEARING_BUNDLE_SKILLS.
  const expected = [
    "architecture-patterns",
    "backend-architecture",
    "implementation-engineer",
    "product-codebase",
    "product-knowledge",
    "project-scoping",
    "rules-author",
    "srs-bundle-generator",
  ].sort();
  assert.deepEqual(slugs, expected, "curated list drift — update the audit deliberately, not accidentally");
});

test("curated set EXCLUDES known off-topic skills", async () => {
  const { isBundleAuthoringSkill } = await load();
  // These are real skills in the brain that don't belong in bundle authoring:
  // they're for post-launch debugging, reports, mobile device QA, etc.
  const offTopic = [
    "mobile-testing", "support-engineer", "support-patterns",
    "metabase-reports", "data-migration", "go-live-checklist",
    "org-setup", "field-implementation", "console-prompt",
  ];
  for (const slug of offTopic) {
    assert.equal(isBundleAuthoringSkill(slug), false, `${slug} is off-topic — must NOT be curated`);
  }
});

test("isBundleAuthoringSkill is a pure boolean predicate", async () => {
  const { isBundleAuthoringSkill } = await load();
  assert.equal(typeof isBundleAuthoringSkill("srs-bundle-generator"), "boolean");
  assert.equal(isBundleAuthoringSkill("srs-bundle-generator"), true);
  assert.equal(isBundleAuthoringSkill("nonexistent-skill"), false);
});

test("curated count is meaningfully smaller than the full list", async () => {
  const { listSkills, listBundleAuthoringSkills } = await load();
  const all = listSkills().length;
  const curated = listBundleAuthoringSkills().length;
  // We expect ≥30% reduction (i.e. curated < 0.7 * all) — if all=17, curated should be ≤12.
  // Today: all=17, curated=8 → 53% reduction.
  assert.ok(curated < all * 0.7,
    `curated should drop ≥30% of skills (have ${curated}/${all}); update the audit if the brain grew`);
});

test("the rules-author SDK-local skill is included (rule writing is core)", async () => {
  const { isBundleAuthoringSkill } = await load();
  assert.equal(isBundleAuthoringSkill("rules-author"), true);
});

test("the canonical srs-bundle-generator is included", async () => {
  const { isBundleAuthoringSkill } = await load();
  assert.equal(isBundleAuthoringSkill("srs-bundle-generator"), true);
});
