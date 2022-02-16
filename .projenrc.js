const { typescript, DependencyType } = require('projen');
const { UpgradeDependenciesSchedule } = require('projen/lib/javascript');

const project = new typescript.TypeScriptProject({
  name: 'cdk8s-cli',
  description: 'This is the command line tool for Cloud Development Kit (CDK) for Kubernetes (cdk8s).',
  repositoryUrl: 'https://github.com/cdk8s-team/cdk8s-cli.git',
  projenUpgradeSecret: 'PROJEN_GITHUB_TOKEN',
  authorName: 'Amazon Web Services',
  authorUrl: 'https://aws.amazon.com',
  minNodeVersion: '12.13.0',
  workflowNodeVersion: '12.22.0', // required by @typescript-eslint/eslint-plugin
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

  // run upgrade-dependencies workflow at a different hour than other cdk8s
  // repos to decrease flakiness of integration tests caused by new versions of
  // cdk8s and cdk8s+ being published to different languages at the same time
  depsUpgradeOptions: {
    workflowOptions: {
      schedule: UpgradeDependenciesSchedule.expressions(['0 1 * * *']),
    },
  },
});

// add @types/node as a regular dependency since it's needed to during "import"
// to compile the generated jsii code.
project.deps.removeDependency('@types/node', DependencyType.BUILD);
project.deps.addDependency('@types/node@^12', DependencyType.RUNTIME);

const schemas = project.addTask('schemas');
schemas.exec('ts-node scripts/crd.schema.ts');

project.compileTask.spawn(schemas);

project.synth();
