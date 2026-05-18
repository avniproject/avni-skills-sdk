---
name: rules-author
description: |
  Author AVNI rules (decisionRule, visitScheduleRule, validationRule,
  formElement.rule, eligibility rules, summary rules) by emitting
  DeclarativeRule IR which the rules-brain compiles to canonical JS via
  rules-config's DeclarativeRuleHolder. Always prefer IR emission. Fall back
  to raw JS only when the IR can't express the rule.
version: 1
---

# rules-author

You are inside an AVNI bundle workspace. Files in this folder are JSON
entities (forms/, programs.json, encounterTypes.json, subjectTypes.json,
organisationConfig.json, concepts.json). Some carry **rule** fields — strings
of JavaScript that AVNI's `rules-server` evaluates at runtime.

This skill lets you author and edit those rules **safely**. The cardinal
mistake is to write raw JS that references concept UUIDs you invented or
calls APIs that don't exist. Don't do that. Use the IR-first path.

## When to use this skill

Triggered when the user asks to:

- "add a skip logic / show this field only when…"
- "schedule a follow-up visit after N days"
- "show an error when X is out of range"
- "compute a decision from these observations"
- "make this encounter eligible only when…"
- "edit the existing rule on form X to also handle Y"

## The rules-brain pipeline (3 paths)

| Path | When | What you emit |
|---|---|---|
| **Path A — IR emission** | The rule fits one of the 6 IR-able classes below | Write the IR JSON, then ask the runner to compile it via the rules-brain compiler |
| **Path B — Direct JS edit** | The rule is summary/checklist/worklist/editForm (no IR template) | Write the JS body directly, following the canonical patterns in §"Direct-JS rules" |
| **Path C — Refuse + ask** | The SRS or user prompt is too vague to author safely | Ask the user to clarify which concept/value/condition |

## The 6 IR-able rule types

| Rule field on bundle JSON | IR ruleType | Default entityName | Compiler method |
|---|---|---|---|
| `forms/*.json` `formElements[].rule` | `viewFilter` | per formType | `generateViewFilterRule` |
| `forms/*.json` `decisionRule` | `decision` | per formType | `generateDecisionRule` |
| `forms/*.json` `validationRule` | `formValidation` | per formType | `generateFormValidationRule` |
| `forms/*.json` `visitScheduleRule` | `visitSchedule` | per formType | `generateVisitScheduleRule` |
| `encounterTypes.json` `encounterEligibilityCheckRule` | `eligibility` | `individual` | `generateEligibilityRule` |
| `programs.json` `enrolmentEligibilityCheckRule` | `eligibility` | `individual` | `generateEligibilityRule` |

`entityName` follows the form's `formType`:
- `IndividualProfile` → `individual`
- `Encounter` → `encounter`
- `ProgramEnrolment` → `programEnrolment`
- `ProgramEncounter` → `programEncounter`

## IR shape (canonical)

A rule is an **array of DeclarativeRule objects**. Each DeclarativeRule has
two halves:

```json
[
  {
    "conditions": [
      {
        "conjunction": "and",
        "compoundRule": {
          "conjunction": "and",
          "rules": [
            {
              "lhs": {
                "type": "concept",
                "conceptName": "<exact name from concepts.json>",
                "conceptUuid": "<exact uuid from concepts.json>",
                "conceptDataType": "Coded" | "Numeric" | "Date" | "DateTime" | "Text" | "Id",
                "scope": "registration" | "enrolment" | "encounter" | "entireEnrolment" | "latestInAllEncounters" | "latestInPreviousEncounters" | "lastEncounter" | "latestInEntireEnrolment" | "exit" | "cancelEncounter" | "checklistItem"
              },
              "operator": "<see operator table below>",
              "rhs": { ... }
            }
          ]
        }
      }
    ],
    "actions": [
      { "actionType": "<see action table below>", "details": { ... } }
    ]
  }
]
```

### Operators (use exactly these strings)

| Family | Operator string | RHS shape |
|---|---|---|
| Coded | `containsAnswerConceptName` | `{ type: "answerConcept", answerConceptNames: [...], answerConceptUuids: [...] }` |
| Coded | `containsAnyAnswerConceptName` | same |
| Coded | `containsAnswerConceptNameOtherThan` | same |
| Numeric/Date | `equals` | `{ type: "value", value: <number\|string> }` |
| Numeric/Date | `lessThan` / `lessThanOrEqualTo` | `{ type: "value", value: <number> }` |
| Numeric/Date | `greaterThan` / `greaterThanOrEqualTo` | `{ type: "value", value: <number> }` |
| No-RHS | `defined` / `notDefined` | `{}` (empty object) |

