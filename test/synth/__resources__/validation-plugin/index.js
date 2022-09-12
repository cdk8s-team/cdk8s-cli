/*****************************************************************************************************
 * This file is written in JS (and not TS) because it more accurately simulates the real state
 * of execution during `cdk8s synth`, where only .js files are present.
 *
 * It also has the added benefit of not having to import any external code, which helps make tests
 * be more resilient to the location of this file.
 *
 *****************************************************************************************************/

const fs = require('fs');

class MockValidation {

  constructor(props) {
    this.props = props;
  }

  async validate(context) {
    for (const manifest of context.manifests) {
      console.log(`Validating manifest: ${manifest}`);
    }

    context.report.addViolation({
      ruleName: 'Some rule',
      recommendation: 'Some recommendation',
      violatingResources: [{
        manifestPath: 'path',
        resourceName: 'resource',
        locations: ['location1', 'location2']
      }],
      fix: 'Some fix',
    });

    if (this.props.throw ?? false) {
      throw new Error('Throwing per request');
    }

    context.report.submit(this.props.fail ? 'failure' : 'success');

    // a way to signal to tests that the validation was
    // indeed invoked.
    fs.writeFileSync('validation-done.marker', '');
  }

}

module.exports = {
  MockValidation: MockValidation,
};