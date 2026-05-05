# Phase 2 — Live Run (real Anthropic key, real SRS, real bundle on disk)

**Date:** 2026-05-05
**Endpoint:** `POST /v1/agent/query`
**Driver:** `scripts/demo-full-bundle.sh`
**Inputs:** Astitva SRS — `Astitva Nourish Program Forms.xlsx` + `Astitva Modelling.xlsx`
**Output:** bundle directory at `/tmp/demo-bundle/`

---

## Why this run matters

Phase 2 of the roadmap claimed "HTTP API + Claude Agent SDK runtime, BYO key, verified L1–L6." This run is the empirical proof of that claim — the agent took a real SRS, ran the canonical workflow end-to-end via the API, produced a server-contract-valid bundle on disk, and classified the residual issues correctly.

It also confirms the agent isn't hallucinating from training-data memory. Numbers match the offline empirical baseline (`docs/multi-org-empirical.md`) exactly, including details only present in the live validator output.

---

## What the agent did

| Step | Tool | Action |
|---|---|---|
| 1 | `Read` | `.claude/skills/srs-bundle-generator/SKILL.md` |
| 2 | `Bash` | Ran `node generate_bundle_v2.js --forms ... --srs ... --org Astitva-Demo --output /tmp/demo-bundle --no-validate` |
| 3 | `Bash` | Loaded `BundleValidator` and validated the output dir |

3 tool calls. Tight, focused. Followed the SKILL.md guidance for "new org → deterministic UUIDs via SHA-256."

---

## Agent's structured report (verbatim)

```markdown
## Step 1: Read the SKILL.md for confirmation
**Workflow confirmed:** For a new org (Astitva-Demo), the generator produces
deterministic UUIDs within the bundle via SHA-256.

## Step 2: Run the deterministic generator
✅ Generation complete: 203 concepts, 18 forms + 28 cancellation forms,
4 programs, 28 encounter types, 4 subject types.

## Step 3: Run the server-contract validator

## Step 4: Error Classification
Errors: 6 total — All F2 (concept reuse)
- Form "Draft": Gender, Date of Birth, Age (Auto), Mother Name, Enrollment Date — each used twice
- Form "Mother Monitoring - HCCM Daily ": Remarks used twice

Warnings: 6 total — Datatype mismatches (SRS-gap)
- LMP: declared Text in form, Date in concepts
- Father's/Mother's Occupation: Text in form, Coded in concepts
- Address: Text in form, Coded in concepts
- Beneficiary Name: Text in form, Subject in concepts

## Step 5: Summary Report
Bundle composition:
| Artifact | Count |
|----------|-------|
| Concepts | 203 (123 questions, 80 answers) |
| Forms | 18 + 28 cancellation = 46 |
| Programs | 4 |
| Encounter Types | 28 |
| Subject Types | 4 (Beneficiary, School, Anganwadi, User) |

Validation: FAIL (6 errors, all F2; 0 mechanical/reference issues)

## Recommended Next Step
Semantic fix needed (F2 errors). Three valid AVNI patterns:
1. Rename per context — "Gender (Beneficiary)", "Gender (Student)"
2. RepeatableQuestionGroup — if Draft collects multiple subjects at once
3. Coded answer set — if Gender/DOB/Age are metadata, not questions

Data type fix (SRS-gap):
Update 4 concepts in the modelling sheet (LMP → Date, Occupations → Coded,
Address → Coded), then re-run the generator.

File location: /tmp/demo-bundle ✓ Ready for remediation
```

---

## Verification: numbers match empirical baseline

Cross-check against `docs/multi-org-empirical.md` (the offline 10-org run that produced the published Astitva numbers):

| Metric | Empirical doc | Live agent run | Match |
|---|---|---|---|
| Concepts | 203 | 203 | ✅ |
| Forms (base + cancel) | 46 | 46 | ✅ |
| Programs | 4 | 4 | ✅ |
| Encounter Types | 28 | 28 | ✅ |
| Subject Types | 4 | 4 | ✅ |
| Validator errors | 6 | 6 | ✅ |
| All F2 (semantic only) | yes | yes — all 6 | ✅ |

**Bonus** — the live agent caught one detail my offline empirical run only mentioned in passing: `Remarks` used twice in `Mother Monitoring - HCCM Daily`. That confirms the agent is reading the live validator output, not just listing the cached top-level F2 forms.

---

## Cost

| Item | Value |
|---|---|
| Total tokens — input | 34 |
| Total tokens — cache create | 33,411 |
| Total tokens — cache read | 83,120 |
| Total tokens — output | 1,997 |
| **Total cost (USD)** | **$0.0612** |
| Stop reason | `end_turn` |
| Errors during run | 0 |

About 6 cents for a full SRS-to-bundle run + classification + recommendation. Real bundle iteration (Phase 3, where the agent only consults 1-2 skills per turn) should be a fraction of this per turn.

---

## Generated bundle on disk

`/tmp/demo-bundle/` contained 12 top-level JSON files + a `forms/` directory:

```
addressLevelTypes.json          (1.1 KB)
concepts.json                   (41.0 KB)
encounterTypes.json             (4.9 KB)
formMappings.json               (17.5 KB)
forms/                          (46 form files)
groupPrivilege.json             (2 B)
groups.json                     (473 B)
individualRelation.json         (5.7 KB)
operationalEncounterTypes.json  (6.6 KB)
operationalPrograms.json        (1.0 KB)
operationalSubjectTypes.json    (982 B)
organisationConfig.json         (194 B)
```

Server-uploadable shape, validator-known to fail with the 6 F2 issues — exactly what the offline run produced.

---

## What this proves

1. **Phase 2 is conclusively done.** The `avni-skills` knowledge base is driveable from any language via HTTP, BYO Anthropic key, end-to-end-proven on a real org.
2. **The agent uses the canonical workflow.** Read SKILL.md → generator → validator → classify → recommend. Nothing improvised.
3. **No hallucination.** Numbers match offline empirical truth. The agent reads live validator output, not cached AVNI knowledge.
4. **Cost-efficient.** ~$0.06 per full run — well within "pay-per-use" economics.

## What this doesn't yet prove (Phase 3 territory)

- The agent **reported** the F2 errors but didn't **fix** them. Iterative editing across multiple turns isn't yet supported.
- The bundle on disk is unchanged from what the deterministic generator produced.
- No ZIP packaging via the agent endpoint (use `/v1/bundles/generate` for one-shot ZIP today).

Phase 3 sketch (next):

```
POST   /v1/sessions                       create a workspace, do first-pass
POST   /v1/sessions/:id/messages           "fix Draft's F2 via RepeatableQuestionGroup"
                                           → agent edits bundle, re-validates, commits as turn 1
GET    /v1/sessions/:id/turns/:n/diff      see what changed
POST   /v1/sessions/:id/revert             roll back a bad turn
GET    /v1/sessions/:id/zip                final ZIP
```

Each turn = a git commit. Iterative, revertable, audit-trail.
