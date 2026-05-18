# Rules-Config API Reference (harvested)

Source: `/Users/samanvay/Downloads/All/avni-ai/rules-config-master/`
Harvested: 2026-05-11

This is the canonical API surface every rule body can use. It's the load-bearing reference for Layer 2 (rules-author SKILL) and Layer 4 (validator imports whitelist).

---

## Exported classes (from `rules.js`)

### RuleCondition (`src/rules/RuleCondition.js`)

Chain-based predicate engine over individuals / encounters / enrolments.

**Fluency getters (no-ops, readability):** `is`, `when`, `look`
**Logical:** `not`, `and`, `or`
**Termination:** `matches() → boolean`, `then(fn) → void`

**Concept-value selectors** (each returns `RuleCondition`):
- `valueInRegistration(conceptNameOrUuid, parentConceptNameOrUuid?)`
- `valueInEnrolment(conceptNameOrUuid, parentConceptNameOrUuid?)`
- `valueInEncounter(conceptNameOrUuid, parentConceptNameOrUuid?)`
- `valueInExit(conceptNameOrUuid)`
- `valueInDecisions(conceptName)`
- `valueInCancelEncounter(conceptNameOrUuid)`
- `valueInChecklistItem(conceptNameOrUuid)`
- `valueInEntireEnrolment(conceptNameOrUuid, parentConceptNameOrUuid?)`
- `valueInLastEncounter(conceptNameOrUuid, encounterTypes, parentConceptNameOrUuid?)`
- `latestValueInAllEncounters(...)`, `latestValueInEntireEnrolment(...)`, `latestValueInPreviousEncounters(...)`
- `questionGroupValueIn{Encounter,Registration,Enrolment}(child, group, index)`

**Identity selectors (getters):** `age`, `ageInYears`, `ageInMonths`, `ageInWeeks`, `ageInDays`, `asAge`, `asDaysSince`, `male`, `female`, `gender`, `addressType`, `lowestAddressLevelType`, `lowestAddressLevel`, `encounterType`, `encounterMonth`, `filledAtleastOnceInEntireEnrolment`

**State predicates (getters):** `yes`, `no`, `defined`, `notDefined`, `truthy`

**Comparators:**
- `equals(value, unitIfDate?)` — `===` or `moment.isSame(unit)`
- `equalsOneOf(...values)`
- `lessThan(value, unitIfDate?)`, `lessThanOrEqualTo(...)`
- `greaterThan(value, unitIfDate?)`, `greaterThanOrEqualTo(...)`
- `containsAnswerConceptName(conceptNameOrUuid)`
- `containsAnyAnswerConceptName(...conceptNames)`
- `containsAnswerConceptNameOtherThan(conceptNameOrUuid)`
- `matchesFn(fn)` — custom `(value) => boolean`
- `whenItem(item)` — set contextual value

**Canonical example:**
```js
when.valueInEnrolment("BP Systolic").greaterThan(140).then(() => {
  // schedule a referral visit, etc.
});
```

### VisitScheduleBuilder (`src/rules/builder/VisitScheduleBuilder.js`)

- `add(schedule) → RuleCondition` — adds with conditional check
- `getAll() → array` — returns schedules where condition matched
- `removeVisitsWith(key, keyList) → void`
- `getAllUnique(keyPath, avoidExistingVisits) → array`

```js
const builder = new imports.rulesConfig.VisitScheduleBuilder({
  programEnrolment: params.entity.programEnrolment,
});
builder.add({name: "ANC 2", encounterType: "ANC", earliestDate: ..., maxDate: ...})
  .when.valueInEnrolment("LMP").defined;
return builder.getAll();
```

### FormElementStatusBuilder (`src/rules/builder/FormElementStatusBuilder.js`)

- `show() → RuleCondition`
- `value(value) → RuleCondition`
- `validationError(errorMessage) → RuleCondition`
- `skipAnswers(...answers) → RuleCondition`
- `showAnswers(...answers) → RuleCondition`
- `build() → FormElementStatus`

### FormElementStatus (`src/rules/model/FormElementStatus.js`)

Immutable VO. Constructor:
```
new FormElementStatus(uuid, visibility, value, answersToSkip=[], validationErrors=[], answersToShow=[], resetValueIfNull=false)
```
Fields: `uuid`, `visibility`, `value`, `answersToSkip`, `validationErrors`, `answersToShow`, `initializedWithNullValueOnPurpose`, `questionGroupIndex?`
Methods: `or(other)`, `and(other)`, static `resetIfValueIsNull(...)`

