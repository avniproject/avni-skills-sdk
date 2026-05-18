import {assertTrue} from "./Util.js";
import _ from "lodash";
import {
    VisitScheduleActionDetails,
    ViewFilterActionDetails,
    AddDecisionActionDetails,
    FormValidationActionDetails
} from "./index.js";
import TaskScheduleActionDetails from "./TaskScheduleActionDetails.js";

class Action {
    static formElementActionTypes = {
        'ShowFormElement': 'showFormElement',
        'HideFormElement': 'hideFormElement',
        'Value': 'value',
        'SkipAnswers': 'skipAnswers',
        'ValidationError': 'validationError',
    };

    static actionTypes = {
        ...Action.formElementActionTypes,
        'ShowFormElementGroup': 'showFormElementGroup',
        'HideFormElementGroup': 'hideFormElementGroup',
        'ShowProgram': 'showProgram',
        'ShowEncounterType': 'showEncounterType',
        'HideProgram': 'hideProgram',
        'HideEncounterType': 'hideEncounterType',
        'FormValidationError': 'formValidationError',
        'AddDecision': 'addDecision',
        'ScheduleVisit': 'scheduleVisit',
        'ScheduleTask': 'scheduleTask'
    };

    constructor() {
    }

    static fromResource(json) {
        const action = new Action();
        action.actionType = json.actionType;
        const viewFilterActionTypes = ['value', 'skipAnswers', 'validationError'];
        const actionDetails = _.get(json, 'details', {});
        if (_.includes(viewFilterActionTypes, json.actionType)) {
            action.details = ViewFilterActionDetails.fromResource(actionDetails);
        } else if (json.actionType === Action.actionTypes.FormValidationError) {
            action.details = FormValidationActionDetails.fromResource(actionDetails);
        } else if (json.actionType === Action.actionTypes.AddDecision) {
            action.details = AddDecisionActionDetails.fromResource(actionDetails);
        } else if (json.actionType === Action.actionTypes.ScheduleVisit) {
            action.details = VisitScheduleActionDetails.fromResource(actionDetails);
        } else if (json.actionType === Action.actionTypes.ScheduleTask) {
            action.details = TaskScheduleActionDetails.fromResource(actionDetails);
        }
        return action;
    }

    setActionType(actionType) {
        const actionTypes = _.values(Action.actionTypes);
        if (!_.isNil(actionType))
            assertTrue(_.includes(actionTypes, actionType), `Action type must be one of the ${actionTypes}`);
        this.actionType = actionType;
        if (this.isViewFilterWithDetailsAction()) {
            this.details = new ViewFilterActionDetails();
        } else if (this.isFormValidationAction()) {
            this.details = new FormValidationActionDetails();
        } else if (this.isAddDecisionAction()) {
            this.details = new AddDecisionActionDetails();
        } else if (this.isVisitScheduleAction()) {
            this.details = new VisitScheduleActionDetails();
        }
    }

    addDetails(detailName, value) {
        this.details[detailName] = value;
    }

    isViewFilterWithDetailsAction() {
        const viewFilterActionTypes = ['value', 'skipAnswers', 'validationError'];
        return _.includes(viewFilterActionTypes, this.actionType);
    }

    isFormValidationAction() {
        return this.actionType === Action.actionTypes.FormValidationError;
    }

    isAddDecisionAction() {
        return this.actionType === Action.actionTypes.AddDecision;
    }

    isVisitScheduleAction() {
        return this.actionType === Action.actionTypes.ScheduleVisit;
    }

    clone() {
        const action = new Action();
        action.actionType = this.actionType;
        if (this.details) {
            action.details = this.details.clone();
        }
        return action;
    }

    getJsValue() {
        const value = _.get(this.details, 'value');
        return typeof value === 'number' ? value : `"${value}"`
    }

    getJsAnswersToSkip() {
        const answerToSkip = _.get(this.details, 'answersToSkip');
        return _.map(answerToSkip, ac => `"${ac}"`).toString();
    }

    getJsAnswerUUIDsToSkip() {
        const answerUuidsToSkip = _.get(this.details, 'answerUuidsToSkip');
        return _.map(answerUuidsToSkip, ac => `"${ac}"`).toString();
    }

    getRuleSummary() {
        switch (this.actionType) {
            case Action.actionTypes.Value:
                return `Display value ${this.details.value}.`;
            case Action.actionTypes.SkipAnswers:
                return `Hide answers ${this.getJsAnswersToSkip()}.`;
            case Action.actionTypes.ValidationError:
            case Action.actionTypes.FormValidationError:
                const validationError = this.details.validationError?.replaceAll(/'|"/g, "\'")
                return `Raise error ${validationError}.`;
            case Action.actionTypes.AddDecision:
                return `Add Decision "${this.details.conceptName} : ${this.details.getSummaryValue()}" in ${_.startCase(this.details.scope)}`;
            case Action.actionTypes.ScheduleVisit:
                return `Schedule visit "${this.details.encounterName}" using "${_.startCase(this.details.dateField)}" on (${_.startCase(this.details.dateField)} + ${this.details.daysToSchedule} days)`;
            default:
                return `${_.startCase(this.actionType)}.`;
        }
    }

    validate() {
        assertTrue(!_.isNil(this.actionType), "Type in Action cannot be empty");
        if (this.isAddDecisionAction() || this.isFormValidationAction() || this.isViewFilterWithDetailsAction() || this.isVisitScheduleAction()) {
            this.details.validate(this.actionType);
        }
    }

}

export default Action;
