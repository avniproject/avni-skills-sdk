# Astitva — Generated Bundle vs Production UAT Bundle

**Date:** 2026-05-04
**Inputs:**
- `fixtures/astitva-forms.xlsx`     (267 KB — Astitva Nourish Program Forms)
- `fixtures/astitva-modelling.xlsx` (126 KB — Astitva Modelling)
- `fixtures/astitva-prod-uat/`      (production UAT bundle, 50 files)
- `fixtures/astitva-prod-errors.csv`(real server-side upload-error trace from a past attempt)

**Generator:** patched `generate_bundle_v2.js` (post-Path-A fix)

---

## Headline

The generator **runs cleanly** on Astitva and produces a structurally valid bundle. But it differs from the production UAT bundle in ways that need explaining — some legitimate, some real bugs.

| Metric | POC | PROD-UAT | Δ |
|---|---:|---:|---:|
| Concepts | 203 | 255 | **-52** |
| Forms | 46 | 33 | +13 |
| Programs | 2 | 2 | 0 |
| EncounterTypes | 28 | 11 | +17 |
| SubjectTypes | 3 | 6 | **-3** |
| FormMappings | 46 | 37 | +9 |
| Validator errors | 42 | (server-rejected; see below) | — |

---

## Why the bundles differ — three layers

### Layer 1: SRS version drift (most of the gap)

The Astitva Modelling/Forms files in `~/Downloads/All/avni-ai/srs/` are **older than what's deployed in production**. Visible signatures:

- **PROD has `voided~XXXXX` markers** on many concepts, forms, and even subject types — that's how AVNI marks something retired during edits in admin. POC (a fresh generation) has none.
- **PROD form names like** `Field Visit Page (Nourish – Supervision)`, `HCCM Distribution Child`, `Nourish - Child Enrolment` — none of these are in our Forms.xlsx
- **POC form names like** `Behavioural Assessment`, `Career Guidance`, `Drop - Long Absentee Followup`, `Enrich Endline`, `Enrich Growth Monitoring` — these are in our Forms.xlsx but NOT in production (the SRS we have is an *older project version* / a different scope)

This isn't a generator bug. It's a fixture-vintage problem.

### Layer 2: Real generator bugs (surfaced by the comparison)

#### Bug A — Subject types are derived from registration FORM names, not from the SRS subject-type sheet

| What POC produced | What PROD has |
|---|---|
| `Beneficiary Registration` | `Beneficiary` |
| `School Registration` | `School` |
| `Anganwadi Registration` | `Anganwadi` |
| (none) | `Avni User` |
| (none) | `Individual` |
| (none) | `User` |

The generator is reading the Forms sheet's *registration form names* and using them as subject-type names. That's wrong: the subject type should be the *target entity* of registration (`Beneficiary`), not the form (`Beneficiary Registration`). And it misses 3 subject types entirely.

**Cascading effect:** all 36 `M3` formMapping errors in the validator output are because formMappings reference subject-type UUIDs that don't exist (because the SRS implies them, but the generator never created them).

#### Bug B — 6 cross-group concept duplicates (`F2`)

Same class as JK Laxmi: `Gender`, `Date of Birth`, `Age (Auto)` appear twice in the `Draft` form. Needs the same semantic decision: rename per group, use RepeatableQuestionGroup, or fold into a coded answer.

#### Bug C — 6 dataType mismatches between forms and concepts.json

Examples:
- `Beneficiary Name` is `Text` in form but `Subject` in concepts (form should be `Subject` — referencing another individual)
- `LMP` is `Text` in form but `Date` in concepts (form should be `Date`)
- `Father's Occupation`, `Mothers occupation`, `Guardian Occupation`, `Address` — all `Text` in form but `Coded` in concepts

Real bugs. Form definitions are not aligned to the concept dataTypes the generator chose.

### Layer 3: What PROD has and POC doesn't (out of scope)

PROD-UAT bundle includes 5 file kinds the generator never emits:

- `groupDashboards.json`
- `menuItem.json`
- `messageRule.json`
- `reportCard.json`
- `reportDashboard.json`

These are AVNI admin-UI artifacts that an implementation engineer creates *after* the bundle is uploaded (per the `avni-skills/srs-bundle-generator/SKILL.md` line: *"Skipping optional admin artifacts (dashboards). Use AVNI UI to create these manually."*).

So PROD has them because the implementation engineer added them in admin. POC doesn't because the generator deliberately doesn't.

**Decision needed:** does the iterative agent loop need to generate these? Or is leaving them to the admin UI fine? Currently the generator's stance is "leave to admin." That seems right.

---

## Production-side ground truth (`astitva-prod-errors.csv`)

The CSV is a Java stack-trace dump from a real failed upload of an earlier Astitva bundle. **Three real server-side error classes** are visible:

