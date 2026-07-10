# Doorstep School — bundle generation verification & enablement

**Status:** Approved design (2026-07-10). Next: implementation plan via `writing-plans`.
**Branch:** `feature/doorstep-bundle-generation`

---

## Context

We need to verify — and then enable — that this repo's **generic** SRS→bundle
generator can produce the **Door Step School (DSS) Mumbai** Avni bundle from the
org's own scoping inputs, with only the enhancements an org would reasonably be
expected to supply. The trigger: a real scoping document + a deployed UAT bundle
were handed over, and we want a repeatable, evidence-backed answer to "can the
`avni-skills-sdk` pipeline generate this bundle?" — not a one-off hand-build.

This matters because a prior DSS bundle (`avni-skills/srs-bundle-generator/output/DSS-Mumbai/`)
was produced by a **hardcoded one-off script** from an ephemeral YAML spec — which
violates the project's "no hardcoded org heuristics" principle (CLAUDE.md §4) and
proves nothing about the generic pipeline. This spec replaces that with a
**generic-pipeline + parity-tested** approach.

### Inputs (provided)
- `Doorstep school Scoping Document  [To-Use].xlsx` — 35-sheet authoring workbook;
  its ~14 per-form sheets are the **Forms** source.
- `Doorstep school Modelling.xlsx` — a newer, generator-shaped **Modelling** workbook
  (sheets: `Subject Types`, `Programs`, `Program`, `Encounters`, `Program Encounters`,
  `Location Hierarchy`).
- `Door Step School UAT.zip` — the deployed Avni admin bundle; the **parity oracle**.

### Key finding — topology is settled
The scoping doc's prose "latest decision" (Apr-2026) modelled FLN/Reading/Library/Remedial
as a *Coded concept on Class* (only Donor Association a real Program). The **provided
Modelling.xlsx supersedes that**: it encodes the **UAT as-built topology** — those four
are **real Avni Programs on the Student subject**, each with Enrolment/Exit forms; Donor
Association is a Program on School. Class explicitly reads *"Program lives on Student via
Avni Program enrolments."* Therefore **targeting the UAT is gap-filling, not a redesign** —
consistent with the org's own newest input.

---

## Goal & success criteria

Feed the two provided workbooks (enhanced only to fill reasonably-expected missing
detail) through this repo's generator and produce a bundle that achieves
**entity-graph parity** with the deployed UAT bundle:

1. **Generates & validates:** the generator runs; `bundle_validator` reports **0 errors**;
   `bundle_integrity_check` reports **no `severity:error`** finding.
2. **Entity-graph parity (by name, active-only):** every **active** target entity is present,
   matched on **name-normalized** identity, across these classes:
   `addressLevelTypes`, `subjectTypes`, `programs`, `encounterTypes`, `forms`, `formMappings`.
3. **Out of scope (informational only, never a gate):** concept-level and form-field parity
   (individual questions / Coded answer options). Reported as a delta metric to guide
   authoring, but does **not** block success. (User explicitly chose entity-graph parity,
   declined full field parity.)

### Target entity counts (active, from the UAT oracle)
| Class | Active | Notes |
|---|---|---|
| addressLevelTypes | 4 | State › District › Ward › School |
| subjectTypes | 5 | Student, Teacher, Class, School, Donor Associations |
| programs | 4 | FLN, Reading, Library, Remedial (Donor Association is voided) |
| encounterTypes | 6 | Attendance is voided |
| forms | 25 | 4 voided forms excluded from the 29 total |
| formMappings | 25 | mirrors active forms |

**Voided entities are excluded** from parity (Donor Association program, Attendance
encounter, and the 4 `voided~` forms). **Admin artifacts the generator does not emit are
also excluded** from parity scope: `reportCard`, `reportDashboard`, `groupPrivilege`,
`groups`, `groupDashboards`, `organisationConfig`, `attendanceTypes`, `calendars`,
`locations`, `catchments`. Parity is scoped to the **generatable core**.

---

## Data handling (CLAUDE.md §2 — no proprietary data committed)

The three real files are proprietary org data and **must not enter git history**.

- Stage them under `tests/resources/doorstep/` but **gitignored** (add explicit ignore
  entries; `*.xlsx`/`*.zip` are already root-ignored, but add a `tests/resources/doorstep/`
  guard + a committed `README.md` explaining how to obtain/place them).
- The parity harness **auto-skips when the real files are absent** (same gating pattern as
  the real-LLM eval harness), so CI stays green with zero proprietary data.
- For **committed CI coverage**, add a **synthetic, org-agnostic fixture** — an invented org
  with the *same entity shapes* (subject/program/encounter/form graph) — verifying the
  harness mechanics end-to-end without any real data. Honors CLAUDE.md §1 (org-agnostic tests).

---

## Architecture — three phases

### Phase 1 — Spec
This document.

