import {assertTrue} from "./Util.js";
import _ from "lodash";
import LHS from './LHS.js';
import RHS from './RHS.js';

class Rule {
    static codedOperators = {
        'HasAnswer': 'containsAnswerConceptName',
        'HasAnyOneAnswer': 'containsAnyAnswerConceptName',
        'HasAnswerOtherThan': 'containsAnswerConceptNameOtherThan',
    };

    static numericOperators = {
        'Equals': 'equals',
        'LessThan': 'lessThan',
        'LessThanOrEqualTo': 'lessThanOrEqualTo',
        'GreaterThan': 'greaterThan',
        'GreaterThanOrEqualTo': 'greaterThanOrEqualTo',
    };

    static noRHSOperators = {
        'Present': 'defined',
        'NotPresent': 'notDefined'
    };

    static operators = {...Rule.codedOperators, ...Rule.numericOperators, ...Rule.noRHSOperators};

    constructor() {
        this.lhs = new LHS();
        this.rhs = new RHS();
    }

    static fromResource(json) {
        const rule = new Rule();
        rule.operator = json.operator;
        rule.lhs = LHS.fromResource(json.lhs);
        rule.rhs = RHS.fromResource(json.rhs);
        return rule;
    }

    setLHS(lhs) {
        this.lhs = lhs;
    }

    setRHS(rhs) {
        this.rhs = rhs;
    }

    getApplicableOperators() {
        if (this.lhs.isCodedConcept()) {
            return {...Rule.codedOperators, ...Rule.noRHSOperators};
        }
        if (this.lhs.isNumeric() || this.lhs.isDate()) {
            return {...Rule.numericOperators, ...Rule.noRHSOperators};
        } else {
            const equals = _.pickBy(Rule.numericOperators, (v, k) => v === Rule.numericOperators.Equals);
            return {...equals, ...Rule.noRHSOperators}
        }
    }

    getApplicableRHSTypes() {
        if (this.lhs.isCodedConcept()) {
            return {'AnswerConcept': RHS.types.AnswerConcept};
        } else {
            return {'Value': RHS.types.Value, 'Concept': RHS.types.Concept};
        }
    }

    setOperator(operator) {
        const operators = _.values(Rule.operators);
        assertTrue(_.includes(operators, operator), `Operator must be one of the ${operators}`);
        this.operator = operator;
    }

    isRhsRequired() {
        return !_.isEmpty(this.operator) && !_.includes(_.values(Rule.noRHSOperators), this.operator);
    }

    isOperatorRequired() {
        return this.lhs.isConcept() ? !_.isEmpty(this.lhs.scope) : !_.isEmpty(this.lhs.type);
    }

    getRhsValueType() {
        return this.lhs.isNumeric() ? 'number' : 'text';
    }

    getRuleCondition() {
        const lhsAndOperator = `when.${this.lhs.getRuleCondition()}.${this.operator}`;
        const getFunctionParams = () => this.lhs.isDate() ? `${this.rhs.getRuleCondition()}, 'ms'` : `${this.rhs.getRuleCondition()}`;
        return this.isRhsRequired() ? `${lhsAndOperator}(${getFunctionParams()})` : lhsAndOperator;
    }

    getRuleSummary() {
        return _.isNil(this.lhs.type) ? 'Always' : `${this.lhs.getRuleSummary()} ${_.lowerCase(this.operator)} ${this.rhs.getRuleSummary()}`
    }

    clone() {
        const rule = new Rule();
        rule.lhs = this.lhs.clone();
        rule.operator = this.operator;
        rule.rhs = this.rhs.clone();
        return rule;
    }

    validate() {
        this.lhs.validate();
        if(!_.isNil(this.lhs.type)) assertTrue(!_.isNil(this.operator), "Operator cannot be empty");
        this.isRhsRequired() && this.rhs.validate();
    }
}

export default Rule;
