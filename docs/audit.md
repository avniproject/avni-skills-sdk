# Bundle Audit — POC-JK-Laxmi.zip

**Date:** 2026-05-04
**File:** `workspace/POC-JK-Laxmi.zip` (48 KB, 46 entries)
**Method:** structural integrity + referential integrity + diff vs reference bundle (`avni-skills/srs-bundle-generator/output/JK-Laxmi-V2/`) + AVNI server-contract validator

## TL;DR — verdict

- **Structure:** clean (all JSON parses, ZIP order correct, file set complete)
- **Referential integrity:** clean (0 dangling concept/form/subject UUID refs)
- **Quality:** **NOT upload-ready as-is.** 20 server-blocking errors + 11 junk concepts + 2 dataType warnings.
- **Estimate to clean:** 20 mechanical edits (junk-concept removal) + 3 semantic decisions (cross-group duplicates) + 2 type alignments. ~10 minutes of agent work in a real loop.

---

## Section 1 — Inventory

| File | POC | Reference (V2) | Notes |
|---|---:|---:|---|
| concepts.json | 164 | 155 | POC has 9 more — 11 junk + 4 missing-from-POC = -2 net (see §3) |
| forms/*.json | 34 | 34 | match (20 forms + 14 cancellations) |
| formMappings.json | 34 entries | 34 | match |
| programs.json | 2 | 2 | match |
| encounterTypes.json | 14 | 14 | match |
| subjectTypes.json | 2 | 2 | match |
| addressLevelTypes.json | 4 levels | — | present |
| relationshipType.json | 8 | — | present |
| individualRelation.json | 22 | — | present |
| operationalSubjectTypes.json | 1 obj (2 inside) | 2 | present, different shape* |
| operationalPrograms.json | 1 obj (2 inside) | 2 | present, different shape* |
| operationalEncounterTypes.json | 1 obj (14 inside) | 14 | present, different shape* |
| organisationConfig.json | uuid+settings | — | present |
| groups.json | 4 | (none) | extra in POC |
| groupPrivilege.json | 0 | (none) | extra in POC, empty |

*Operational files in POC are wrapped objects `{ "operationalXxx": [...] }` while REF stores them as plain arrays. **This shape difference may break upload** depending on how the AVNI server parser interprets it. **Check first thing on upload.**

---

## Section 2 — Referential integrity (PASS)

| Check | Result |
|---|---|
| All `formElement.concept.uuid` exist in `concepts.json` | ✅ 0 missing |
| All `formMappings.formUUID` exist as a form file | ✅ 0 dangling |
| All `formMappings.subjectTypeUUID` exist | ✅ 0 dangling |
| All `formMappings` entity refs (program/encounter/subject) exist | ✅ 0 dangling |
| All forms parse as valid JSON | ✅ 34/34 |

The cross-references are all internally consistent. If the bundle had been *only* validated for "do all UUIDs link up", it would pass.

---

## Section 3 — Concepts: junk + drift

### 3a. Junk concepts (11) — must remove before upload

These have `dataType: "NA"` (invalid), are unreferenced by any form, and look like SRS authoring scratch values:

| Concept name | Why it's junk |
|---|---|
| `Pre added Options` | SRS column-header text |
| `In case of Gravida do not show 2` | SRS skip-logic instruction text |
| `3`, `5 scheme option` | SRS row indices |
| `Option 1`, `Option 2`, `Option1` | SRS placeholder values |
| `Yes`, `No` | These should be the standard UUIDs (`STANDARD_UUIDS.Yes/No` from generator) — duplication |
| `PHC`, `SS` | Likely abbreviations from a coded answer set that was misclassified |

**Fix:** delete these 11 entries from `concepts.json`. They are unreferenced (orphans), so removal is safe.

### 3b. dataType distribution

```
Coded:    72   (44%)   ← coded-answer concepts
Text:     31   (19%)
Numeric:  30   (18%)
Date:     17   (10%)
NA:       11   (7%)    ← THE JUNK
Subject:   1
Id:        2
```

**`NA` should be 0.** That's an invalid AVNI dataType.

### 3c. dataType drift vs reference (111 concepts)

POC types many concepts more aggressively than REF:

| Concept | POC | REF |
|---|---|---|
| Gender of the individual | Coded | Text |
| Date of birth of the individual | Date | Text |
| Age of the individual | Numeric | Text |
| Contact Number | Numeric | Text |
| Religion / Caste / Marital Status / Education | Coded | Text |

POC's typing is *probably correct* — `Date of birth` should be `Date`, gender should be `Coded`. But this is a judgment call per concept. **Flag for human review;** don't auto-revert to REF's all-Text.

### 3d. Concepts in REF that POC is missing (4)

| Name | Comment |
|---|---|
| `OPTIONS (needed for Single Select and Multi Select)` | This is a SRS template column header. Shouldn't be a concept. **REF has the bug; POC fixed it.** |
| `Field Name` | Same as above. |
| `Birth-Weight  (in grams)` (double space) | POC has `Birth-Weight (in grams)` (single space). REF was generated from a typo'd SRS row. POC normalized whitespace. **POC is more correct.** |
| `Height for age  (Stunting status):` (double space) | Same whitespace normalization. |

**No action needed** — POC's deltas are improvements, not regressions.

---

## Section 4 — Server-blocking errors (20)

The validator's `F2` check ("same concept twice in form") fires on cross-group reuse, which AVNI's server rejects. Three forms are affected:

### 4a. Immunization (16 errors)

The form has 27 groups, one per vaccine event. Five "age" concepts are referenced across multiple groups:

| Concept | Used in N groups |
|---|---:|
| `6 Weeks (Day 42)` | 5 |
| `10 Weeks (Day 70)` | 3 |
| `14 Weeks (Day 98)` | 5 |
| `9 Months` | 3 |
| `16–24 Months` | 4 |
| `Recommended Age` | 2 |

Three valid AVNI patterns to fix this:

1. **Rename per group** — `"6 Weeks - OPV"`, `"6 Weeks - IPV"`, etc. Creates 16 new concepts. Most explicit.
2. **Use a RepeatableQuestionGroup** — model the immunization schedule as a single repeating row. Most idiomatic AVNI but requires re-shaping the form structure.
3. **Inline coded answer** — combine the age + vaccine into a single Coded concept with answers like "OPV at 6 weeks". Compact but loses individual-field semantics.

This is a **semantic decision** — needs the agent (with `product-codebase` + `backend-architecture` skills) to consult the SRS author's intent or apply a default.

### 4b. Pregnancy Exit (1 error)

`"Other reason, please specify"` used twice. Probably belongs to two different reason categories; **rename one** with a category prefix.

### 4c. Pregnancy Gov Schemes (3 errors)

`"Scheme Amount Recievied"` used 4 times across 4 government schemes. Same fix pattern as Immunization. **Bonus:** this concept name has a typo (`Recievied` → `Received`). Worth fixing while we're here.

---

## Section 5 — DataType warnings (2)

| Concept | In form | In concepts.json | Risk |
|---|---|---|---|
| `Recommended Age` | Text | Id | Form will accept text, server expects an Id ref. **Will fail on save.** |
| `BMI (autocalculate)` | Numeric | Coded | Calculated numeric vs coded answer set — fundamentally different. **Will fail.** |

**Both are real bugs.** Pick one side as truth (likely the form side for `BMI`, server side for `Recommended Age`) and align.

---

## Section 6 — Operational files shape concern

Reference bundle stores them as plain arrays:

```json
// REF/operationalSubjectTypes.json
[ { "uuid": "...", "subjectTypeUUID": "...", "name": "..." }, ... ]
```

POC stores them wrapped:

```json
// POC/operationalSubjectTypes.json
{ "operationalSubjectTypes": [ { "uuid": "...", ... }, ... ] }
```

AVNI server's `BundleZipFileImporter` expects *arrays*. The wrapped form **may be rejected.**

**Action:** unwrap before upload, OR fix the generator to emit plain arrays. (Generator bug, not bundle content bug.)

---

## Section 7 — Action plan to make this bundle upload-ready

Ordered cheapest → most expensive:

| # | Action | Type | LLM tokens? |
|---|---|---|---:|
| 1 | Delete 11 `dataType: NA` concepts from concepts.json | mechanical | 0 |
| 2 | Unwrap `operational*` files to plain arrays | mechanical | 0 |
| 3 | Fix typo: `Scheme Amount Recievied` → `Received` | mechanical | 0 |
| 4 | Align `Recommended Age` form-type with concepts.json | mechanical | 0 |
| 5 | Align `BMI (autocalculate)` form-type with concepts.json | mechanical | 0 |
| 6 | Decide pattern for Immunization cross-group reuse, then apply | **semantic** | ~3-5k |
| 7 | Apply same pattern to Pregnancy Gov Schemes | **semantic** | ~1-2k |
| 8 | Disambiguate `Other reason, please specify` in Pregnancy Exit | **semantic** | ~500 |
| 9 | Re-validate; expect 0 errors | mechanical | 0 |
| 10 | Re-zip in canonical order | mechanical | 0 |

Estimate: ~5-8k LLM tokens total to make this bundle clean. At current Sonnet pricing, **~$0.05-$0.10 per bundle from raw SRS to upload-ready.**

---

## Section 8 — What the audit reveals about the SDK design

1. **80% of the cleanup is mechanical.** A "policy bot" running deterministic Node code can fix junk concepts, type drift, file shape, naming typos *before the LLM is even invoked.* This keeps cost-per-bundle low.

2. **The 20% that's semantic is unavoidable.** Cross-group reuse in Immunization is genuinely ambiguous — the SDK must surface this as a question to the user, not auto-fix it. UI design implication: a "review pending decisions" panel.

3. **The validator is the spec.** It catches things the generator can't predict from SRS shape alone. Make it a runtime tool the agent calls after every edit, not a one-shot pre-upload check.

4. **The reference bundle (V2) is not gospel.** POC fixes 4 things V2 has wrong (whitespace duplicates, leaked SRS column headers as concepts). Don't blindly diff against REF — diff intelligently.

5. **There's no "is this a good bundle?" without domain context.** The 111 dataType drift entries are a judgment call. The product needs an "AVNI domain expert" skill the agent consults to make these calls — that's where ongoing skill refinement adds value.

---

## Files produced

- `workspace/current/` — the audited bundle (still has the 22-error state — clean it in next iteration)
- `workspace/POC-JK-Laxmi.zip` — the audited zip
- `results/AUDIT.md` — this document
