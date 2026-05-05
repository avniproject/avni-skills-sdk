# Entity-level tests

**Org-agnostic.** Each test builds a synthetic SRS workbook in memory (just the columns/rows it needs), runs the generator, and asserts one specific invariant about one entity.

No test depends on JK Laxmi, Astitva, or any other real org. Adding a new fixture org will run through the same logic and these same invariants must hold.

## Run

```bash
cd tests/entities
node --test *.test.js
```

Total runtime: ~12s for 44 tests. Each test compiles a small `.xlsx` and shells the generator.

## Coverage

| Entity | File | Tests | What it asserts |
|---|---|---:|---|
| Subject Types | `subject-types.test.js` | 8 | per-row creation, Type → mapping (Person/Group/Household), auto-create when referenced by encounter, "X Registration" suffix matching, deterministic UUIDs |
| Programs | `programs.test.js` | 6 | no programs without SRS Modelling (no hardcoding), one entry per `encounterType.programName`, `programSubjectLabel` from Target Subject Type, Enrolment Form column populates form-name → program lookup |
| Encounter Types | `encounter-types.test.js` | 4 | regular vs program encounters, operational wrapping, no dangling formMapping refs |
| Forms | `forms.test.js` | 7 | one form per data-bearing sheet, `formType` inference (IndividualProfile / ProgramEnrolment / etc.), cancellation forms auto-generated, deterministic UUIDs |
| Concepts | `concepts.test.js` | 8 | dataType matches form `Data Type` column, Coded → answer concepts (NA), Yes/No use `STANDARD_UUIDS`, "Pre added Options" leak filtered (Bug 1), "In case of X do not show ..." leak filtered, valid dataType per AVNI schema, deterministic UUIDs |
| FormMappings | `form-mappings.test.js` | 6 | one mapping per non-cancellation form, every UUID ref (form/subject/program/encounter) resolves, ProgramEnrolment carries programUUID, ProgramEncounter carries both program+encounter |
| Operational files | `operational-files.test.js` | 5 | wrapped object form (server contract), back-references valid, count matches base entity count |

**Total: 44 tests.**

## What this gives us

- **Adding a new SRS fixture cannot break these tests** unless they break a generic invariant.
- **Generator changes that violate an invariant fail loudly** — the test names tell you exactly what broke.
- **No "this works for JK Laxmi but not Astitva" surprises** — every test runs on a synthetic minimal SRS that exercises just the entity under test.
- **The bugs we fixed in the de-hardcoding sweep are pinned** — Tests for "Pre added Options" leak, "In case of" leak, no-program-without-Modelling, Yes/No standard UUIDs.

## Adding more tests

For a new invariant, copy the shape of one of the existing tests:

```js
test("description of the invariant", () => {
  const b = generate({
    formsSheets: { /* minimum sheets to exercise the behavior */ },
    modellingSheets: { /* optional */ },
  });
  // assert exactly one thing about exactly one entity
  assert.equal(b.<entity>.<property>, expected);
});
```

Don't write integration tests here — those go in a separate `tests/integration/` for live AVNI server uploads (Level 5).