### AdditionalComplicationsBuilder (`src/rules/builder/AdditionalComplicationsBuilder.js`)

- `addComplication(complicationConcept) → RuleCondition`
- `getComplications() → {name, value: [concepts]}`
- `hasComplications() → boolean`

### complicationsBuilder (`src/rules/builder/complicationsBuilder.js`)

Same shape as `AdditionalComplicationsBuilder` but unique-merges.

### FormElementsStatusHelper (`src/rules/FormElementsStatusHelper.js`)

Static batch evaluator:
- `getFormElementsStatuses(handler, entity, formElementGroup, today) → [FormElementStatus]`
- `getFormElementsStatusesWithoutDefaults(handler, entity, formElementGroup, today) → [FormElementStatus]`
- `createStatusBasedOnCodedObservationMatch(programEncounter, formElement, conceptName, conceptValue) → FormElementStatus`
- `createStatusBasedOnGenderMatch(programEncounter, formElement, genderValue) → FormElementStatus`
- `weeksBetween(date1, date2) → number`

### RuleChain / RuleChainLink (`src/rules/RuleChain.js`, `RuleChainLink.js`)

Chain-of-responsibility for sequential rule link execution.
- `RuleChain.add(fn)` — `fn(next, context) => next(context) | context`
- `RuleChain.execute(initialContext) → object`
- `RuleChainLink.setNextLink(link)`, `RuleChainLink.run(context) → object`

### SkipLogic (`src/rules/skiplogic/skiplogic.js`)

Re-exports skip-logic DSL: `when`, `show`, `hide`, `contains`, `is`, `not`, `build`, `buildAndExport`.

### RuleRegistry (`src/rules/additional/RuleRegistry.js`)

Global registry indexed by (entityType, entityUUID, ruleType).
- `add(entityType, entityUUID, type, ruleData) → {entityType, entityUUID, type}`
- `getRulesFor(entityUUID, type, entityType='Form') → array`
- `getAll() → [[{entityType, entityUUID, type}, rules], ...]`

### ActionEligibilityResponse (`src/rules/model/ActionEligibilityResponse.js`)

- static `createAllowedResponse()`
- static `createDisallowedResponse(message)`
- static `createRuleResponse(ruleResponse)`
- `isAllowed() → boolean`, `isDisallowed() → boolean`, `getMessage() → string`

### lib (`src/rules/lib.js`)

Accessors called via `lib()`:
- `.log` — logger
- `.C` — common (constants, encounterTypes, addressLevels, states, concepts)
- `.calculations` → motherCalculations (obstetric utilities)
- `.models` → domain model classes

---

## Declarative IR (target emission format)

All in `src/rules/declarative/`. The Layer 3 compiler turns these JSON shapes into rule body strings.

### Action
```json
{ "actionType": "<one of>", "details": { /* per-type */ } }
```

Static enums:
- `Action.formElementActionTypes` = `{ ShowFormElement, HideFormElement, Value, SkipAnswers, ValidationError }`
- `Action.actionTypes` = formElementActionTypes ∪ `{ ShowFormElementGroup, HideFormElementGroup, ShowProgram, ShowEncounterType, HideProgram, HideEncounterType, FormValidationError, AddDecision, ScheduleVisit, ScheduleTask }`

### Condition
```json
{ "conjunction": "and" | "or", "compoundRule": CompoundRule }
```
`Condition.conjunctions = {And:'and', Or:'or'}`

### Rule (declarative atomic)
```json
{ "lhs": LHS, "operator": "<string>", "rhs": RHS }
```
- `Rule.codedOperators = { HasAnswer, HasAnyOneAnswer, HasAnswerOtherThan }`
- `Rule.numericOperators = { Equals, LessThan, LessThanOrEqualTo, GreaterThan, GreaterThanOrEqualTo }`
- `Rule.noRHSOperators = { Present, NotPresent }`

### LHS
```json
{
  "type": "concept" | "ageInYears" | "ageInMonths" | "ageInWeeks" | "ageInDays" | "gender" | "lowestAddressLevelType" | "lowestAddressLevel",
  "conceptName": "...",
  "conceptUuid": "...",
  "parentConceptUuid": "...",
  "conceptDataType": "Coded" | "Numeric" | "Date" | "DateTime" | "Text" | "Id" | ...,
  "scope": ConceptScope.scopes value,
  "encounterTypes": [...]
}
```
`LHS.types = { AgeInDays, AgeInWeeks, AgeInMonths, AgeInYears, Gender, LowestAddressLevelType, LowestAddressLevel, Concept }`