### Phase 2 — Parity test harness (`tests/corpus/doorstep/`)
A new harness that regenerates a bundle from an SRS and diffs it against a reference
bundle — **no such test exists today**; the closest analogs compare detectors or start
from an already-generated bundle.

Components (each a small, single-purpose unit):
1. **Generate** — build the bundle from the Forms + Modelling workbooks. Reuse
   `tests/entities/lib/fixture.cjs` `generate({formsSheets, modellingSheets, org})` (the
   in-memory generate-and-inspect primitive) or the `generate_bundle_v2.js` CLI for the
   real xlsx path.
2. **Validate** — run `bundle_validator` (assert 0 errors) and `bundle_integrity_check`
   (assert no `severity:error`).
3. **Normalize** — reduce both generated and UAT bundles to name-keyed, UUID-independent
   entities via `pipeline.js` `bundleToEntities` (the generator mints deterministic MD5-name
   UUIDs; the UAT has server-random UUIDs — raw JSON diff is meaningless).
4. **Diff & report** — a name-normalized `deepEqual`-style comparison (mirroring
   `tests/corpus/run.cjs`) over each entity class; emit a **parity report**:
   `present / missing / extra` per class + the informational concept delta.
5. **Gating** — skip on absent real resources; always run the synthetic fixture.

Reused primitives: `fixture.cjs` `generate`/`loadBundle`, `pipeline.js`
`bundleToEntities`/`emitSpec`, `corpus/run.cjs` deep-equality over entity collections.

### Phase 3 — Enhance inputs + repo until parity is green
The bulk of the effort is **data (workbook authoring), not code**:
- **Curate the Forms workbook:** extract the true form sheets from the 35-sheet scoping doc
  (non-form sheets are skipped by the generator when they lack a "Field Name" column — verify
  this holds); align sheet names to UAT form names.
- **Author missing per-program forms:** the UAT's Enrolment/Exit forms (FLN/Reading/Library/
  Remedial Enrolment + Exit) that the scoping doc omits under its older design. Their fields
  are described in the Modelling workbook's "Data Captured" prose — this is the primary
  "missing detail reasonably expected from the org."
- **Reconcile duplicate modelling sheets:** the Modelling workbook has both a `Programs` and a
  canonical `Program` sheet (both match the generator's `program` regex) — determine which the
  generator consumes and drop/rename the redundant one.
- **Fix data defects** flagged during exploration: misaligned option cells in Student Register
  & Teacher Details; `Subject`-typed field encodings.
- **Mine `avni-skills/dss_notes.txt`** (~36 KB design log) as a primary source for auto-fill /
  eligibility / visit-schedule detail.
- **Repo (SDK) code changes** only where the *generic* pipeline genuinely needs them to handle
  a legitimate scoping-doc pattern. Every change stays **org-agnostic** (no DSS-specific
  branch, per §4).

---

## Constraints honored

| Constraint | How |
|---|---|
| Local repo changes only (`avni-skills-sdk`) | No edits to `avni-skills`; sibling repos are read-only references. |
| No proprietary data (§2) | Real files gitignored + auto-skip; synthetic fixture for CI. |
| Generator fixes go upstream (§3) | A **generator-core** gap → captured as a finding + a regression test here, **not** patched in `avni-skills`. Surfaced as an upstream ticket. |
| Org-agnostic committed tests (§1) | The committed fixture is a synthetic invented org. |
| No hardcoded org heuristics (§4) | No DSS-specific code path; all DSS-specific content lives in the (gitignored) workbooks. |
| Periodic commits | Each phase (and each self-contained sub-step) committed on this branch to avoid an irretrievable state. |

---

## Risks / open questions (tracked, non-blocking)

- **Skip-sheet reliability:** feeding the 35-sheet scoping doc depends on non-form sheets being
  reliably dropped (generator skips sheets lacking a "Field Name" column). Verified empirically
  in Phase 2 before relying on it.
- **Form-name alignment:** e.g. scoping "Donor Association Program" vs UAT "Donor Association".
  Handled by name-normalization + targeted sheet renames.
- **Reachability of parity without a generator-core change** is the central empirical question
  Phase 3 answers. If a core gap blocks parity, it becomes a **documented finding + upstream
  ticket + regression test**, not a silent local patch — and success for that entity is reported
  as "blocked on upstream," not faked.
- **Concept parity is informational** — a low concept overlap is a signal to author more form
  detail, not a failure.

---

## Definition of done

1. `tests/corpus/doorstep/` harness exists, runs the synthetic fixture in CI (committed, green),
   and — when the gitignored real files are present locally — produces a parity report.
2. Against the real Doorstep inputs, the generated bundle: validator 0 errors, integrity clean,
   and **entity-graph parity = 100% of active target entities present by name** (or any shortfall
   is a documented upstream-blocked finding).
3. All DSS-specific content confined to gitignored workbooks; all committed code org-agnostic.
4. Implemented via the superpowers flow (writing-plans → TDD/executing-plans), committed
   incrementally on `feature/doorstep-bundle-generation`.
