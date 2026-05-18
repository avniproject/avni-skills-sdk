import _ from 'lodash';
import {Action, DeclarativeRule} from "./index.js";
import {
    getDecisionRuleTemplate,
    getEligibilityRuleTemplate,
    getFormElementGroupRuleTemplate,
    getFormValidationErrorRuleTemplate,
    getViewFilterRuleTemplate, getVisitScheduleRuleTemplate
} from "./Util.js";

class DeclarativeRuleHolder {
    constructor(declarativeRules = []) {
        this.declarativeRules = declarativeRules;
    }

    static fromResource(declarativeRuleResources) {
        const declarativeRuleHolder = new DeclarativeRuleHolder();
        if (_.isEmpty(declarativeRuleResources)) {
            declarativeRuleHolder.declarativeRules.push(DeclarativeRule.getInitialState());
        } else {
            declarativeRuleHolder.declarativeRules = _.map(declarativeRuleResources, r => DeclarativeRule.fromResource(r))
        }
        return declarativeRuleHolder;
    }

    generateViewFilterRule(entityName) {
        const {ruleConditionArray, actionConditionArray} = this.getAllRuleConditions(entityName);
        const viewFilterRuleTemplate = getViewFilterRuleTemplate(entityName);
        return viewFilterRuleTemplate
            .replace('$RULE_CONDITIONS', ruleConditionArray.join('  '))
            .replace('$ACTION_CONDITIONS', actionConditionArray.join('  '));
    }

    generateFormElementGroupRule(entityName) {
        const {ruleConditionArray, actionConditionArray} = this.getAllRuleConditions(entityName);
        const formElementGroupRuleTemplate = getFormElementGroupRuleTemplate(entityName);
        return formElementGroupRuleTemplate
            .replace('$RULE_CONDITIONS', ruleConditionArray.join('  '))
            .replace('$ACTION_CONDITIONS', actionConditionArray.join('  '));
    }

    generateEligibilityRule() {
        const {ruleConditionArray, actionConditionArray} = this.getAllRuleConditions('individual', true);
        const eligibilityRuleTemplate = getEligibilityRuleTemplate();
        return eligibilityRuleTemplate
            .replace('$RULE_CONDITIONS', ruleConditionArray.join('  '))
            .replace('$ACTION_CONDITIONS', actionConditionArray.join('  '));
    }

    generateFormValidationRule(entityName) {
        const {ruleConditionArray, actionConditionArray} = this.getAllRuleConditions(entityName, true);
        const formValidationErrorRuleTemplate = getFormValidationErrorRuleTemplate(entityName);
        return formValidationErrorRuleTemplate
            .replace('$RULE_CONDITIONS', ruleConditionArray.join('  '))
            .replace('$ACTION_CONDITIONS', actionConditionArray.join('  '));
    }

    generateDecisionRule(entityName) {
        const {ruleConditionArray, actionConditionArray} = this.getAllRuleConditions(entityName, true);
        const decisionRuleTemplate = getDecisionRuleTemplate(entityName);
        return decisionRuleTemplate
            .replace('$RULE_CONDITIONS', ruleConditionArray.join('  '))
            .replace('$ACTION_CONDITIONS', actionConditionArray.join('  '));
    }

    generateVisitScheduleRule(entityName) {
        const {ruleConditionArray, actionConditionArray} = this.getAllRuleConditions(entityName, true);
        const visitScheduleRuleTemplate = getVisitScheduleRuleTemplate(entityName);
        return visitScheduleRuleTemplate
            .replace('$RULE_CONDITIONS', ruleConditionArray.join('  '))
            .replace('$ACTION_CONDITIONS', actionConditionArray.join('  '));
    }

    getAllRuleConditions(entityName, ignoreFormElementInContext) {
        const ruleConditionArray = [];
        const actionConditionArray = [];
        _.forEach(this.declarativeRules, (declarativeRule, index) => {
            const {ruleConditions, actionConditions} = declarativeRule.getRuleConditions(entityName, index + 1, ignoreFormElementInContext);
            ruleConditionArray.push(ruleConditions);
            actionConditionArray.push(actionConditions);
        });
        return {ruleConditionArray, actionConditionArray};
    }

