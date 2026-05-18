import {assertTrue} from "./Util.js";
import _ from "lodash";
import {LHS, Rule} from "./index.js";
import ConceptScope from "./ConceptScope.js";

class CompoundRule {
    static conjunctions = {
        And: 'and',
        Or: 'or'
    };

    constructor(conjunction) {
        this.conjunction = conjunction;
        this.rules = [];
    }

    static fromResource(json) {
        const compoundRule = new CompoundRule();
        compoundRule.conjunction = json.conjunction;
        compoundRule.rules = _.map(json.rules, rule => Rule.fromResource(rule));
        return compoundRule;
    }

    addRule(rule) {
        this.rules.push(rule);
    }

    setConjunction(conjunction) {
        const conjunctions = _.values(CompoundRule.conjunctions);
        assertTrue(_.includes(conjunctions, conjunction), `Conjunction must be one of the ${conjunctions}`);
        this.conjunction = conjunction;
    }

    addEmptyRule() {
        const rule = new Rule();
        this.rules.push(rule);
    }

    getRuleCondition() {
        return _.map(this.rules, rule => rule.getRuleCondition()).join(`.${this.conjunction}.`).concat('.matches()');
    }

    getRuleSummary() {
        return _.map(this.rules, rule => rule.getRuleSummary()).join(` ${_.upperCase(this.conjunction)} `);
    }

    clone() {
        const compoundRule = new CompoundRule();
        compoundRule.conjunction = this.conjunction;
        compoundRule.rules = _.map(this.rules, rule => rule.clone());
        return compoundRule;
    }

    validate() {
        _.forEach(this.rules, rule => rule.validate());
    }

    deleteRuleAtIndex(index) {
        if (_.size(this.rules) === 1) {
            return this.rules = [new Rule()];
        } else {
            this.rules.splice(index, 1)
        }
    }

    updateRuleAtIndex(index, name, uuid, dataType, formType, parentConceptUuid) {
        const newRule = new Rule();
        if (uuid && dataType) {
            const applicableScopes = ConceptScope.getScopeByFormType(formType);
            newRule.lhs.type = LHS.types.Concept;
            newRule.lhs.conceptName = name;
            newRule.lhs.conceptUuid = uuid;
            newRule.lhs.conceptDataType = dataType;
            newRule.lhs.parentConceptUuid = parentConceptUuid;
            newRule.lhs.scope = _.head(_.values(applicableScopes));
        } else {
            newRule.lhs.type = name;
        }
        newRule.operator = _.head(_.values(newRule.getApplicableOperators()));
        newRule.rhs.type = _.head(_.values(newRule.getApplicableRHSTypes()));
        this.rules.splice(index, 1, newRule);
    }
}

export default CompoundRule;
