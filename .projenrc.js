const { TypeScriptProject } = require('projen');

const project = new TypeScriptProject({
  name: 'cdk8s-cli',
  description: 'This is the command line tool for Cloud Development Kit (CDK) for Kubernetes (cdk8s).',
  repositoryUrl: 'https://github.com/cdk8s-team/cdk8s-cli.git',
  projenUpgradeSecret: 'PROJEN_GITHUB_TOKEN',
  authorName: 'Amazon Web Services',
  authorUrl: 'https://aws.amazon.com',
  minNodeVersion: '12.13.0',
  defaultReleaseBranch: 'main',

  keywords: [
    'k8s',
    'cdk8s',
    'kubernetes',
    'cli',
    'tools',
    'automation',
    'containers',
  ],

  // needed for "cdk init" tests to work in all languages
  workflowContainerImage: 'jsii/superchain',
  workflowBootstrapSteps: [{ run: 'pip3 install pipenv' }],

  releaseToNpm: true,
  bin: {
    cdk8s: 'bin/cdk8s',
  },
  deps: [
    'cdk8s',
    'cdk8s-plus-22',
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
    'ajv',

    // add @types/node as a regular dependency since it's needed to during "import"
    // to compile the generated jsii code.
    '@types/node@^12.13.0',
  ],
  devDeps: [
    '@types/fs-extra@^8',
    '@types/json-schema',
    'glob',
    '@types/glob',
    'typescript-json-schema',
  ],

  // we need the compiled .js files for the init tests (we run the cli in there)
  compileBeforeTest: true,
  autoApproveOptions: {
    allowedUsernames: ['cdk8s-automation'],
    secret: 'GITHUB_TOKEN',
  },
  autoApproveUpgrades: true,
  tsconfig: {
    include: ['src/schemas/*.json'],
  },
});

const schemas = project.addTask('schemas');
schemas.exec('ts-node scripts/crd.schema.ts');

project.compileTask.spawn(schemas);

project.synth();
