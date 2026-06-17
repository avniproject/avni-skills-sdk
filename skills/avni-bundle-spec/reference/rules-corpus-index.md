# Avni rule corpus — index

Where each **rule field** lives in a bundle, and the real-corpus shape. Avni rules
are strings of JavaScript that the `rules-server` evaluates at runtime. They are
NOT free-form — they reference concept UUIDs that must exist and call a fixed set
of `imports.*` APIs. The cardinal mistake is writing raw JS that references a
concept UUID you invented.

> This is an **index**, not the full corpus. For authoring rules, also consult the
> `rules-author` skill (IR-first emission). This page tells you which field carries
> which rule type and the canonical body shape.

## Rule fields by entity

| Entity / file | Rule field | What it does |
|---|---|---|
| `subjectTypes.json[]` | `subjectSummaryRule` | header line shown on a subject's profile |
| | `programEligibilityCheckRule` | whether a subject can enrol in a program |
| | `memberAdditionEligibilityCheckRule` | (groups) whether a member can be added |
| `programs.json[]` | `enrolmentSummaryRule` | header on an enrolment |
| | `enrolmentEligibilityCheckRule` | gate enrolment |
| | `manualEnrolmentEligibilityCheckRule` | gate manual enrolment |
| `encounterTypes.json[]` | `encounterEligibilityCheckRule` | gate an encounter |
| `forms/*.json[]` | `decisionRule` | compute decisions from observations |
| | `validationRule` | raise a validation error |
| | `visitScheduleRule` | schedule follow-up visits |
| | `checklistsRule` | build a checklist (e.g. vaccination) |
| | `editFormRule` | conditionally edit-gate a form |
| `forms[].formElementGroups[].formElements[]` | `rule` | **skip-logic** — show/hide an element (by far the highest-volume rule type) |

## Corpus volume (harvested from 21 real org bundles)

The single dominant rule type is **formElement skip-logic** (≈4,769 rules across
20 orgs); next are `visitSchedule` (≈207), `formValidation` (≈128), and
`decision` (≈101). Everything else is in the low tens. Optimise authoring effort
for skip-logic and visit-schedule first.

| rule type | ~count | orgs |
|---|---:|---:|
| formElement skip-logic | 4769 | 20 |
| visitSchedule | 207 | 15 |
| formValidation | 128 | 13 |
| decision | 101 | 10 |
| enrolmentSummary | 26 | 8 |
| subjectSummary | 26 | 11 |
| eligibility (enrolment/manual/member) | 44 | 10 |
| editForm | 6 | 4 |
| checklists | 4 | 4 |

## Canonical body shape

**100% of harvested rules use the arrow form** — no legacy `function(params, imports)`
bodies exist:

```javascript
'use strict';
({ params, imports }) => {
  // params.entity — the entity the rule runs on (subject / enrolment / encounter / form)
  // imports.* — the fixed runtime API surface
  // …compute, then return the rule-type's expected value…
}
```

## Top runtime APIs (by frequency)

| API | use site |
|---|---|
| `imports.common.createValidationError(uuid, msg)` | `validationRule` |
| `new imports.rulesConfig.VisitScheduleBuilder({ programEncounter })` | `visitScheduleRule` |
| `new imports.rulesConfig.RuleCondition({ ... })` | `decisionRule`, `visitScheduleRule` |
| `imports.moment(...)` | every rule type (dates) |

## Authoring discipline (read before writing any rule)

1. **Every concept the rule reads must already exist** in `concepts.json` with the
   exact UUID. If the rule needs a new concept, add it (and its standalone answer
   concepts) in the same turn — atomicity.
2. **Do not invent `imports.*` APIs.** If an API isn't in the corpus, it doesn't
   exist. Prefer the IR-first path in the `rules-author` skill.
3. **Refuse + ask when the SRS is too vague** to know which concept/value/condition
   the rule should test. Do not paper over with a guessed UUID.
