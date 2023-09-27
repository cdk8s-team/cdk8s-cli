import { Cdk8sTeamTypeScriptProject } from '@cdk8s/projen-common';
import { DependencyType } from 'projen';
import { addIntegTests } from './projenrc/integ';

const project = new Cdk8sTeamTypeScriptProject({
  projenrcTs: true,
  release: true,
  name: 'cdk8s-cli',
  description: 'This is the command line tool for Cloud Development Kit (CDK) for Kubernetes (cdk8s).',

  // no need, we are configuring explicit exports.
  entrypoint: '',

  keywords: [
    'k8s',
    'cdk8s',
    'kubernetes',
    'cli',
    'tools',
    'automation',
    'containers',
  ],
  workflowBootstrapSteps: [
    { run: 'pip3 install pipenv' },
    {
      name: 'Installing helm for tests',
      uses: 'azure/setup-helm@v3',
    },
  ],
  defaultReleaseBranch: '2.x',
  majorVersion: 2,
  releaseBranches: {
    '1.x': {
      majorVersion: 1,
      npmDistTag: 'latest-1',
    },
  },
  bin: {
    cdk8s: 'bin/cdk8s',
  },
  deps: [
    'cdk8s',
    'cdk8s-plus-25',
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
    'table',
    'semver',
  ],
  devDeps: [
    '@cdk8s/projen-common',
    '@types/fs-extra@^8',
    '@types/json-schema',
    '@types/semver',
    'glob',
    '@types/glob',
    'typescript-json-schema',
  ],
  backport: true,
  backportBranches: ['1.x'],
});

project.tsconfig?.addInclude('src/schemas/*.json');
project.tsconfigDev.addInclude('src/schemas/*.json');

//
// see https://nodejs.org/api/packages.html#exports
project.addFields({
  exports: {
    './plugins': './lib/plugins/index.js',
    './package.json': './package.json',
  },
});

// ignore integration tests since they need to executed after packaging
// and are defined in a separate tasks.
project.jest?.addIgnorePattern('/test/integ/');

project.gitignore.exclude('.vscode/');

// add @types/node as a regular dependency since it's needed to during "import"
// to compile the generated jsii code.
project.deps.removeDependency('@types/node', DependencyType.BUILD);
project.deps.addDependency('@types/node@^16', DependencyType.RUNTIME);

const schemas = project.addTask('schemas');
schemas.exec('ts-node scripts/crd.schema.ts');

project.compileTask.spawn(schemas);

// so that it works on windows as well
// default projen uses $(npm pack) which fails
project.packageTask.reset();
project.packageTask.exec('mkdir -p dist/js');
project.packageTask.exec('npm pack --pack-destination dist/js');


addIntegTests(project);

project.synth();
