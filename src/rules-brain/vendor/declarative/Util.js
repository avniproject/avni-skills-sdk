export const assertTrue = (value, message) => {
    if (!value) {
        throw new Error(message);
    }
};

export const getViewFilterRuleTemplate = (entityName) =>
`'use strict';
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
};`;

export const getFormElementGroupRuleTemplate = (entityName) =>
`'use strict';
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
};`;

export const getEligibilityRuleTemplate = () =>
`'use strict';
({params, imports}) => {
  const individual = params.entity;
  const moment = imports.moment;
  let eligibility = true;
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return eligibility;
};`;

export const getFormValidationErrorRuleTemplate = (entityName) =>
`'use strict';
({params, imports}) => {
  const ${entityName} = params.entity;
  const moment = imports.moment;
  const validationResults = [];
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return validationResults;
};`;

export const getDecisionRuleTemplate = (entityName) =>
`"use strict";
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
};`;


export const getVisitScheduleRuleTemplate = (entityName) =>
`"use strict";
({ params, imports }) => {
  const ${entityName} = params.entity;
  const moment = imports.moment;
  const scheduleBuilder = new imports.rulesConfig.VisitScheduleBuilder({${entityName}});
  $RULE_CONDITIONS
  $ACTION_CONDITIONS
  return scheduleBuilder.getAll();
};`;
