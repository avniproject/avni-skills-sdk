# Real-World Rule Corpus (harvested)

Source: `/Users/samanvay/Downloads/All/avni-ai/avni-impl-bundles-main/reference/` (5 production bundles: Ashwini, APFOdisha, CSJ, RWB, Goonj)
Harvested: 2026-05-11

## Volume by rule type

| Rule type | Non-empty | Distinct bundles |
|---|---|---|
| validationRule | 64 | 5+ |
| decisionRule | 63 | 5+ |
| visitScheduleRule | 39 | 3+ |
| enrolmentSummaryRule | 13 | 2 |
| subjectSummaryRule | 11 | 2 |
| enrolmentEligibilityCheckRule | 7 | 1 |
| worklistUpdationRule | 3 | 2 |
| checklistsRule | 2 | 1 |
| editFormRule | 1 | 1 |
| **formElement.rule** | **1,745+** | **5+** |

Total: 195 top-level + 1,745+ element-level rules. **100% use arrow form** `({params, imports}) => { ... }`. No legacy `function(params, imports)` body found.

## Top APIs by frequency

| API | Count | Use site |
|---|---|---|
| `imports.common.createValidationError(uuid, msg)` | 130+ | validationRule |
| `new imports.rulesConfig.VisitScheduleBuilder({programEncounter})` | 39+ | visitScheduleRule |
| `imports.moment(...)` | 100+ | every rule type |
| `new imports.rulesConfig.RuleCondition(...)` | 29+ | decisionRule, visitScheduleRule |
| `imports.models.WorkItem` | 3+ | worklistUpdationRule |

## Canonical patterns

### validationRule — typical body shape
```js
'use strict';
({params, imports}) => {
  const entity = params.entity;
  const validationResults = [];
  // checks…
  if (badCondition) {
    validationResults.push(imports.common.createValidationError(
      "<conceptUuid>", "human-readable message"
    ));
  }
  return validationResults;
};
```

### visitScheduleRule — typical body shape
```js
"use strict";
({params, imports}) => {
  const programEncounter = params.entity;
  const builder = new imports.rulesConfig.VisitScheduleBuilder({programEncounter});
  builder.add({
    name: "Visit Name",
    encounterType: "Type Name",
    earliestDate: imports.moment(encounterDate).add(N, 'days').toDate(),
    maxDate: imports.moment(encounterDate).add(N+grace, 'days').toDate()
  });
  return builder.getAll();
};
```

### decisionRule — typical body shape
```js
"use strict";
({params, imports}) => {
  const entity = params.entity;
  const decisions = params.decisions;
  const localList = [];
  // computation…
  localList.push({name: "Concept Name", value: computed});
  decisions.<registrationDecisions|enrolmentDecisions|encounterDecisions>.push(...localList);
  return decisions;
};
```

### worklistUpdationRule — typical body shape
```js
({params, imports}) => {
  const workLists = params.workLists;
  const WorkItem = imports.models.WorkItem;
  const entity = params.context.entity;
  if (entity?.uuid) {
    workLists.addWorkItem(new WorkItem({uuid: entity.uuid, type: entity.type, entity}));
  }
};
```

## Failure patterns observed (input to Layer 4 validator)

| Failure mode | Frequency | What to check |
|---|---|---|
| Hardcoded conceptUuids in body | 23+ files | Every UUID must exist in concepts.json |
| `createValidationError` called without formElement context | several | Signature check |
| Service calls without null-guard (`params.services.X.method()`) | many | Defensive default emission |
| Direct assignment to `params.decisions.X = [...]` instead of push | rare | AST scan |
| Stringly-typed comparisons to observation values | many | Prefer concept lookup |

## Required validator passes (Layer 4)

Based on the corpus, every rule body must:

1. **Parse** as ES2020 (arrow form, `'use strict'` allowed but optional).
2. **Reference whitelisted identifiers only**: `params`, `imports`, JS standard globals. Reject `require`, `process`, `global`, `eval`, `Function`, `fetch`.
3. **Concept UUIDs resolve**: every UUID-shaped string literal (`[0-9a-f]{8}-[0-9a-f]{4}-...`) appears in `concepts.json`.
4. **Imports paths are real**: only `imports.{rulesConfig,common,lodash,moment,motherCalculations,log,models}`. Reject `imports.globalFn`.
5. **rulesConfig classes are real**: `imports.rulesConfig.X` where X is in the 13-class allowlist (01-rules-config-api.md).
6. **Return shape matches rule type**:
   - validationRule → `Array` of validation errors
   - visitScheduleRule → `Array` of schedules (from `.getAll()`)
   - decisionRule → `Object` with at least one of {registration,enrolment,encounter}Decisions
   - eligibilityCheckRule → `Boolean` or `{value:Boolean, message?}` per `ActionEligibilityResponse`
   - summaryRule → `Array` of {name,value}
