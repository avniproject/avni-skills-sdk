import _ from "lodash";
import {assertTrue} from "./Util.js";
import CompoundRule from './CompoundRule.js';
import {Rule} from "./index.js";

class Condition {
    static conjunctions = {
        And: 'and',
        Or: 'or'
    };

    constructor() {
        this.compoundRule = new CompoundRule();
    }

    static fromResource(json) {
        const condition = new Condition();
        condition.conjunction = json.conjunction;
        condition.compoundRule = CompoundRule.fromResource(json.compoundRule);
        return condition;
    }

    setConjunction(conjunction) {
        const conjunctions = _.values(Condition.conjunctions);
        assertTrue(_.includes(conjunctions, conjunction), `Conjunction must be one of the ${conjunctions}`);
        this.conjunction = conjunction;
    }

    setCompoundRule(compoundRule) {
        this.compoundRule = compoundRule;
    }

    getRuleCondition() {
        return this.compoundRule.getRuleCondition();
    }

    getRHSScopeCode(entityName) {
        const rhsScopeSet = new Set();
        _.forEach(this.compoundRule.rules, rule => rhsScopeSet.add(rule.rhs.getScopeCode(entityName)));
        return _.reject([...rhsScopeSet], _.isEmpty).join("\n");
    }

    clone() {
        const condition = new Condition();
        condition.compoundRule = this.compoundRule.clone();
        condition.conjunction = this.conjunction;
        return condition;
    }

    getInitialCondition() {
        const rule = new Rule();
        const compoundRule = new CompoundRule();
        compoundRule.addRule(rule);
        this.setCompoundRule(compoundRule);
        return this;
    }

    validate() {
        this.compoundRule.validate();
    }

}

export default Condition;
