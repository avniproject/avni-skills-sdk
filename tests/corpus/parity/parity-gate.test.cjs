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
const { diff, CLASS, toSet } = require("./normalize.cjs");
const { runOrg } = require("./run.cjs");

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

// ─── 2b. Graph-only dangling ref (encounterType.conceptUuid) → gap CLOSED ──
//
// COVERAGE-NOW-CLOSED regression test. encounterType.conceptUuid USED to be a
// graph-ONLY edge: only graph.integrityCheck walked it; the NEW detector's old
// file-map reuse did NOT. So a dangling encounterType.conceptUuid was in OLD but
// not NEW → it surfaced as LOST (the gate's RED state).
//
// Since SDK #15 / brain #3 the NEW detector drives its FK half off the SAME
// yaml-driven brain graph the OLD graph surface uses, so it now COVERS this kind.
// OLD and NEW produce the identical canonical key for the edge → LOST = 0.
// This test pins the gap as CLOSED: NEW is now a superset for this graph-only kind.

test("a graph-only dangling ref (encounterType.conceptUuid) is now COVERED by NEW → LOST is empty (gap closed)", async () => {
  const ET_UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const dir = tmpBundle({
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    encounterTypes: [{
      name: "Visit", uuid: ET_UUID,
      conceptUuid: MISSING_UUID, // ← dangling, formerly graph-only edge
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);

    // OLD has it via the graph detector.
    const oldGraphOnly = OLD.triples.filter(
      (t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID,
    );
    assert.ok(oldGraphOnly.length >= 1, "OLD surface should contain the dangling encounterType.conceptUuid");
    assert.ok(
      oldGraphOnly.some((t) => t._origin === "graph.integrityCheck"
        && t._field === "encounterType.conceptUuid"),
      "the OLD detection comes from the graph detector walking encounterType.conceptUuid",
    );

    // NEW NOW detects it too (yaml-driven graph reuse) — the gap is closed.
    const newHas = NEW.triples.filter(
      (t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID
        && t._field === "encounterType.conceptUuid",
    );
    assert.ok(newHas.length >= 1,
      "NEW surface (yaml-driven graph) now COVERS encounterType.conceptUuid — gap closed");

    // The gate's verdict: LOST = OLD \ NEW is now EMPTY → gate PASSES (correct,
    // and meaningful: NEW is a genuine superset for this formerly graph-only kind).
    const lost = diff(OLD.set, NEW.set);
    assert.equal(lost.length, 0,
      `LOST must be 0 now that NEW covers encounterType.conceptUuid. Got: ${JSON.stringify(lost)}`);
  } finally {
    cleanup(dir);
  }
});

// ─── 2c. CO-REFERENCED missing uuid (formerly-graph-only + covered) → gap CLOSED ─
//
// COVERAGE-NOW-CLOSED regression test, AND the standing guard against the
// false-green dedup-key bug. ONE missing uuid is referenced by BOTH a long-covered
// edge (formMapping.subjectTypeUUID) AND a formerly-graph-only edge
// (encounterType.conceptUuid). Two things must hold simultaneously now:
//
//   (1) NEW covers the formerly-graph-only edge → it is NOT LOST (gap closed).
//   (2) The dedup key still keeps the two edges DISTINCT members (key includes the
//       edge source `class|fromKind|field|to`, not just `to`). That is why the
//       co-referenced case is a HONEST gap-closure and not a key-collapse: each
//       edge matches its OWN OLD↔NEW counterpart, rather than one edge masking the
//       other. With the old `class|locator` key both would have collapsed to one
//       member — which is exactly the false-green this key shape prevents.
//
// So both edges match OLD↔NEW by their distinct keys → LOST = 0.

test("a missing uuid co-referenced by a COVERED and a formerly-graph-only edge → both covered by NEW, distinct keys, LOST empty (gap closed)", async () => {
  const ET_UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const dir = tmpBundle({
    subjectTypes: [{ name: "Individual", uuid: ST_UUID }],
    encounterTypes: [{
      name: "Visit", uuid: ET_UUID,
      conceptUuid: MISSING_UUID,           // formerly-graph-only edge → MISSING_UUID
    }],
    forms: [{ name: "F", uuid: FORM_UUID, formType: "IndividualProfile", formElementGroups: [] }],
    formMappings: [{
      uuid: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
      formType: "IndividualProfile",
      formUUID: FORM_UUID,
      subjectTypeUUID: MISSING_UUID,       // long-covered edge → SAME MISSING_UUID
    }],
  });
  try {
    const OLD = await oldSurface(dir);
    const NEW = await newSurface(dir);

    // OLD has BOTH edges to MISSING_UUID. Keyed by field, they are distinct members.
    const oldFields = new Set(
      OLD.triples
        .filter((t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID)
        .map((t) => t._field),
    );
    assert.ok(oldFields.has("formMapping.subjectTypeUUID"), "OLD has the covered edge");
    assert.ok(oldFields.has("encounterType.conceptUuid"), "OLD has the formerly-graph-only edge");

    // NEW now has BOTH edges too (yaml-driven graph covers the formerly-graph-only one).
    const newFields = new Set(
      NEW.triples
        .filter((t) => t.class === CLASS.DANGLING_REF && t.locator === MISSING_UUID)
        .map((t) => t._field),
    );
    assert.ok(newFields.has("formMapping.subjectTypeUUID"), "NEW has the covered edge");
    assert.ok(newFields.has("encounterType.conceptUuid"),
      "NEW now COVERS the formerly-graph-only encounterType.conceptUuid edge — gap closed");

    // The two edges remain DISTINCT set members (key includes the edge source), so
    // this is an honest per-edge match, not a key collapse that could mask a loss.
    assert.equal(NEW.set.size, 2,
      "the two distinct edges to the shared missing uuid are distinct set members (key includes edge source)");
    assert.equal(OLD.set.size, 2, "OLD likewise keeps the two edges distinct");

    // The gate's verdict: each edge matches its own OLD↔NEW counterpart → LOST = 0.
    const lost = diff(OLD.set, NEW.set);
    assert.equal(lost.length, 0,
      `LOST must be 0 — both co-referenced edges are now covered by NEW. Got: ${JSON.stringify(lost)}`);
  } finally {
    cleanup(dir);
  }
});

// ─── 2d. DETECTOR-DIVERGENCE GUARD — the gate still has teeth ──────────
//
// WHY this exists. With the graph-only gap CLOSED (2b/2c), NEW is now a genuine
// superset of OLD, so REAL data can no longer produce LOST — every honest run is
// green. A gate that is structurally always-green has rotted into a no-op: it
// would stop catching a FUTURE regression where someone breaks
// `bundle_integrity_check` so it drops a detection OLD still makes.
//
// This test pins the gate's DISCRIMINATING POWER *and* the key-shape protection
// that makes that discrimination honest. It feeds the gate's REAL diff logic
// (run.cjs `runOrg`, the same code the corpus runner uses) a deliberately-CRIPPLED
// NEW surface. The crippling is REALISTIC and NON-EMPTY: on a bundle where ONE
// missing uuid is co-referenced by a COVERED edge (formMapping.subjectTypeUUID)
// AND a graph-only edge (encounterType.conceptUuid), the crippled NEW drops ONLY
// the graph-only finding and KEEPS the covered one — exactly the regression where
// `bundle_integrity_check` loses its yaml-graph FK coverage but keeps the file-map
// half.
//
// This is the EXACT failure the set key must catch: with the correct
// `class|fromKind|field|to` key the two co-referenced edges are DISTINCT members,
// so dropping the graph-only one is a real LOST ≥ 1 (gate RED). With the
// false-green `class|locator` key both edges collapse to one member — the surviving
// covered edge MASKS the dropped graph-only one, LOST = 0, and this guard goes RED.
// So a future downgrade of the key OR of bundle_integrity_check's coverage bites
// here. An empty crippled surface (drop everything) would pass under BOTH keys and
// would NOT exercise key-shape protection — hence the realistic co-referenced drop.
// The real `newSurface` is untouched; only this synthetic injection is crippled.

test("DIVERGENCE GUARD: a crippled NEW that drops ONLY the graph-only edge of a co-referenced missing uuid → gate reports LOST ≥ 1 (discriminates + key-shape protected)", async () => {
  const ET_UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  // ONE missing uuid, two DISTINCT edges to it: a covered edge and a graph-only edge.
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
      subjectTypeUUID: MISSING_UUID,       // covered edge → SAME MISSING_UUID
    }],
  });
  try {
    // Sanity: with the REAL detectors this bundle is at parity (no LOST). This is
    // the baseline the guard perturbs — proves the LOST below is caused by the
    // crippling, not by a pre-existing gap.
    const baseline = await runOrg({ org: "synthetic-divergence", bundleDir: dir },
      { oldSurface, newSurface });
    assert.equal(baseline.lost.length, 0,
      `baseline (real detectors) must be at parity. Got LOST: ${JSON.stringify(baseline.lost)}`);
    assert.ok(baseline.oldCount >= 1, "OLD must legitimately detect the dangling refs");

    // CRIPPLED NEW: start from the REAL surface, then drop ONLY the graph-only
    // encounterType.conceptUuid finding while KEEPING the co-referenced covered
    // formMapping.subjectTypeUUID finding. This simulates bundle_integrity_check
    // losing its yaml-graph FK half but retaining the file-map half. Non-empty on
    // purpose: the surviving covered edge is what would MASK the drop under a
    // false-green class|locator key — so this guard only passes when the key keeps
    // the two co-referenced edges distinct.
    const crippledNewSurface = async (bundleDir) => {
      const real = await newSurface(bundleDir);
      const triples = real.triples.filter((t) => t._field !== "encounterType.conceptUuid");
      return { triples, set: toSet(triples), raw: real.raw };
    };

    // Guard-the-guard: the crippling must actually leave a non-empty NEW surface
    // (the covered edge survives) AND must have removed the graph-only edge.
    const crippledSurface = await crippledNewSurface(dir);
    assert.ok(crippledSurface.set.size >= 1,
      "crippled NEW must stay NON-EMPTY (the covered edge survives) — an empty surface can't test key-shape protection");
    assert.ok(
      !crippledSurface.triples.some((t) => t._field === "encounterType.conceptUuid"),
      "crippled NEW must have dropped the graph-only edge",
    );

    const crippled = await runOrg({ org: "synthetic-divergence", bundleDir: dir },
      { oldSurface, newSurface: crippledNewSurface });

    // The gate MUST flag the divergence: NEW lost the graph-only edge ⇒ LOST ≥ 1.
    // Under the correct class|fromKind|field|to key the two co-referenced edges are
    // distinct members, so the dropped graph-only edge shows as LOST. Under a
    // false-green class|locator key it would be masked by the surviving covered
    // edge (LOST = 0) and THIS assertion would fail.
    assert.ok(crippled.lost.length >= 1,
      `gate must report LOST ≥ 1 when NEW drops the graph-only edge of a co-referenced uuid. Got: ${JSON.stringify(crippled.lost)}`);
    assert.ok(
      crippled.lost.some((t) => t.class === CLASS.DANGLING_REF
        && t.locator === MISSING_UUID
        && t._field === "encounterType.conceptUuid"),
      "the LOST entry is specifically the graph-only encounterType.conceptUuid edge the crippled NEW dropped (not masked by the co-referenced covered edge)",
    );
    // run.cjs exits non-zero when totalLost > 0 — this LOST ≥ 1 is exactly that
    // failing condition, so a real regression would turn the corpus gate RED.
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
