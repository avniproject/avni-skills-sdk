# Agent failure modes observed in the wild — and the SDK's hard-rules response

When `/v1/sessions/:id/messages` was first run against a real new SRS (Durga India, 18 forms, 2 subject types, 2 programs, 234 concepts), Claude produced a structurally-valid bundle in 2 turns — but with **20 mechanical validator errors** in three concrete clusters. None of these errors were the SRS's fault; all were introduced by the agent guessing instead of consulting the skills knowledge base.

This document records the observed clusters and the SDK-level mitigation we shipped (commit-pinned in this commit's `BUNDLE_HARD_RULES`).

---

## Cluster 1 — F5 ×10: dangling concept UUIDs

**Symptom**

10 cancellation forms each contained a `formElement` with `concept.uuid: "c-cancel-reason-001"`. That UUID never appeared in `concepts.json`.

**Root cause**

The agent invented the concept UUID `c-cancel-reason-001` (not v4-shaped) when wiring up the cancellation forms, but didn't add the actual concept to `concepts.json` in the same turn. AVNI's server-contract validator's F5 check then fired 10 times.

**Fix in the bundle**

Add the missing parent concept (Coded, with 3 answers: No Show, Rescheduled, Other) and 3 standalone NA answer concepts. One turn, one file, 10 errors gone.

**SDK mitigation**

Hard rule #1 (no invented UUIDs) and #2 (atomicity — concepts and references in the same turn) explicitly cover this in `BUNDLE_HARD_RULES`.

---

## Cluster 2 — G2 ×9: invented enum values

**Symptom**

9 entries in `groupPrivilege.json` with `privilegeType` values like `"CreateEncounter"`, `"ViewEncounter"`, `"EditEncounter"`. None are in AVNI's server-side `PrivilegeType` enum.

**Root cause**

The agent picked plausible-sounding names instead of consulting the canonical list. `Encounter` is an AVNI concept, but the privilege enum uses `Visit`-prefixed names (`PerformVisit`, `ViewVisit`, `EditVisit`).

**Fix in the bundle**

Mapping:

| Agent invented | Correct AVNI |
|---|---|
| `CreateEncounter` | `PerformVisit` |
| `ViewEncounter` | `ViewVisit` |
| `EditEncounter` | `EditVisit` |

**SDK mitigation**

Hard rule #4 enumerates the full `PrivilegeType` set verbatim in the system prompt — the agent now sees the canonical names every turn. Same for `dataType`. For other enums (formType, subjectType.type), the rule directs the agent to read `.claude/skills/backend-architecture/` first.

---

## Cluster 3 — C5 ×1, then C3/D1 ×1: duplicate concept name

**Symptom**

Initial: 1 dangling Coded answer (Religion → "other" UUID had no standalone concept).

Mid-fix: tried to add a new "Other" concept with UUID `ans-other` — but a concept named "Other" already existed in concepts.json with a different UUID. AVNI requires concept names to be globally unique; the validator's C3/D1 check fired.

**Fix in the bundle**

Reuse the existing "Other" UUID (`dde76252-3032-41f5-ab53-1802951574ee`) everywhere — both in concepts.json and in the `answers` arrays inside the 10 cancellation forms.

**SDK mitigation**

Hard rule #5: before creating a concept named "X", search concepts.json for an existing one with that name. Reuse its UUID.

---

## End state of the Durga India bundle (after WoO fixes via `/v1/sessions/:id/edit`)

```
Validator: 0 errors, 4 warnings
Org-agnostic invariants harness: 15/16 pass
  (the failing test is #03 v4-shaped UUIDs — agent's invented UUIDs
   like c-cancel-reason-001 are still in there, technically valid
   for AVNI but not v4)
ZIP: 58KB, 32 files, integrity OK
```

The remaining warnings are 3 non-v4 UUIDs (warnings only, will upload fine to AVNI) plus 1 dataType mismatch warning that was present from the deterministic first-pass.

---

## What the SDK now does differently for future SRS runs

`src/agent.js` exports `BUNDLE_HARD_RULES` — a single source-of-truth block with 6 rules. It's wired into:

1. `DEFAULT_SYSTEM_PROMPT` (used by `/v1/agent/query`)
2. The override system prompt in `/v1/sessions/:id/messages`

So every Claude call against this SDK now sees:

```
HARD RULES — do NOT violate any of these:
  1. NEVER invent UUIDs (must be v4-shaped)
  2. ATOMICITY — concept + reference in the same turn
  3. CODED ANSWERS must each be standalone concepts
  4. NEVER invent enum values — canonical PrivilegeType / dataType enumerated inline
  5. NAME UNIQUENESS — search before creating duplicates
  6. STOP if you can't satisfy a constraint, don't paper over with placeholders
```

We explicitly chose **prompt-level mitigation over machinery-level mitigation**: no auto-rejected commits, no stub-concept auto-injection. The agent gets clear rules; if it violates them, the validator surfaces the specific class of error and the next turn fixes it. This keeps the SDK simple and lets the user see the agent's reasoning end-to-end.

---

## How to verify the mitigation works on a future run

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
AVNI_SKILLS_PATH=~/code/avni-skills npm run cli -- \
  --forms /path/to/NewOrg-Forms.xlsx \
  --modelling /path/to/NewOrg-Modelling.xlsx \
  --org NewOrg
```

Then ask the agent to "create the bundle" the same way the Durga run did. After the agent finishes, run the harness on the result:

```bash
curl -sf http://localhost:3030/v1/sessions/<SID>/zip -o /tmp/NewOrg.zip
unzip /tmp/NewOrg.zip -d /tmp/NewOrg-extract
node tests/bundle-harness.cjs /tmp/NewOrg-extract
```

Expected: zero F5 errors, zero G2 errors, zero C3/D1 duplicate-name errors. If any appear, the rules need another revision; open an issue with the agent's transcript and the bundle.
