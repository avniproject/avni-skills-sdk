import _ from "lodash";
import {assertTrue} from "./Util.js";
import ConceptScope from "./ConceptScope.js";

class RHS {
    static types = {
        'AnswerConcept': 'answerConcept',
        'Value': 'value',
        'Concept': 'concept',
    };

    static genderOptions = [
        {value: 'Male', label: 'Male'},
        {value: 'Female', label: 'Female'},
        {value: 'Other', label: 'Other'},
    ];

    constructor() {
    }

    static fromResource(json) {
        const rhs = new RHS();
        rhs.type = json.type;
        rhs.value = json.value;
        rhs.answerConceptNames = json.answerConceptNames;
        rhs.answerConceptUuids = json.answerConceptUuids;
        rhs.conceptName = json.conceptName;
        rhs.conceptUuid = json.conceptUuid;
        rhs.scope = json.scope;
        return rhs;
    }

    setType(type) {
        const types = _.values(RHS.types);
        assertTrue(_.includes(types, type), `Types must be one of the ${types}`);
        this.type = type;
    }

    setAnswerConceptNames(...answerConceptNames) {
        this.answerConceptNames = answerConceptNames;
    }

    setAnswerConceptUuids(...answerConceptUuids) {
        this.answerConceptUuids = answerConceptUuids;
    }

    setValue(value) {
        assertTrue(this.type === RHS.types.Value, `Type must be ${RHS.types.Value}`);
        this.value = value;
    }

    getRuleCondition() {
        switch (this.type) {
            case RHS.types.AnswerConcept :
                return this.getJSConceptAnswerUUIDs();
            case RHS.types.Value :
                return this.getJSValue();
            case RHS.types.Concept:
                return `${_.camelCase(this.conceptName)}Value`;
            default:
                return '';
        }
    }

    getScopeCode(entityName) {
        if (!this.isConceptType()) return '';
        const getEntityPathBasedOnScope = () => {
            const scopes = ConceptScope.scopes;
            switch (entityName) {
                case 'individual':
                    return `individual`;
                case 'encounter':
                    return this.scope === scopes.Registration ? 'encounter.individual' : 'encounter';
                case 'programEnrolment':
                    return this.scope === scopes.Registration ? 'programEnrolment.individual' : 'programEnrolment';
                case 'programEncounter':
                    return this.scope === scopes.Enrolment ? 'programEncounter.programEnrolment' : (this.scope === scopes.Registration ? 'programEncounter.programEnrolment.individual' : 'programEncounter');
            }
        };
        const getSecondParam = () => ConceptScope.isCurrentEncounterRequired(this.scope) ? `, ${entityName}` : '';
        const entityPath = getEntityPathBasedOnScope();
        return `let ${_.camelCase(this.conceptName)}Observation = ${entityPath}.${ConceptScope.scopeToObservationFunctionMap[this.scope]}('${this.conceptUuid}'${getSecondParam()});\n  ` +
            `let ${_.camelCase(this.conceptName)}Value = _.isEmpty(${_.camelCase(this.conceptName)}Observation) ? ${_.camelCase(this.conceptName)}Observation : ${_.camelCase(this.conceptName)}Observation.getReadableValue();`
    }

    getJSValue() {
        return typeof this.value === 'number' ? this.value : `"${this.value}"`;
    }

    getJSConceptAnswerNames() {
        return _.map(this.answerConceptNames, ac => `"${ac}"`).toString();
    }

    getJSConceptAnswerUUIDs() {
        return _.map(this.answerConceptUuids, ac => `"${ac}"`).toString();
    }

    getScopeRuleSummary() {
        return `${this.conceptName} in ${_.lowerCase(this.scope)}`;
    }

    getRuleSummary() {
        if (this.isConceptType()) {
            return `${_.lowerCase(this.type)} ${this.getScopeRuleSummary()}`
        }
        if (this.value) {
            return `${_.lowerCase(this.type)} ${this.getJSValue()}`
        }
        if (!_.isEmpty(this.answerConceptNames)) {
            return `${_.lowerCase(this.type)} ${this.getJSConceptAnswerNames()}`
        } else {
            return '';
        }
    }

    clone() {
        const rhs = new RHS();
        rhs.type = this.type;
        rhs.value = this.value;
        rhs.answerConceptNames = this.answerConceptNames;
        rhs.answerConceptUuids = this.answerConceptUuids;
        rhs.conceptName = this.conceptName;
        rhs.conceptUuid = this.conceptUuid;
        rhs.scope = this.scope;
        return rhs;
    }

    validate() {
        assertTrue(!_.isNil(this.type), "Type cannot be empty");
        if (_.isEqual(this.type, RHS.types.Value))
            assertTrue(!_.isNil(this.value), "Value cannot be empty");
        if (_.isEqual(this.type, RHS.types.AnswerConcept))
            assertTrue(!_.isEmpty(this.answerConceptNames), "Concept answers cannot be empty");
        if (this.isConceptType()) {
            assertTrue(!_.isEmpty(this.conceptName), "Concept name cannot be empty");
            assertTrue(!_.isEmpty(this.scope), "Concept scope cannot be empty");
        }
    }

    isConceptType() {
        return this.type === RHS.types.Concept;
    }

    isScopeRequired() {
        return !_.isNil(this.type) && this.isConceptType();
    }

    getConceptOptionValue() {
        return _.isEmpty(this.conceptName) || _.isEmpty(this.conceptUuid) ? null :
            {
                label: this.conceptName,
                value: {
                    name: this.conceptName,
                    uuid: this.conceptUuid,
                    toString: () => this.conceptUuid
                }
            }
    }

    changeConceptAndScope(name, uuid, formType) {
        this.conceptUuid = uuid;
        this.conceptName = name;
        const applicableScopes = ConceptScope.getScopeByFormType(formType);
        this.scope = _.head(_.values(applicableScopes));
    }
}

export default RHS;
