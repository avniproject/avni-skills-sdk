---
name: avni-bundle-spec
description: Use when authoring or modifying an Avni bundle — JSON entity shapes, the corpus rules index, and the staged FK matrix. Holds the load-on-demand reference for what each bundle file must contain, which references must resolve, and the two server-only invariants (formElement.concept shape, addressLevelType name chars) the local validator cannot see.
version: 1
---

# avni-bundle-spec

The reference for **authoring or modifying an Avni bundle**. An Avni bundle is a
directory of JSON entity files (`concepts.json`, `forms/*.json`, `programs.json`,
`subjectTypes.json`, `encounterTypes.json`, `formMappings.json`, the
`operational*.json` mirrors, `addressLevelTypes.json`, …) that the Avni server
imports as one transaction. If any one file is wrong, the **whole bundle is
rejected** on upload.

This skill is **progressive-disclosure**: this file stays short and always in
context; load a reference file below only when you actually need it.

## When to use

- You are about to add or edit a concept, subjectType, program, encounterType,
  form, formElement, or formMapping.
- You need to know the exact JSON shape of an entity (which keys, which enums).
- You need to know which cross-references (FKs) must resolve, and which are
  required vs optional.
- You're about to export a bundle and want the pre-flight checklist.

## The outcome contract (what "correct" means)

A bundle is correct iff it passes **both** gates with zero errors:

1. `mcp__avni-bundle__bundle_validator_run` — the 28-code server-contract mirror
   (concept/form/mapping/group/db-constraint checks: C1–C7, F1–F9, M1–M5, G1–G2,
   D1–D8).
2. `mcp__avni-bundle__bundle_integrity_check` — FK/dangling-reference integrity
   (driven by the staged FK matrix) **plus** the two server-only invariants the
   validator cannot see (below).

A clean validator does **not** guarantee a clean upload. Always run
`bundle_integrity_check` before export.

## Two invariants the local validator cannot see (memorise these)

These slipped past both the validator and the model in real shipped incidents.
They are now caught deterministically by `bundle_integrity_check`, but you must
never introduce them in the first place:

1. **`formElement.concept` is ALWAYS a nested object, never a bare UUID string.**
   The Avni server's Jackson deserializer expects a `ConceptContract` object
   (`{ name, uuid, dataType, answers, media, ... }`) and crashes
   (`MismatchedInputException`) on `"concept": "<uuid>"`. (The *Durga* incident —
   a "fix all errors" turn flattened 148 elements; server rejected the whole
   bundle.) → finding code `FE_CONCEPT_NOT_OBJECT`.
2. **`addressLevelType` names are non-empty and contain none of `< > = " '`.**
   Avni's `LocationService` rejects names matching `^.*[<>="'].*$` (URLs,
   arrow-chains, section headers copied from an SRS hierarchy diagram).
   (The *Astitva* incident.) → finding code `ALT_INVALID_NAME`.

## References (load on demand)

| File | Load when |
|---|---|
| [reference/entity-shapes.md](reference/entity-shapes.md) | you need the exact JSON shape / required keys / allowed enum values for any bundle entity |
| [reference/rules-corpus-index.md](reference/rules-corpus-index.md) | you're authoring a rule (decision/validation/visitSchedule/skip-logic/eligibility) and want which rule fields live where + real-corpus shape |
| [reference/spec-format.yaml](reference/spec-format.yaml) | you want the machine-readable contract: entity → file, required keys, FK fields, enum sets |
| [reference/fk-matrix.yaml](reference/fk-matrix.yaml) | you need the canonical FK/edge rules (which reference must resolve, required vs optional, formType-conditional mapping requirements). **Staged copy of the brain's canonical matrix** — provenance + checksum-verified, never edit by hand |

## Bundle review checklist

Before declaring a bundle ready to upload, walk this checklist. (Ported verbatim
from the former Review Agent — this is the last gate before upload.)

### Step 1: Compare spec intent vs bundle artifacts
- Each subjectType has a registrationForm if expected.
- Each program has enrolment + (optional) exit forms.
- Each encounterType has its form + (optional) cancellationForm.
- Every form has a corresponding entry in `formMappings.json`.
- Every `operational*` entry references a base entity.

### Step 2: Run the deterministic integrity check
Run `mcp__avni-bundle__bundle_integrity_check`. The `findings` array surfaces
dangling references (`MISSING_REQUIRED_REF` = error, `DANGLING_REF` = warning),
`FE_CONCEPT_NOT_OBJECT`, and `ALT_INVALID_NAME`. Also run
`mcp__avni-bundle__bundle_validator_run` for the 28-code server mirror.

### Step 3: Score completeness
- 0 errors + 0 warnings → ready to upload.
- 0 errors + N warnings → list each warning; the user decides whether to upload.
- ≥1 error → do NOT upload; fix the named errors (and only those).

### Rules of the checklist
- **Surface every dangling reference.** Even one missing UUID means the Avni
  server rejects the upload.
- **Cite specific files + locators** (the integrity finding's `file` + `locator`)
  so the fix is unambiguous.
- When a structural fix has multiple valid resolutions (add-new vs reuse-existing,
  rename vs delete), state the choice you made AND the one you didn't — so a wrong
  choice is caught before it cascades.
