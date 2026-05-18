import {assertTrue} from "./Util.js";
import _ from "lodash";

class VisitScheduleActionDetails {
    static formTypeToDateFieldMap = {
        IndividualProfile: ['registrationDate'],
        IndividualEncounterCancellation: ['cancelDateTime', 'earliestVisitDateTime', 'registrationDate'],
        Encounter: ['encounterDateTime', 'earliestVisitDateTime', 'registrationDate'],
        ProgramEnrolment: ['enrolmentDateTime', 'registrationDate'],
        ProgramExit: ['programExitDateTime', 'registrationDate'],
        ProgramEncounter: ['encounterDateTime', 'earliestVisitDateTime', 'enrolmentDateTime', 'registrationDate'],
        ProgramEncounterCancellation: ['cancelDateTime', 'earliestVisitDateTime', 'enrolmentDateTime', 'registrationDate']
    };

    constructor() {
    }

    static fromResource(json) {
        const actionDetails = new VisitScheduleActionDetails();
        actionDetails.encounterType = json.encounterType;
        actionDetails.encounterName = json.encounterName;
        actionDetails.dateField = json.dateField;
        actionDetails.dateFieldUuid = json.dateFieldUuid;
        actionDetails.daysToSchedule = json.daysToSchedule;
        actionDetails.daysToOverdue = json.daysToOverdue;
        return actionDetails;
    }

    static getDateFieldOptions(form) {
        const staticOptionsForForm = VisitScheduleActionDetails.formTypeToDateFieldMap[form.formType];
        const staticOptions = _.map(staticOptionsForForm, f => ({
            label: _.startCase(f),
            value: {dateField: f, dateFieldUuid: undefined, toString: () => f}
        }));
        const conceptOptions = [];
        _.forEach(form.formElementGroups, ({formElements}) => {
            _.forEach(formElements, ({concept}) => {
                if (_.includes(['Date', 'DateTime'], concept.dataType)) {
                    conceptOptions.push({
                        label: _.startCase(concept.name),
                        value: {dateField: concept.name, dateFieldUuid: concept.uuid, toString: () => concept.name}
                    });
                }
            })
        });
        return [...staticOptions, ...conceptOptions]
    }

    static buildVisitScheduleAction(actionDetails, entityName) {
        const getDateFieldPath = () => {
            switch (entityName) {
                case 'individual':
                    return `individual.registrationDate`;
                case 'encounter':
                    return actionDetails.dateField === 'registrationDate' ? `encounter.individual.registrationDate` : `encounter.${actionDetails.dateField}`;
                case 'programEnrolment':
                    return actionDetails.dateField === 'registrationDate' ? `programEnrolment.individual.registrationDate` : `programEnrolment.${actionDetails.dateField}`;
                case 'programEncounter':
                    return actionDetails.dateField === 'enrolmentDateTime' ? `programEncounter.programEnrolment.enrolmentDateTime` : (actionDetails.dateField === 'registrationDate' ? `programEncounter.programEnrolment.individual.registrationDate` : `programEncounter.${actionDetails.dateField}`);
            }
        };
        const dateToConsider = !_.isEmpty(actionDetails.dateFieldUuid) ? `${entityName}.getObservationReadableValue('${actionDetails.dateFieldUuid}')` : getDateFieldPath();
        return `const earliestDate = moment(${dateToConsider}).add(${actionDetails.daysToSchedule}, 'days').toDate();\n    `
            .concat(`const maxDate = moment(${dateToConsider}).add(${actionDetails.daysToOverdue}, 'days').toDate();\n    `)
            .concat(`scheduleBuilder.add({name: "${actionDetails.encounterName}", encounterType: "${actionDetails.encounterType}", earliestDate, maxDate});`)
    }

    clone() {
        const details = new VisitScheduleActionDetails();
        details.encounterType = this.encounterType;
        details.encounterName = this.encounterName;
        details.dateField = this.dateField;
        details.dateFieldUuid = this.dateFieldUuid;
        details.daysToSchedule = this.daysToSchedule;
        details.daysToOverdue = this.daysToOverdue;
        return details;
    }

    validate() {
        assertTrue(!_.isEmpty(this.encounterType), "Visit schedule encounter type cannot be empty");
        assertTrue(!_.isEmpty(this.encounterName), "Visit schedule encounter name cannot be empty");
        assertTrue(!_.isEmpty(this.dateField), "Visit schedule date field cannot be empty");
        assertTrue(!_.isEmpty(this.daysToSchedule), "Visit schedule days to schedule cannot be empty");
        assertTrue(!_.isEmpty(this.daysToOverdue), "Visit schedule days to overdue cannot be empty");
    }

}


export default VisitScheduleActionDetails;
