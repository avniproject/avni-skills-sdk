// parity-gate.test.cjs — unit test for the corpus:parity gate LOGIC, run in
// normal CI on SYNTHETIC mini-bundles (CLAUDE.md §1 — never the proprietary
// corpus). Proves the gate's normalisation + set-diff actually behave:
//
//   • a synthetic DANGLING ref → appears in BOTH the OLD surface and the NEW
//     surface, so it is NEVER lost (LOST == 0). This is the regression-safety
//     property the whole gate exists to assert.
//   • a synthetic FLATTENED concept (formElement.concept is a bare UUID string)
//     → appears ONLY in the NEW surface (GAINED), never the OLD surface, and is
//     a NEW class so it can never count as LOST.
//
// These exercise detectors.cjs (oldSurface / newSurface) and normalize.cjs
// (diff / set keys) end-to-end against a real on-disk bundle dir — the same code
// path run.cjs uses against the real corpus.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const { oldSurface, newSurface } = require("./detectors.cjs");
const { diff, CLASS } = require("./normalize.cjs");

// Write a synthetic bundle to a temp dir (only provided keys are written).
function tmpBundle({
  concepts = [],
  forms = [],
  subjectTypes = [],
  programs = [],
  encounterTypes = [],
  formMappings = [],
  addressLevelTypes = [],
} = {}) {
  const dir = path.join(os.tmpdir(), "parity-gate-test-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(path.join(dir, "forms"), { recursive: true });
  fs.writeFileSync(path.join(dir, "concepts.json"), JSON.stringify(concepts));
  fs.writeFileSync(path.join(dir, "subjectTypes.json"), JSON.stringify(subjectTypes));
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs));
  fs.writeFileSync(path.join(dir, "encounterTypes.json"), JSON.stringify(encounterTypes));
  fs.writeFileSync(path.join(dir, "formMappings.json"), JSON.stringify(formMappings));
  fs.writeFileSync(path.join(dir, "addressLevelTypes.json"), JSON.stringify(addressLevelTypes));
  for (const f of forms) fs.writeFileSync(path.join(dir, "forms", `${f.name}.json`), JSON.stringify(f));
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

const ST_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FORM_UUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const MISSING_UUID = "deadbeef-dead-beef-dead-beefdeadbeef"; // referenced, not present

// ─── 1. Synthetic DANGLING ref → in BOTH OLD and NEW (no LOST) ───────

test("synthetic dangling ref appears in both OLD and NEW surfaces → LOST is empty", async () => {
  // A formMapping points at subjectTypeUUID = MISSING_UUID which is absent from
  // subjectTypes.json. Both checkIntegrityOnFileMap AND graph.integrityCheck flag
  // it as a required DANGLING_REF; runBundleIntegrityCheck reuses the file-map
  // logic so it flags it too.
  const dir = tmpBundle({
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    forms: [{ name: "F", uuid: FORM_UUID, formType: "IndividualProfile", formElementGroups: [] }],
    formMappings: [{
      uuid: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
      formType: "IndividualProfile",
      formUUID: FORM_UUID,
      subjectTypeUUID: MISSING_UUID, // ← dangling
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);

    // The dangling ref must be present in OLD.
    const oldDangling = OLD.triples.filter(
      (t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID,
    );
    assert.ok(oldDangling.length >= 1,
      "OLD surface should contain the dangling subjectTypeUUID");
    // It should be found by BOTH old detectors (file-map + graph).
    const origins = new Set(oldDangling.map((t) => t._origin));
    assert.ok(origins.has("checkIntegrityOnFileMap"),
      "checkIntegrityOnFileMap should flag the dangling ref");
    assert.ok(origins.has("graph.integrityCheck"),
      "graph.integrityCheck should flag the dangling ref");

    // The dangling ref must ALSO be present in NEW.
    const newDangling = NEW.triples.filter(
      (t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID,
    );
    assert.ok(newDangling.length >= 1,
      "NEW surface (bundle_integrity_check) should contain the dangling subjectTypeUUID");

    // The gate's verdict: LOST = OLD \ NEW must be empty.
    const lost = diff(OLD.set, NEW.set);
    assert.equal(lost.length, 0,
      `LOST should be empty — gate would FAIL if the dangling ref were lost. Got: ${JSON.stringify(lost)}`);
  } finally {
    cleanup(dir);
  }
});

// ─── 2. Synthetic FLATTENED concept → ONLY in NEW (GAINED, never LOST) ──

test("synthetic flattened concept appears ONLY in NEW surface (GAINED) and never as LOST", async () => {
  // formElement.concept is a bare UUID string (Durga incident). The OLD detectors
  // don't model this — checkIntegrityOnFileMap only checks fe.concept.uuid (a
  // nested object); graph.integrityCheck only walks el.concept.uuid edges. The
  // NEW detector adds FE_CONCEPT_NOT_OBJECT. So it must be GAINED-only.
  const CONCEPT_UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: CONCEPT_UUID, dataType: "Numeric" }],
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    forms: [{
      name: "F", uuid: FORM_UUID, formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: CONCEPT_UUID }] }],
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);

    // OLD must NOT contain any FE_CONCEPT_NOT_OBJECT (it's a new class).
    const oldFlattened = OLD.triples.filter((t) => t.class === CLASS.FE_CONCEPT_NOT_OBJECT);
    assert.equal(oldFlattened.length, 0,
      "OLD surface must not contain FE_CONCEPT_NOT_OBJECT (new class)");

    // NEW must contain exactly the flattened-concept finding.
    const newFlattened = NEW.triples.filter((t) => t.class === CLASS.FE_CONCEPT_NOT_OBJECT);
    assert.equal(newFlattened.length, 1,
      "NEW surface should contain exactly one FE_CONCEPT_NOT_OBJECT finding");

    // GAINED = NEW \ OLD must contain it; LOST = OLD \ NEW must be empty.
    const gained = diff(NEW.set, OLD.set);
    const lost = diff(OLD.set, NEW.set);
    assert.ok(
      gained.some((t) => t.class === CLASS.FE_CONCEPT_NOT_OBJECT),
      "GAINED should contain the flattened-concept finding",
    );
    assert.equal(lost.length, 0,
      `LOST must be empty (a new-class finding can never be LOST). Got: ${JSON.stringify(lost)}`);
  } finally {
    cleanup(dir);
  }
});

// ─── 3. Clean bundle → both surfaces empty, no LOST, no GAINED ───────

test("a clean synthetic bundle yields empty OLD and NEW surfaces (no LOST, no GAINED)", async () => {
  const CONCEPT_UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const dir = tmpBundle({
    concepts: [{ name: "Age", uuid: CONCEPT_UUID, dataType: "Numeric" }],
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    forms: [{
      name: "F", uuid: FORM_UUID, formType: "IndividualProfile",
      formElementGroups: [{ formElements: [{ name: "age-el", concept: { name: "Age", uuid: CONCEPT_UUID } }] }],
    }],
    formMappings: [{
      uuid: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
      formType: "IndividualProfile",
      formUUID: FORM_UUID,
      subjectTypeUUID: ST_UUID,
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);
    assert.equal(OLD.set.size, 0, "clean bundle → OLD surface empty");
    assert.equal(NEW.set.size, 0, "clean bundle → NEW surface empty");
    assert.equal(diff(OLD.set, NEW.set).length, 0, "no LOST on a clean bundle");
    assert.equal(diff(NEW.set, OLD.set).length, 0, "no GAINED on a clean bundle");
  } finally {
    cleanup(dir);
  }
});