### Actions

| actionType | details | Used in rule type |
|---|---|---|
| `showFormElement` | `{}` | viewFilter |
| `hideFormElement` | `{}` | viewFilter |
| `value` | `{ value: <any> }` | viewFilter (default value) |
| `skipAnswers` | `{ answersToSkip: [name], answerUuidsToSkip: [uuid] }` | viewFilter |
| `validationError` | `{ validationError: "<message>" }` | viewFilter (inline) |
| `formValidationError` | `{ validationError: "<message>" }` | formValidation |
| `addDecision` | `{ scope, conceptName, conceptUuid, conceptDataType, value }` | decision |
| `scheduleVisit` | `{ encounterType, encounterName, dateField, daysToSchedule: "<string>", daysToOverdue: "<string>" }` ⚠ days fields must be STRINGS (lodash `_.isEmpty` quirk) | visitSchedule |
| `showProgram` / `hideProgram` | `{}` | decision (program eligibility result) |
| `showEncounterType` / `hideEncounterType` | `{}` | decision (encounter eligibility result) |

## HARD RULES (the F5/G2/C3 guardrails — do NOT violate)

1. **Never invent a concept UUID.** Every `conceptUuid` and
   `answerConceptUuids[i]` MUST come from `concepts.json` in the working dir.
   Read it first. If a needed concept is missing, ASK the user; do not
   fabricate.

2. **Never invent a `rulesConfig` class.** Only these 13 exist:
   `RuleRegistry`, `FormElementsStatusHelper`, `RuleCondition`,
   `AdditionalComplicationsBuilder`, `SkipLogic`, `complicationsBuilder`,
   `FormElementStatusBuilder`, `StatusBuilderAnnotationFactory`,
   `VisitScheduleBuilder`, `FormElementStatus`, `WithName`, `lib`,
   `ActionEligibilityResponse`.

3. **`imports` injection is fixed.** Only these keys exist on `imports`:
   `rulesConfig`, `common`, `lodash`, `moment`, `motherCalculations`, `log`,
   `models`. **Never use `imports.globalFn` — it is not injected.**

4. **Wrapper shape is fixed.** Every rule body must be:
   ```js
   "use strict";
   ({params, imports}) => {
     // ...
   };
   ```
   Or use the canonical templates by going through Path A (IR + compile).

5. **No `require`, `eval`, `Function`, `fetch`, `process`, `global`.** The
   safe-eval sandbox rejects them and the Layer-4 validator will hard-fail
   the turn.

6. **Match the return shape to the rule type:**
   - validationRule → `Array` (push `imports.common.createValidationError(uuid, msg)`)
   - visitScheduleRule → `Array` (return `scheduleBuilder.getAll()`)
   - decisionRule → `Object` with at least one of `{registration,enrolment,encounter}Decisions`
   - eligibilityCheckRule → `Boolean`
   - summaryRule → `Array` of `{name, value}`

## How to do Path A (IR emission)

Goal: write IR JSON to a side file the orchestrator picks up, then let the
rules-brain compile it.

```
1. Read concepts.json. Resolve every conceptName your rule needs to its
   uuid + dataType + answers list. If anything is missing, STOP and ask.

2. Build the DeclarativeRule[] IR following the shape above.

3. Save the IR alongside the bundle file as
     <bundleFile>.<field>.declarativeRule.json
   e.g. forms/ANC.json.decisionRule.declarativeRule.json
   The orchestrator will pick it up and call:
     compileByField(ir, "form.decisionRule", { formType }) → js
   then write `js` into the target field on the bundle JSON.

4. After write, the Layer-4 validator runs over the produced JS.
   If it surfaces errors, fix the IR (not the JS).
```

## How to do Path B (direct JS — rules without IR templates)

These 6 rule types have no IR template. You write the JS body directly,
following corpus patterns:

- `checklistsRule`
- `editFormRule`
- `enrolmentSummaryRule`
- `subjectSummaryRule`
- `worklistUpdationRule`
- `messagingRule`

### Canonical shapes

```js
// subjectSummaryRule — must return [{name, value}]
"use strict";
({params, imports}) => {
  const individual = params.entity;
  const rows = [];
  const age = imports.moment().diff(imports.moment(individual.dateOfBirth), "years");
  rows.push({name: "Age", value: age});
  return rows;
};
```

```js
// enrolmentSummaryRule — return [{name, value}]
"use strict";
({params, imports}) => {
  const enrolment = params.entity;
  const rows = [];
  // walk enrolment.observations, enrolment.encounters[], etc.
  return rows;
};
```