### RHS
```json
{
  "type": "answerConcept" | "value" | "concept",
  "value": <any>,
  "answerConceptNames": [...],
  "answerConceptUuids": [...],
  "conceptName": "...",
  "conceptUuid": "...",
  "scope": ConceptScope.scopes value
}
```
`RHS.types = { AnswerConcept, Value, Concept }`
`RHS.genderOptions = [{value:'Male',label:'Male'}, {value:'Female',label:'Female'}, {value:'Other',label:'Other'}]`

### ConceptScope
```
ConceptScope.scopes = {
  Registration, Enrolment, Encounter, EntireEnrolment,
  LatestInAllEncounters, LatestInPreviousEncounters,
  LastEncounter, LatestInEntireEnrolment,
  Exit, CancelEncounter, ChecklistItem
}
ConceptScope.scopeToRuleFunctionMap = {
  registration: 'valueInRegistration',
  encounter: 'valueInEncounter',
  enrolment: 'valueInEnrolment',
  exit: 'valueInExit',
  entireEnrolment: 'valueInEntireEnrolment',
  /* ...12 total */
}
```

### Action details classes

**ViewFilterActionDetails:**
```json
{ "value": <any>, "answersToSkip": [name], "answerUuidsToSkip": [uuid], "validationError": "..." }
```

**FormValidationActionDetails:**
```json
{ "validationError": "..." }
```

**AddDecisionActionDetails:**
```json
{ "scope": "registration"|"encounter"|"enrolment",
  "conceptName": "...", "conceptUuid": "...", "conceptDataType": "...", "value": <any> }
```
Static `formTypeToScopeMap`:
- `IndividualProfile` → `[registration]`
- `Encounter` → `[encounter, registration]`
- `ProgramEnrolment` → `[enrolment, registration]`
- `ProgramEncounter` → `[encounter, enrolment, registration]`
- (+3 more — total 7)

**VisitScheduleActionDetails:**
```json
{ "encounterType": "...", "encounterName": "...",
  "dateField": "...", "dateFieldUuid": "...",
  "daysToSchedule": <int>, "daysToOverdue": <int> }
```
Static `formTypeToDateFieldMap`:
- `Encounter` → `[encounterDateTime, earliestVisitDateTime, registrationDate]`
- `ProgramEncounter` → `[encounterDateTime, earliestVisitDateTime, enrolmentDateTime, registrationDate]`
- (+4 more — total 6)

**TaskScheduleActionDetails, CompoundRule, DeclarativeRule, DeclarativeRuleHolder, Util** — additional IR classes; see `src/rules/declarative/index.js`.

---

## Action taxonomy table

| action `value` | required `details` | appears in (rule field) |
|---|---|---|
| `showFormElement` | — | viewFilter (form element rule) |
| `hideFormElement` | — | viewFilter |
| `value` | `value` | viewFilter |
| `skipAnswers` | `answersToSkip`, `answerUuidsToSkip` | viewFilter |
| `validationError` | `validationError` | viewFilter |
| `showFormElementGroup` | — | decisionRule |
| `hideFormElementGroup` | — | decisionRule |
| `showProgram` | — | decisionRule |
| `hideProgram` | — | decisionRule |
| `showEncounterType` | — | decisionRule |
| `hideEncounterType` | — | decisionRule |
| `formValidationError` | `validationError` | validationRule |
| `addDecision` | `scope`, `conceptName`, `conceptUuid`, `conceptDataType`, `value` | decisionRule |
| `scheduleVisit` | `encounterType`, `encounterName`, `dateField`, `daysToSchedule`, `daysToOverdue` | visitScheduleRule |
| `scheduleTask` | (task-specific) | taskScheduleRule |

---

## Validator imports whitelist (Layer 4)

Rule bodies may reference identifiers from `imports.*`:
- `imports.rulesConfig.{RuleCondition, VisitScheduleBuilder, FormElementsStatusHelper, FormElementStatusBuilder, FormElementStatus, AdditionalComplicationsBuilder, complicationsBuilder, RuleChain, RuleChainLink, SkipLogic, RuleRegistry, ActionEligibilityResponse, lib}`
- `imports.common.*`
- `imports.motherCalculations.*`
- `imports.lodash` (full lodash)
- `imports.moment` (full moment)
- `imports.log`
- `imports.globalFn.*`

Plus `params.*` (per-rule-type entity shape — see `02-execution-context.md` once harvested).

External hard deps inside rule bodies: only `lodash`, `moment`. No `require()` or network.
