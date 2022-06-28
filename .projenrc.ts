import { Cdk8sCommon } from '@cdk8s/projen-common';
import { github, typescript, JsonFile, DependencyType } from 'projen';
import { addIntegTests } from './projenrc/integ';

const project = new typescript.TypeScriptProject({
  ...Cdk8sCommon.props,

  projenrcTs: true,
  name: 'cdk8s-cli',
  description: 'This is the command line tool for Cloud Development Kit (CDK) for Kubernetes (cdk8s).',
  repositoryUrl: 'https://github.com/cdk8s-team/cdk8s-cli.git',
  projenUpgradeSecret: 'PROJEN_GITHUB_TOKEN',
  authorName: 'Amazon Web Services',
  authorUrl: 'https://aws.amazon.com',
  minNodeVersion: '14.17.0',

  keywords: [
    'k8s',
    'cdk8s',
    'kubernetes',
    'cli',
    'tools',
    'automation',
    'containers',
  ],

  workflowBootstrapSteps: [{ run: 'pip3 install pipenv' }],

  defaultReleaseBranch: '2.x',
  majorVersion: 2,
  releaseBranches: {
    '1.x': {
      majorVersion: 1,
      npmDistTag: 'latest-1',
    },
  },

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
    '@cdk8s/projen-common',
    '@types/fs-extra@^8',
    '@types/json-schema',
    'glob',
    '@types/glob',
    'typescript-json-schema',
  ],

  tsconfig: {
    include: ['src/schemas/*.json'],
  },

  // run upgrade-dependencies workflow at a different hour than other cdk8s
  // repos to decrease flakiness of integration tests caused by new versions of
  // cdk8s and cdk8s+ being published to different languages at the same time
  depsUpgradeOptions: {
    // the latest versions of yaml require node > 12, which
    // is a change we are still not willing to make.
    exclude: ['yaml'],
    workflowOptions: {
      schedule: Cdk8sCommon.upgradeScheduleFor('cdk8s-cli'),
    },
  },
});

// ignore integration tests since they need to executed after packaging
// and are defined in a separate tasks.
project.jest?.addIgnorePattern('integ*');

project.gitignore.exclude('.vscode/');

new Cdk8sCommon(project);

// add @types/node as a regular dependency since it's needed to during "import"
// to compile the generated jsii code.
project.deps.removeDependency('@types/node', DependencyType.BUILD);
project.deps.addDependency('@types/node@^12', DependencyType.RUNTIME);

const schemas = project.addTask('schemas');
schemas.exec('ts-node scripts/crd.schema.ts');

project.compileTask.spawn(schemas);

// run backport in clean directories every time.
const backportHome = '/tmp/.backport/';
const backportDir = `${backportHome}/repositories/cdk8s-team/cdk8s-cli`;
const backportConfig = new JsonFile(project, '.backportrc.json', {
  // see https://github.com/sqren/backport/blob/main/docs/config-file-options.md
  obj: {
    repoOwner: 'cdk8s-team',
    repoName: 'cdk8s-cli',
    signoff: true,
    branchLabelMapping: {
      '^backport-to-(.+)$': '$1',
    },
    prTitle: '{commitMessages}',
    fork: false,
    publishStatusCommentOnFailure: true,
    publishStatusCommentOnSuccess: true,
    publishStatusCommentOnAbort: true,
    targetPRLabels: [project.autoApprove!.label],
    dir: backportDir,
  },
});

// backport task to branches based on pr labels
const backportTask = createBackportTask();

// backport tasks to the explicit release branches
for (const branch of project.release!.branches) {
  createBackportTask(branch);
}

const backportWorkflow = project.github!.addWorkflow('backport');
backportWorkflow.on({ pullRequestTarget: { types: ['closed'] } });
backportWorkflow.addJob('backport', {
  runsOn: ['ubuntu-18.04'],
  permissions: {
    contents: github.workflows.JobPermission.WRITE,
  },
  steps: [
    // needed in order to run the projen task as well
    // as use the backport configuration in the repo.
    {
      name: 'checkout',
      uses: 'actions/checkout@v3',
      with: {
        // required because we need the full history
        // for proper backports.
        'fetch-depth': 0,
      },
    },
    {
      name: 'Set Git Identity',
      run: 'git config --global user.name "github-actions" && git config --global user.email "github-actions@github.com"',
    },
    {
      name: 'backport',
      if: 'github.event.pull_request.merged == true',
      run: `npx projen ${backportTask.name}`,
      env: {
        GITHUB_TOKEN: '${{ secrets.PROJEN_GITHUB_TOKEN }}',
        BACKPORT_PR_NUMBER: '${{ github.event.pull_request.number }}',
      },
    },
  ],
});

function createBackportTask(branch?: string) {
  const name = branch ? `backport:${branch}` : 'backport';
  const task = project.addTask(name, { requiredEnv: ['BACKPORT_PR_NUMBER', 'GITHUB_TOKEN'] });
  task.exec(`rm -rf ${backportHome}`);
  task.exec(`mkdir -p ${backportHome}`);
  task.exec(`cp ${backportConfig.path} ${backportHome}`);

  const command = ['npx', 'backport', '--accesstoken', '${GITHUB_TOKEN}', '--pr', '${BACKPORT_PR_NUMBER}'];
  if (branch) {
    command.push(...['--branch', branch]);
  } else {
    command.push('--non-interactive');
  }
  task.exec(command.join(' '), { cwd: backportHome });
  return task;
}

addIntegTests(project);

project.synth();
