/*****************************************************************************************************
 * This file is written in JS (and not TS) because:
 *
 * 1. It allows us to keep running tests directory from the TS source without compiling first.
 * 2. It validates that at runtime, the validation plugin doesn't require any imports
 *    (which is good practice since it simplifies dynamic loading)
 *
 *****************************************************************************************************/

const fs = require('fs');

class MockValidation {

  constructor(props) {
    this.props = props;
  }

  async validate(context) {
    context.report.addViolation({
      severity: 'warning',
      resourceName: 'resource',
      message: 'message',
      manifestPath: 'path',
    });
    if (this.props.fail) {
      context.report.fail();
    } else {
      context.report.pass();
    }
    // a way to signal to tests that the validation was
    // indeed invoked.
    fs.writeFileSync(`validation-done.marker`, '')
  }

}

module.exports = {
  MockValidation: MockValidation,
}