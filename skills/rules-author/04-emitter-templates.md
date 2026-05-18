# IR→JS Emitter Templates (verbatim from rules-config)

Source: `/Users/samanvay/Downloads/All/avni-ai/rules-config-master/src/rules/declarative/Util.js`

The canonical IR→JS compiler is **`DeclarativeRuleHolder.generate*Rule(entityName)`** in rules-config. Each method:
1. Walks the IR to produce `ruleConditionArray` and `actionConditionArray` (snippets of JS)
2. Picks one of the 6 templates below by rule type
3. String-replaces `$RULE_CONDITIONS` and `$ACTION_CONDITIONS`
4. Returns the JS rule body string

We DO NOT reimplement this. We vendor the IR classes + `DeclarativeRuleHolder` and call `.generate*Rule(entityName)`.

## The 6 templates

### View Filter (form-element rule)
```js
'use strict';
({params, imports}) => {
  const ${entityName} = params.entity;
  const moment = imports.moment;
  const formElement = params.formElement;
  const _ = imports.lodash;
  let visibility = true;
  let value = null;
  let answersToSkip = [];
  let validationErrors = [];
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, value, answersToSkip, validationErrors);
};
```
Emitter: `generateViewFilterRule(entityName)`

### Form Element Group rule
```js
'use strict';
({params, imports}) => {
    const ${entityName} = params.entity;
    const moment = imports.moment;
    const formElementGroup = params.formElementGroup;
    const _ = imports.lodash;
    let visibility = true;
    return formElementGroup.formElements.map((formElement) => {
        $RULE_CONDITIONS
        $ACTION_CONDITIONS
        return new imports.rulesConfig.FormElementStatus(formElement.uuid, visibility, null);
    });
};
```
Emitter: `generateFormElementGroupRule(entityName)`

### Eligibility rule (encounter / enrolment eligibility)
```js
'use strict';
({params, imports}) => {
  const individual = params.entity;
  const moment = imports.moment;
  let eligibility = true;
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return eligibility;
};
```
Emitter: `generateEligibilityRule()` (hardcodes `individual` — params.entity is always Individual for eligibility)

### Form validation rule
```js
'use strict';
({params, imports}) => {
  const ${entityName} = params.entity;
  const moment = imports.moment;
  const validationResults = [];
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return validationResults;
};
```
Emitter: `generateFormValidationRule(entityName)`

### Decision rule
```js
"use strict";
({params, imports}) => {
    const ${entityName} = params.entity;
    const moment = imports.moment;
    const decisions = params.decisions;
    const enrolmentDecisions = [];
    const encounterDecisions = [];
    const registrationDecisions = [];
    $RULE_CONDITIONS
    $ACTION_CONDITIONS
    decisions.enrolmentDecisions.push(...enrolmentDecisions);
    decisions.encounterDecisions.push(...encounterDecisions);
    decisions.registrationDecisions.push(...registrationDecisions);
    return decisions;
};
```
Emitter: `generateDecisionRule(entityName)`

### Visit Schedule rule
```js
"use strict";
({ params, imports }) => {
  const ${entityName} = params.entity;
  const moment = imports.moment;
  const scheduleBuilder = new imports.rulesConfig.VisitScheduleBuilder({${entityName}});
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return scheduleBuilder.getAll();
};
```
Emitter: `generateVisitScheduleRule(entityName)`

## Rule field → emitter mapping

| Bundle JSON field | Carrier entity | Emitter method | `entityName` arg |
|---|---|---|---|
| `forms/*.json` `formElements[].rule` (legacy) | form element | `generateViewFilterRule` | `programEncounter` \| `encounter` \| `individual` |
| `forms/*.json` `decisionRule` | form | `generateDecisionRule` | `programEncounter` \| `encounter` \| `individual` |
| `forms/*.json` `validationRule` | form | `generateFormValidationRule` | same |
| `forms/*.json` `visitScheduleRule` | form | `generateVisitScheduleRule` | `programEncounter` \| `encounter` |
| `forms/*.json` `checklistsRule` | form | (no IR template; pure JS) | — |
| `forms/*.json` `editFormRule` | form | (no IR template; pure JS) | — |
| `encounterTypes.json` `encounterEligibilityCheckRule` | encounterType | `generateEligibilityRule` | (`individual` hardcoded) |
| `programs.json` `enrolmentEligibilityCheckRule` | program | `generateEligibilityRule` | (`individual` hardcoded) |
| `programs.json` `manualEnrolmentEligibilityCheckRule` | program | `generateEligibilityRule` | (`individual` hardcoded) |
| `programs.json` `enrolmentSummaryRule` | program | (no IR template; pure JS) | — |
| `subjectTypes.json` `subjectSummaryRule` | subjectType | (no IR template; pure JS) | — |
| `organisationConfig.json` `worklistUpdationRule` | orgConfig | (no IR template; pure JS) | — |

## Implications

- **6 of the 12 rule fields** are fully IR-able — Layer 1 (deterministic) + Layer 3 (canonical compiler) covers them.
- **6 of the 12 are free-form JS** — checklistsRule, editFormRule, enrolmentSummaryRule, subjectSummaryRule, worklistUpdationRule, messagingRule. These need Layer 2 (agent) + Layer 4 (validator).
- The 6 IR-able rules cover ~85% of corpus volume (165 of 195 top-level rules in the harvest).

## Compiler entry point (from rules-config)

```js
import { DeclarativeRuleHolder } from "rules-config";

const holder = DeclarativeRuleHolder.fromResource(declarativeRuleJsonArray);
if (holder.isEmpty()) { /* skip */ }
const err = holder.validateAndGetError();
if (err) { throw new Error(err); }

const js = holder.generateDecisionRule("programEncounter");
// → "use strict";\n({params, imports}) => { ... }
```

`declarativeRuleJsonArray` is an array of `DeclarativeRule` JSON shapes. Each rule has `conditions[]` and `actions[]`.