```js
// checklistsRule — return checklist objects
"use strict";
({params, imports}) => {
  const checklists = params.checklistDetails || [];
  // mutate or push
  return checklists;
};
```

```js
// worklistUpdationRule
({params, imports}) => {
  const workLists = params.workLists;
  const WorkItem = imports.models.WorkItem;
  const entity = params.context?.entity;
  if (entity?.uuid) {
    workLists.addWorkItem(new WorkItem({uuid: entity.uuid, type: entity.type, entity}));
  }
};
```

```js
// editFormRule — gate edit permission
"use strict";
({params, imports}) => {
  const {entity, user, myUserGroups} = params;
  const isAdmin = (myUserGroups || []).some(g => g.groupName === "admin");
  if (!isAdmin) throw new Error("Only admins may edit");
};
```

After writing a Path-B rule, the Layer-4 validator will check syntax,
identifier whitelist, `imports.X` whitelist, and concept-UUID liveness.

## How to do EDITS

Editing an existing rule:

1. Read the current rule field from the bundle JSON. It's a JS string.
2. Try to decompile to IR: call `decompileToIr(jsString, ruleType, entityName)`
   from `src/rules-brain/decompile.js` (when available). If decompile
   succeeds, mutate the IR and recompile.
3. If decompile fails (the rule is too rich for the visual IR), drop to
   Path B: edit the JS string directly, then re-validate.

Editing means **byte-identical round-trip** for the parts you didn't touch.
Don't reformat. Don't change unrelated lines.

## Validator codes you'll see in turn feedback

| Code | Meaning |
|---|---|
| R1-SYNTAX | the JS doesn't parse — fix the body |
| R2-WRAPPER | top-level shape is wrong — must be `({params, imports}) => {...}` |
| R3-BLOCKED-GLOBAL | you used `require` / `eval` / etc. — remove it |
| R3-UNKNOWN-IDENT (warning) | you referenced a name that isn't declared or in the global allowlist — verify it |
| R4-BAD-IMPORT | you wrote `imports.X` where X isn't injected — use the 7 valid keys |
| R5-BAD-RULESCONFIG-CLASS | you used `imports.rulesConfig.Foo` where Foo isn't real — see the 13-class list |
| R6-UUID-UNKNOWN | a UUID literal isn't in `concepts.json` — likely invented; remove or replace |

If you see ≥1 error code, the turn fails and you must fix before continuing.
If you see only warnings, the turn lands but you should review them.

## Examples (good)

### viewFilter — show "Pregnancy Status" only if Gender is Female

IR:
```json
[{
  "conditions":[{"conjunction":"and","compoundRule":{"conjunction":"and","rules":[{
    "lhs":{"type":"concept","conceptName":"Gender","conceptUuid":"<uuid from concepts.json>","conceptDataType":"Coded","scope":"registration"},
    "operator":"containsAnyAnswerConceptName",
    "rhs":{"type":"answerConcept","answerConceptNames":["Female"],"answerConceptUuids":["<female uuid from concepts.json answers>"]}
  }]}}],
  "actions":[{"actionType":"showFormElement","details":{}}]
}]
```

### visitSchedule — 28 days after ANC 1, 14-day overdue window

IR (action only — conditions can be empty for "always schedule"):
```json
[{
  "conditions":[],
  "actions":[{
    "actionType":"scheduleVisit",
    "details":{
      "encounterType":"ANC 2","encounterName":"ANC 2",
      "dateField":"encounterDateTime",
      "daysToSchedule":"28","daysToOverdue":"42"
    }
  }]
}]
```

## Examples (bad — DON'T do these)

```js
// BAD: invented UUID, will fail R6-UUID-UNKNOWN
const female = "1234abcd-ffff-...";  // not in concepts.json
```

```js
// BAD: imports.globalFn not injected, R4-BAD-IMPORT
imports.globalFn.helperFn();
```

```js
// BAD: imports.rulesConfig.PregnancyHelper doesn't exist, R5-BAD-RULESCONFIG-CLASS
new imports.rulesConfig.PregnancyHelper();
```

```js
// BAD: require, eval — blocked global
const fs = require("fs");
```

## Files in this skill

- `SKILL.md` (this file)
- `01-rules-config-api.md` — full API reference (every class + method)
- `02-execution-context.md` — runtime sandbox + `params.entity` shapes
- `03-rule-corpus.md` — real production rule patterns
- `04-emitter-templates.md` — the 6 canonical JS templates