    generateRuleSummary() {
        return this.isPartiallyEmpty() ? [] : _.map(this.declarativeRules, declarativeRule => declarativeRule.getRuleSummary())
    }

    isEmpty() {
        return _.isEmpty(_.reject(this.declarativeRules, declarativeRule => declarativeRule.isEmpty()));
    }

    isPartiallyEmpty() {
        return _.size(_.filter(this.declarativeRules, declarativeRule => declarativeRule.isEmpty())) > 0;
    }

    addEmptyDeclarativeRule() {
        const declarativeRuleHolder = new DeclarativeRuleHolder();
        declarativeRuleHolder.declarativeRules = [...this.declarativeRules, DeclarativeRule.getInitialState()];
        return declarativeRuleHolder;
    }

    deleteAtIndex(index) {
        if(_.size(this.declarativeRules) === 1) {
            return this.declarativeRules = DeclarativeRuleHolder.fromResource().declarativeRules;
        } else {
            this.declarativeRules.splice(index, 1);
        }
    }

    updateAtIndex(index, declarativeRule) {
        const declarativeRuleHolder = new DeclarativeRuleHolder();
        this.declarativeRules[index] = declarativeRule;
        declarativeRuleHolder.declarativeRules = this.declarativeRules;
        return declarativeRuleHolder;
    }

    clone() {
        const declarativeRuleHolder = new DeclarativeRuleHolder();
        declarativeRuleHolder.declarativeRules = _.map(this.declarativeRules, declarativeRule => declarativeRule.clone());
        return declarativeRuleHolder;
    }

    getDeclarativeRuleAtIndex(index) {
        return this.declarativeRules[index];
    }

    validate() {
        if (!this.isEmpty()) {
            _.forEach(this.declarativeRules, dr => dr.validate())
        }
    }

    validateAndGetError() {
        let errorMessage;
        try {
            this.validate()
        } catch (e) {
            errorMessage = e.message;
        }
        return errorMessage;
    }

    getApplicableViewFilterActions() {
        const viewFilterTypes = Action.formElementActionTypes;
        const showFE = viewFilterTypes.ShowFormElement;
        const hideFE = viewFilterTypes.HideFormElement;
        const isVisibilityDefined = _.some(this.declarativeRules, dr => dr.containActionType(showFE, hideFE));
        return isVisibilityDefined ? _.omitBy(viewFilterTypes, (v, k) => _.includes([showFE, hideFE], v)) : viewFilterTypes;
    }

    getApplicableFormElementGroupRuleActions() {
        const {ShowFormElementGroup, HideFormElementGroup} = Action.actionTypes;
        const isVisibilityDefined = _.some(this.declarativeRules, dr => dr.containActionType(ShowFormElementGroup, HideFormElementGroup));
        return isVisibilityDefined ? {} : {ShowFormElementGroup, HideFormElementGroup};
    }

    getApplicableEncounterEligibilityActions() {
        const {ShowEncounterType, HideEncounterType} = Action.actionTypes;
        const isDefined = _.some(this.declarativeRules, dr => dr.containActionType(ShowEncounterType, HideEncounterType));
        return isDefined ? {} : {ShowEncounterType, HideEncounterType};
    }

    getApplicableEnrolmentEligibilityActions() {
        const {ShowProgram, HideProgram} = Action.actionTypes;
        const isDefined = _.some(this.declarativeRules, dr => dr.containActionType(ShowProgram, HideProgram));
        return isDefined ? {} : {ShowProgram, HideProgram};
    }

    getApplicableFormValidationRuleActions() {
        return _.pick(Action.actionTypes, ['FormValidationError']);
    }

    getApplicableDecisionRuleActions() {
        return _.pick(Action.actionTypes, ['AddDecision']);
    }

    getApplicableVisitScheduleRuleActions() {
        return _.pick(Action.actionTypes, ['ScheduleVisit']);
    }

    getApplicableTaskScheduleRuleActions() {
        return _.pick(Action.actionTypes, ['ScheduleTask']);
    }
}


export default DeclarativeRuleHolder;
