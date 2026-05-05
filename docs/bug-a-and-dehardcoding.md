# Bug A + de-hardcoding sweep

**Date:** 2026-05-05
**Goal:** make the generator 100% SRS-driven — nothing hardcoded per org.

---

## Astitva: 42 errors → 6 (all remaining are semantic, not generator's fault)

| Error class | Before | After | What changed |
|---|---:|---:|---|
| `M3` (formMapping → missing subject type) | 36 | **0** | `findMatchingSubjectType` now auto-creates referenced subject types instead of leaving dangling refs |
| Program-UUID-not-found in cancellation form mappings | 10 | **0** | Sweep through `encounterTypes` registers every referenced program before write phase |
| `ProgramEnrolment requires programUUID` (enrolment/exit forms missing program) | 4 | **0** | Resolver now reads `Enrolment Form` / `Exit Form` columns from SRS Program sheet |
| `F2` (cross-group concept reuse) | 6 | 6 | Semantic — needs LLM agent or SRS author |
| **TOTAL** | **42** | **6** | **86% reduction** |

| Astitva metric | Pre-Bug-A | Post |
|---|---:|---:|
| Programs registered | 0 (via heuristic: phantom Pregnancy + Child) | **2 SRS-driven** (`Nourish`, `Enrich`) — slight name duplication from Program sheet's verbose names but server-OK |
| Subject types | 3 (from SRS Subject Types sheet, all named "X Registration") | 4 (`User` auto-created from encounter ref) |
| FormMapping integrity | 36 dangling refs | clean |
| `programSubjectLabel` on opPrograms | "Pregnant Woman" / "Child" (hardcoded) | "Beneficiary" (SRS-driven from Program sheet's Target Subject Type) |

---

## What was hardcoded (and what I did with each)

| # | Hardcoded thing | Where | Action |
|---|---|---|---|
| 1 | `getProgram(sheetName)` returns `'Pregnancy'` for sheets matching `anc/pnc/delivery/pregnancy/maternal/mother`, `'Child'` for `child/immunization/hbnc/newborn` | line 244 | **Removed** — now returns `null`. Programs come from SRS only. |
| 2 | `generateProgramEligibilityJsRule('Pregnancy')` returned `individual.isFemale()`; `'Child'` returned age-≤-2 rule | line 574 | **Removed** — returns empty. Eligibility rules should come from SRS or be added in admin. |
| 3 | `EXCLUSIVE_OPTIONS` included `'Td Booster'` (a JK-Laxmi vaccine) | line 34 | **Removed** that entry. Kept the AVNI-wide `None`/`NA`/`N/A`/`Not Applicable`. |
| 4 | Program colour: `programName === 'Pregnancy' ? '#74b5de' : '#96d643'` | line 1497 | **Removed.** Default colour `#96d643` for everything; colour should come from SRS or be set in admin. |
| 5 | `showGrowthChart: programName === 'Child'` | line 1500 | **Removed.** Default `false`; admin can toggle. |
| 6 | `programSubjectLabel: program.name === 'Pregnancy' ? 'Pregnant Woman' : 'Child'` | line 1841 | **Replaced** with: `program.subjectLabel \|\| programSubjectByName.get(name) \|\| program.name` — SRS-driven via Target Subject Type column. |

### What was kept (and why)

| Thing | Reason it's still in code |
|---|---|
| `STANDARD_UUIDS` (Yes/No/Male/Female/N/A/None/Other) | These are AVNI-server-wide constants, identical for every org. Not org-specific. |
| `EXCLUSIVE_OPTIONS = ['None', 'NA', 'N/A', 'Not Applicable']` | These are AVNI semantic conventions for "exclusive answer values" — apply universally. |
| `NORMAL_RANGES` (BP, Hemoglobin, Weight, etc.) | Lazy: only applied when a concept name matches one in the table. Doesn't poison non-clinical orgs. Could be moved to a separate `clinical_ranges.json` config later. |
| `DEFAULT_RELATIONS` / `DEFAULT_RELATIONSHIP_TYPES` (Husband/Wife/Father/Mother/Son/Daughter) | Conditional: only emitted when a Person/Household subject type exists. Sensible Indian-family default; admin can override. Could be SRS-driven if the SRS has a Relations sheet. |

---

## What the SRS now drives (the SDK-loop sees this directly)

Every program/encounter/subject-type decision now traces to an SRS cell:

| Decision | SRS column / sheet |
|---|---|
| Subject type names | `Modelling.xlsx → Subject Types → Subject Type Name` |
| Subject type type | `Modelling.xlsx → Subject Types → Type` |
| Program names | `Modelling.xlsx → Program → Program Name` (and discovered via Program Encounters sheet) |
| Program → target subject type | `Modelling.xlsx → Program → Target Subject Type` |
| Program subject label | same as above (was hardcoded, now SRS-driven) |
| Enrolment/Exit form → program | `Modelling.xlsx → Program → Enrolment Form / Exit Form` |
| Encounter → subject type (regular Encounters) | `Modelling.xlsx → Encounters → Subject Type` |
| Encounter → subject type (Program Encounters) | inherited from program (no Subject Type column in that sheet) |
| Encounter → program | `Modelling.xlsx → Program Encounters → Program name` |
| Auto-create missing subject types | when an encounter/program references a subject type not in the Subject Types sheet, auto-create with a warning (so M3 dangling-ref errors don't fire) |

---

## Side effect: JK Laxmi now needs a proper Modelling file

The previous JK Laxmi SRS fixture (`jk-laxmi.xlsx`) has **NO** Modelling-style sheets:

```
Sheets in jk-laxmi.xlsx:
  • Help and Status Tracker
  • Project Summary
  • User persona
  • W3H
  • Report
  • Permissions
  • Other Important Document Link
  • Review checklist
```

No `Program`, `Encounters`, or `Subject Types` sheet. The previous generator silently invented `Pregnancy` and `Child` programs via the `getProgram()` keyword heuristic.

**With the heuristic removed, JK Laxmi honestly produces 0 programs.** That's not a regression in the generator — it's a *visibility* of a real fixture-quality problem the old code was hiding. JK Laxmi's bundle was always semi-broken; the generator just papered over it with hardcoded guesses.

Three honest paths forward for JK Laxmi specifically:

1. **Improve the JK Laxmi SRS** — add a proper Modelling file with `Program` (Pregnancy, Child), `Encounters`, `Subject Types`, `Program Encounters` sheets. **The right answer.**
2. **Add `--infer-programs-from-sheet-names` CLI flag** that re-enables the keyword heuristic for backward compatibility with old SRSes. (Don't do this by default.)
3. **Let the agent loop discover programs** by analyzing form sheet names with an LLM. The LLM has more context than a regex — it can see "ANC Form" and propose creating a "Pregnancy" program, then ask the user to confirm. Aligns with the agent-driven product direction.

---

## Test harness: what's hardcoded in the harness itself

The harness has 2 JK-Laxmi-specific assertions (Tests 4, 5):

| Test | Current expectation |
|---|---|
| 04: form count | exactly 34 |
| 05: programs/encounter/subject counts | (2, 14, 2) |

These should be parametrized when adding a multi-fixture suite (you've been clear that's not the priority right now). For per-org runs, callers can override via env vars or a fixture metadata file. Other 14 tests are universal and pass on Astitva.

---

## Commits worth making

The generator changes are real upstream improvements and should land in `avniproject/avni-skills`:

1. `fix(srs-bundle-generator): remove org-specific Pregnancy/Child hardcoding`
2. `feat(srs-bundle-generator): drive program resolution from SRS Modelling sheets`
3. `fix(srs-bundle-generator): auto-create subject types referenced by encounters`
4. `fix(srs-bundle-generator): register all programs found in encounter types before write phase`

Total diff: ~80 lines net, in one file. Ready to PR if you want it.

---

## Files modified

- `/Users/samanvay/Downloads/avni-skills/srs-bundle-generator/scripts/generate_bundle_v2.js` — all changes here, ~80 lines
- `/Users/samanvay/Developer/avni-bundle-poc/astitva-poc-fix-A/` — final Astitva bundle (6 errors, all F2)
- `/Users/samanvay/Developer/avni-bundle-poc/jk-poc-final/` — JK Laxmi after de-hardcoding (0 programs registered, 26 errors)
- `/Users/samanvay/Developer/avni-bundle-poc/results/BUG-A-AND-DEHARDCODING.md` — this doc

---

## Recommendation for next move

The honest-correct generator is in place. Three options:

- **(a) Fix JK Laxmi SRS** to have a proper Modelling file. Then re-run both fixtures' tests, both should be clean. Aligns with "SRS is the source of truth."
- **(b) Move forward with the SDK loop** — the agent will see a generated bundle plus the validator's error list, then make decisions (including: "this org has no programs declared, would you like me to infer some from the form sheets?"). The generator no longer makes false claims; the agent fills the gap with intent-aware decisions.
- **(c) Commit the current changes as a PR to avniproject/avni-skills** so the upstream skill is fixed for everyone, and continue from there.

I'd do (c) → (b). Generator landing first means every subsequent fixture/test/agent-run benefits. Then the SDK loop is the visible product layer on top.
