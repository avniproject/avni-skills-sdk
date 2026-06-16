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

// ─── 2b. Graph-ONLY dangling ref (encounterType.conceptUuid) → LOST ──
//
// REGRESSION PIN for the false-green dedup-key bug. encounterType.conceptUuid is
// a graph-ONLY edge: graph.integrityCheck walks it, but checkIntegrityOnFileMap
// (the surface the NEW detector reuses) does NOT. So a dangling
// encounterType.conceptUuid is in OLD but NOT in NEW → it MUST surface as LOST.
// Before the key fix this was already correct in ISOLATION; case 2c is the one
// the old `class|locator` key got wrong.

test("an isolated graph-only dangling ref (encounterType.conceptUuid) is LOST (≥1) — gate must FAIL", async () => {
  const ET_UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const dir = tmpBundle({
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    encounterTypes: [{
      name: "Visit", uuid: ET_UUID,
      conceptUuid: MISSING_UUID, // ← dangling, graph-only edge (file-map ignores it)
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);

    // OLD has it, and ONLY via the graph detector.
    const oldGraphOnly = OLD.triples.filter(
      (t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID,
    );
    assert.ok(oldGraphOnly.length >= 1, "OLD surface should contain the graph-only dangling ref");
    assert.ok(
      oldGraphOnly.every((t) => t._origin === "graph.integrityCheck"),
      "the encounterType.conceptUuid dangling ref is graph-only (file-map does not check it)",
    );

    // NEW (file-map reuse) does NOT have it.
    const newHas = NEW.triples.filter(
      (t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID,
    );
    assert.equal(newHas.length, 0, "NEW surface (file-map reuse) does NOT detect encounterType.conceptUuid");

    // The gate's verdict: LOST = OLD \ NEW must be NON-empty → gate FAILS (correct).
    const lost = diff(OLD.set, NEW.set);
    assert.ok(lost.length >= 1,
      `LOST must be ≥1 for a graph-only dangling ref. Got: ${JSON.stringify(lost)}`);
    assert.ok(
      lost.some((t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID
        && t._field === "encounterType.conceptUuid"),
      "the LOST entry is the encounterType.conceptUuid edge",
    );
  } finally {
    cleanup(dir);
  }
});

// ─── 2c. CO-REFERENCED missing uuid (covered + graph-only) → still LOST ─
//
// THE false-green the dedup-key fix closes. ONE missing uuid is referenced by
// BOTH a COVERED edge (formMapping.subjectTypeUUID — re-checked by the NEW
// file-map surface) AND a GRAPH-ONLY edge (encounterType.conceptUuid — only the
// graph detector walks it). With the OLD `class|locator` key both collapsed to a
// single member that NEW satisfied via the covered edge → OLD\NEW empty → the
// graph-only loss was MASKED (false green). With the `class|fromKind|field|to`
// key the two edges are distinct members: the covered one matches OLD↔NEW (NOT
// lost), and the graph-only one correctly shows as LOST.

test("a missing uuid co-referenced by a COVERED and a GRAPH-ONLY edge → graph-only edge is LOST; covered edge is NOT falsely lost", async () => {
  const ET_UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const dir = tmpBundle({
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    encounterTypes: [{
      name: "Visit", uuid: ET_UUID,
      conceptUuid: MISSING_UUID,           // graph-only edge → MISSING_UUID
    }],
    forms: [{ name: "F", uuid: FORM_UUID, formType: "IndividualProfile", formElementGroups: [] }],
    formMappings: [{
      uuid: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
      formType: "IndividualProfile",
      formUUID: FORM_UUID,
      subjectTypeUUID: MISSING_UUID,       // COVERED edge → SAME MISSING_UUID
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);

    // OLD has BOTH edges to MISSING_UUID: the covered one (file-map + graph) and
    // the graph-only one (graph). Keyed by field, they are distinct members.
    const oldFields = new Set(
      OLD.triples
        .filter((t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID)
        .map((t) => t._field),
    );
    assert.ok(oldFields.has("formMapping.subjectTypeUUID"), "OLD has the covered edge");
    assert.ok(oldFields.has("encounterType.conceptUuid"), "OLD has the graph-only edge");

    // NEW has ONLY the covered edge.
    const newFields = new Set(
      NEW.triples
        .filter((t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID)
        .map((t) => t._field),
    );
    assert.ok(newFields.has("formMapping.subjectTypeUUID"), "NEW has the covered edge");
    assert.ok(!newFields.has("encounterType.conceptUuid"), "NEW does NOT have the graph-only edge");

    const lost = diff(OLD.set, NEW.set);

    // The graph-only edge is LOST (this is what the false-green key hid).
    assert.ok(lost.length >= 1, `LOST must be ≥1. Got: ${JSON.stringify(lost)}`);
    assert.ok(
      lost.some((t) => t.class === CLASS.DANGLING_REF
        && t.locator === MISSING_UUID
        && t._field === "encounterType.conceptUuid"),
      "the graph-only encounterType.conceptUuid edge to the shared uuid is LOST",
    );

    // The COVERED edge must NOT be falsely lost (NEW does cover it).
    assert.ok(
      !lost.some((t) => t.class === CLASS.DANGLING_REF
        && t._field === "formMapping.subjectTypeUUID"),
      "the covered formMapping.subjectTypeUUID edge is NOT falsely lost",
    );
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
