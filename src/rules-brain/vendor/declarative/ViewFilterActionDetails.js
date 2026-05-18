import {assertTrue} from "./Util.js";
import _ from "lodash";
import Action from './Action.js';

class ViewFilterActionDetails {
    constructor() {
    }

    static fromResource(json) {
        const actionDetails = new ViewFilterActionDetails();
        actionDetails.value = json.value;
        actionDetails.answersToSkip = json.answersToSkip;
        actionDetails.answerUuidsToSkip = json.answerUuidsToSkip;
        actionDetails.validationError = json.validationError;
        return actionDetails;
    }

    setValue(value) {
        this.value = value;
    }

    setAnswersToSkip(...value) {
        this.answersToSkip = [...value];
    }

    setAnswerUUIDsToSkip(...value) {
        this.answerUuidsToSkip = [...value];
    }

    setValidationError(error) {
        this.validationError = error;
    }

    clone() {
        const details = new ViewFilterActionDetails();
        details.value = this.value;
        details.answersToSkip = this.answersToSkip;
        details.answerUuidsToSkip = this.answerUuidsToSkip;
        details.validationError = this.validationError;
        return details;
    }

    validate(actionType) {
        if (_.isEqual(actionType, Action.actionTypes.Value))
            assertTrue(!_.isEmpty(this.value), "Value in Action cannot be empty");
        if (_.isEqual(actionType, Action.actionTypes.ValidationError))
            assertTrue(!_.isEmpty(this.validationError), "Validation error in Action cannot be empty");
        if (_.isEqual(actionType, Action.actionTypes.SkipAnswers)) {
            assertTrue(!_.isEmpty(this.answersToSkip), "Concept answers in Action cannot be empty");
            assertTrue(!_.isEmpty(this.answerUuidsToSkip), "Concept answer uuids in cannot be empty");
        }
    }

}

export default ViewFilterActionDetails
