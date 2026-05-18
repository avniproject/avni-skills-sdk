import {assertTrue} from "./Util.js";
import _ from "lodash";

class AddDecisionActionDetails {

    static formTypeToScopeMap = {
        IndividualProfile: ['registration'],
        IndividualEncounterCancellation: ['encounter', 'registration'],
        Encounter: ['encounter', 'registration'],
        ProgramEnrolment: ['enrolment', 'registration'],
        ProgramExit: ['enrolment', 'registration'],
        ProgramEncounter: ['encounter', 'enrolment', 'registration'],
        ProgramEncounterCancellation: ['encounter', 'enrolment', 'registration']
    };

    constructor() {
    }

    static fromResource(json) {
        const actionDetails = new AddDecisionActionDetails();
        actionDetails.scope = json.scope;
        actionDetails.conceptName = json.conceptName;
        actionDetails.conceptUuid = json.conceptUuid;
        actionDetails.conceptDataType = json.conceptDataType;
        actionDetails.value = json.value;
        return actionDetails;
    }

    getDecisionScope(formType) {
        return AddDecisionActionDetails.formTypeToScopeMap[formType] || [];
    }

    setScope(scope) {
        this.scope = scope;
    }

    setConceptName(conceptName) {
        this.conceptName = conceptName;
    }

    setConceptUuid(conceptUuid) {
        this.conceptUuid = conceptUuid
    }

    setConceptDataType(dataType) {
        this.conceptDataType = dataType;
    }

    setValue(value) {
        this.value = value;
    }

    clone() {
        const details = new AddDecisionActionDetails();
        details.scope = this.scope;
        details.conceptName = this.conceptName;
        details.conceptUuid = this.conceptUuid;
        details.conceptDataType = this.conceptDataType;
        details.value = this.value;
        return details;
    }


    validate() {
        assertTrue(!_.isEmpty(this.scope), "Decision scope cannot be empty");
        assertTrue(!_.isEmpty(this.conceptName), "Decision concept name cannot be empty");
        assertTrue(!_.isEmpty(this.value), "Decision value cannot be empty");
    }

    getJsValue() {
        return this.conceptDataType === 'Coded' ? `[${_.map(this.value, v => `"${v}"`).toString()}]` : `"${this.value}"`;
    }

    getSummaryValue() {
        return this.conceptDataType === 'Coded' ? `${_.map(this.value, v => `"${v}"`).toString()}` : this.value;
    }

}

export default AddDecisionActionDetails;
