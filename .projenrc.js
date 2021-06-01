const { TypeScriptProject } = require('projen');

const project = new TypeScriptProject({
  name: 'cdk8s-cli',
  description: 'CDK for Kubernetes CLI',
  repositoryUrl: 'https://github.com/cdk8s-team/cdk8s-cli.git',
  prerelease: 'beta',
  projenUpgradeSecret: 'PROJEN_GITHUB_TOKEN',
  authorName: 'Amazon Web Services',
  authorUrl: 'https://aws.amazon.com',
  minNodeVersion: '10.17.0',
  defaultReleaseBranch: 'main',
  releaseToNpm: true,
  bin: {
    cdk8s: 'bin/cdk8s',
  },
  deps: [
    'cdk8s',
    'cdk8s-plus-17',
    'codemaker',
    'constructs',
    'fs-extra@^8',
    'jsii-srcmak',
    'jsii-pacmak',
    'sscaff',
    'yaml',
    'yargs@^15',
    'json2jsii',
    'colors',

    // add @types/node as a regular dependency since it's needed to during "import"
    // to compile the generated jsii code.
    '@types/node@^10.17.0',
  ],
  devDeps: [
    '@types/fs-extra@^8',
    '@types/json-schema',
  ],
});

project.synth();
