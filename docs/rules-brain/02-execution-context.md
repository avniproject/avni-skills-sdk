# Rule Execution Context (harvested)

Source: `/Users/samanvay/Downloads/All/avni-ai/rules-server-master/`, `avni-server-master/`, `avni-models-master/`
Harvested: 2026-05-11

This is what's available **at runtime** when a rule body executes. Determines what the rules brain may safely emit.

---

## Execution flow

1. **Spring fetches rule code from DB**
   - `avni-server-api/src/main/java/org/avni/server/service/RuleService.java:280-282`
   - `rule.setDecisionCode(form.getDecisionRule())`, `setVisitScheduleCode(...)`, `setChecklistCode(...)`
2. **Spring posts to Node rules-server**
   - `RuleService.java:327`: `createHttpHeaderAndSendRequest("/api/rules", entity, ruleFailureLog, RuleResponseEntity.class)`
   - `RuleService.java:366-383`: marshals entity → JSON → `restClient.post(...)`
3. **Node rules-server evaluates**
   - **decisionRule / visitScheduleRule / checklistsRule**: `rules-server-master/src/services/evalRule.js:15-17`
     ```js
     const evalRule = (code) => safeEval(code, context);
     ```
     Uses `safe-eval@0.4.1`.
   - **eligibilityRule / messagingRule**: `rules-server-master/src/services/RuleEvalService.js:132,148`
     ```js
     const ruleFunc = eval(code);   // ⚠ raw eval, not safe-eval
     ```
4. **Response** — HTTP 222 on failure with `{status:"failure", error:{message, stack}}`; logged to `RuleFailureLog` table.

---

## Globals available inside the rule body

Rule wrapper shape is canonical: `({params, imports}) => { ... }`.

`imports` (confirmed from `RuleEvalService.js:28-30` `getImports()`):
- `rulesConfig` — full `rules-config` package (every class in 01-rules-config-api.md)
- `common` — `avni-health-modules/common`
- `lodash` — full lodash
- `moment` — full moment
- `motherCalculations` — `avni-health-modules/motherCalculations` (obstetric helpers)
- `log: console.log`

⚠ **Discrepancy from avni-skills SKILL docs**: BUNDLE_CONFIG_GUIDE.md lists `globalFn`. RuleEvalService.js does NOT inject it. Treat `globalFn` as **not portable** — rules-author SKILL must omit it.

`safe-eval` additional context (`evalRule.js:6-13`):
- `console`
- `_` (lodash alias)
- `ruleServiceLibraryInterfaceForSharingModules: { log, common, motherCalculations, models }`

---

## `params.entity` per rule type

| Rule type | `params.entity` | Source mapper |
|---|---|---|
| `decisionRule` (form-level) | `ProgramEncounter` or `Encounter` | `rules-server/src/models/{programEncounterModel,encounterModel}.js` |
| `visitScheduleRule` | same; plus `params.visitSchedule` (array of {maxDate, earliestDate}) | same |
| `checklistsRule` | same; plus `params.checklistDetails` | same |
| `enrolmentSummaryRule` (a.k.a. `programSummaryRule`) | `ProgramEnrolment` | `programEnrolmentModel.js` |
| `subjectSummaryRule` | `Individual` | `individualModel.js` |
| `enrolmentEligibilityCheckRule` | `Individual` (returns `true|false`) | uses raw `eval()` |
| `encounterEligibilityCheckRule` | `Individual` (returns `true|false`) | uses raw `eval()` |
| `worklistUpdationRule` | (TODO — not confirmed in this harvest) | — |
| `messagingRule` | mapped CHSEntity; returns `{sms?, whatsapp?, ...}` | uses raw `eval()` |

### Entity methods commonly used inside rules

**Individual** (`avni-models-master/src/Individual.js`):
- `entity.uuid`, `entity.firstName`, `entity.lastName`, `entity.dateOfBirth`, `entity.registrationDate`
- `entity.gender` → `{name, uuid}`
- `entity.lowestAddressLevel`
- `entity.observations` — `ObservationCollection.findObservation(conceptUuid|name)`
- `entity.encounters` — `[Encounter]`
- `entity.enrolments` — `[ProgramEnrolment]`

**ProgramEnrolment** (`ProgramEnrolment.js`):
- `entity.uuid`, `entity.voided`, `entity.enrolmentDateTime`, `entity.programExitDateTime`
- `entity.observations`, `entity.programExitObservations`
- `entity.individual` (mapped Individual)
- `entity.encounters` — `[ProgramEncounter]`

**ProgramEncounter / Encounter**:
- `entity.uuid`, `entity.name`, `entity.voided`
- `entity.encounterDateTime`, `entity.earliestVisitDateTime`, `entity.maxVisitDateTime`
- `entity.observations` (ObservationCollection)
- `entity.individual` (mapped Individual)
- For ProgramEncounter: `entity.programEnrolment` (mapped)

---

## Hard constraints — what rules CANNOT do

| Capability | Status | Why |
|---|---|---|
| `require()` / `import` | ❌ Stripped by safe-eval; sandbox isolation for raw eval | |
| `fetch` / HTTP / DB | ❌ Not injected into context | |
| File I/O (`fs`) | ❌ Same | |
| Mutate `lodash` / `moment` | ⚠ Technically possible — references shared across rule invocations | NOT enforced; emit-side must avoid |
| Infinite loop / timeout | ⚠ **No timeout set in rules-server**. Heap default ~1.4 GB | Layer 4 validator should at least bound `for`/`while` depth |
| Network sandbox | ❌ No external sandbox; relies on safe-eval's restrictions | |
| Access other rule outputs | ❌ Each rule invocation is isolated | |

---

## Validator implications (Layer 4)

The static validator (`avni-skills-sdk/src/rules-brain/validate.js` once built) must:

1. **Parse** the rule body with acorn — reject syntax errors.
2. **Whitelist identifiers**: only `params`, `imports`, plus standard JS globals (`Math`, `Date`, `Object`, `Array`, `Number`, `String`, `Boolean`, `Map`, `Set`, `Symbol`, `JSON`). Reject `require`, `process`, `global`, `globalThis`, `eval`, `Function`, `fetch`, `XMLHttpRequest`, `import`.
3. **Check `imports.X` access**: only `imports.{rulesConfig, common, lodash, moment, motherCalculations, log}`. Reject `imports.globalFn` (not portable).
4. **For `imports.rulesConfig.X`**: only the 13 classes listed in 01-rules-config-api.md.
5. **Concept-UUID liveness**: every string matching `[0-9a-f]{8}-[0-9a-f]{4}-...` should resolve to a UUID in `concepts.json` (else: invented).
6. **Loop depth heuristic** (optional): warn on nested `while`/`for` deeper than 2 — possible runaway.
7. **Return value smoke-check**: depending on rule type, body must return appropriate shape (visitSchedule = array, eligibility = boolean, decision = object).

---

## Wrapper format

`({params, imports}) => { ... return X; }`

Confirmed in:
- `rules-config-master/src/rules/builder/VisitScheduleBuilder.js` examples
- `rules-server-master/src/services/RuleEvalService.js:120-160` invocations

Older bundles MAY use `function(params, imports) {...}` — Layer 3 compiler must emit the modern arrow form; Layer 4 validator must accept both for backwards compatibility.
