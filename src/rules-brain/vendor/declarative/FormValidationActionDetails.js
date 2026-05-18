import _ from "lodash";
import {assertTrue} from "./Util.js";

class FormValidationActionDetails {

    constructor() {
    }

    static fromResource(json) {
        const actionDetails = new FormValidationActionDetails();
        actionDetails.validationError = json.validationError;
        return actionDetails;
    }

    setValidationError(error) {
        this.validationError = error;
    }

    clone() {
        const details = new FormValidationActionDetails();
        details.validationError = this.validationError;
        return details;
    }

    validate() {
        assertTrue(!_.isEmpty(this.validationError), "Validation error in Action cannot be empty");
    }

}

export default FormValidationActionDetails