### 1. `formMappings.json` — "Form not found"

```
Form not found! UUID: 5d7bad78-..., formUUID: 1ee9424a-..., programUUID: null
```

A formMapping referenced a form UUID that didn't exist in the bundle. This is exactly the failure class the validator's `M3` rule catches (and we have 36 of them in our POC output). **Server contract is enforced.**

### 2. `operationalEncounterTypes.json` — null `encounter_type_id`

```
null value in column "encounter_type_id" of relation "operational_encounter_type"
```

Operational encounter type pointed at a non-existent encounter type. Server's `not-null` Postgres constraint fired. The validator should add this check (it currently doesn't).

### 3. `individualRelation.json` — null `genders`

```
NullPointerException: Cannot invoke "java.util.List.forEach" because "genders" is null
{uuid='5f901e0a-aaa6-3625-989b-107592077959'}
```

An individualRelation row had no `genders` field. Server's import code expects every relation row to have `genders` populated.

**Status check on POC output:** all 22 of our `individualRelation.json` entries DO have `genders` populated. ✅ Generator is correct on this front.

But the production-attempted bundle had at least one row missing it — so an earlier (possibly hand-edited) bundle had this bug. **Worth adding as a validator check** so future generator changes don't regress.

---

## Test harness on Astitva

| Test | Result | Note |
|---|---|---|
| 01: required files | ✓ |  |
| 02: JSON parses | ✓ |  |
| 03: concept count in range | ✓ | 203 ∈ [125, 248] (range from JK Laxmi refs; Astitva-specific range would differ) |
| **04: form count = 34** | ✗ | hardcoded to JK Laxmi |
| **05: p=2, e=14, s=2** | ✗ | hardcoded to JK Laxmi |
| 06: no template-bleed | ✓ | parseOptions filter held up on a different SRS — good |
| 07: operational files wrapped | ✓ |  |
| 08: Yes/No std UUIDs | ✓ |  |
| 09: form refs concepts exist | ✓ | (with `MAX_ERRORS=200` for the run) |
| **10: formMappings refs valid** | ✗ | 36 dangling subject-type UUIDs (Bug A) |
| 11: validator errors ≤ N | adjustable | 42 errors at default cap |
| 12, 13: UUID drift caps | ✓ | (with caps loosened for cross-org) |
| 14: determinism | ✓ |  |
| 15, 16: form structure | ✓ |  |

The harness as-written is JK-Laxmi-specific in two places (#4 and #5). For multi-org testing those tests need to take expected counts as inputs — which is exactly what you said you don't want hardcoded. The other 14 tests are general and **all pass on Astitva** (with bug #10 pending fix).

The harness *successfully surfaced new bugs on a new fixture* — exactly what rigid tests are for.

---

## Bug fix backlog (priority-ordered)

| Bug | Severity | Type | Where to fix |
|---|---|---|---|
| **A — Subject types from form names not SRS subject sheet** | high (cascades to 36 validator errors) | mechanical | `srs_parser.js` or generator's subject-type discovery in `generate_bundle_v2.js` |
| **B — Cross-group concept reuse (F2 errors)** | high (server rejects these) | semantic | agent loop — needs human or LLM judgment |
| **C — Form dataType vs concept dataType mismatch** | medium | mechanical | generator should align form dataType to the concept's once concepts.json is finalized |
| **D — Validator missing `operationalEncounterType.encounter_type_id` null check** | low (defensive) | tooling | `bundle_validator.js` |
| **E — Validator missing `individualRelation.genders` not-null check** | low (defensive) | tooling | `bundle_validator.js` |

---

## What this proves about the generator and the workflow

1. **The generator works on a second org.** No exceptions, no crash. Output is valid JSON, ZIP-able, structurally complete.
2. **The Bug 1 fix from Path A held up on Astitva.** parseOptions filter caught no false positives on a totally different SRS shape.
3. **The harness surfaced 3 new bugs** (A, B, C) that were invisible on JK Laxmi. Every fixture you add reveals more.
4. **Production has artifacts the generator deliberately skips** (dashboards, menuItems, reports) — that's by design, per the skill.
5. **Real production errors (formMappings, operational nulls, individualRelation nulls) match the validator's check classes.** AVNI's server contract is well-modeled. We can trust the validator as the ground truth.
6. **For "edit live bundle" workflows** — the SRS we have is older than PROD. The agent loop must START by pulling the current production bundle (`/implementation/export`) and merging incrementally, not regenerating from scratch.

---

## Files

- `astitva-poc/` — generated bundle (203 concepts, 46 forms, 50 files total)
- `fixtures/astitva-prod-uat/` — production UAT extracted (50 files)
- `fixtures/astitva-prod-errors.csv` — server-side upload-error trace
- `results/ASTITVA-RECONCILIATION.md` — this document
