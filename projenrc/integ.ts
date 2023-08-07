import * as fs from 'fs';
import * as path from 'path';
import { typescript, github } from 'projen';

export function addIntegTests(project: typescript.TypeScriptProject) {

  const oses = ['windows-latest', 'macos-latest', 'ubuntu-latest'];
  const excludedTemplates = [
    'helm-chart-with-crds',
    'helm-chart-without-crds',
  ];

  const integWorkflow = project.github!.addWorkflow('integ');
  integWorkflow.on({ pullRequest: {}, workflowDispatch: {} });

  const initTask = project.addTask('integ:init');
  initTask.exec(`yarn run ${project.compileTask.name}`);
  initTask.exec(`yarn run ${project.packageTask.name}`);
  initTask.exec(jest('integ/init.test.ts'));

  function addIntegTest(name: string) {
    const task = project.addTask(`integ:init:${name}`);
    task.exec(`yarn run ${project.compileTask.name}`);
    task.exec(`yarn run ${project.packageTask.name}`);
    task.exec(jest(`integ/init.test.ts -t ${name}`));
  }

  const templatesDir = path.join(__dirname, '..', 'templates');
  for (const template of fs.readdirSync(templatesDir)) {
    if (fs.statSync(path.join(templatesDir, template)).isDirectory() &&
      !excludedTemplates.includes(template)) {
      addIntegTest(`${template}-npm`);
      addIntegTest(`${template}-yarn`);
    }
  }

  // run all init tests on node 16
  integWorkflow.addJob('init', {
    runsOn: ['${{ matrix.os }}'],
    strategy: {
      failFast: false,
      matrix: {
        domain: {
          os: oses,
        },
      },
    },
    permissions: { contents: github.workflows.JobPermission.READ },
    steps: runSteps([initTask.name], '16', true, true),
  });

  // run typescript app on node 18 as well
  const nodeVersions = [18];
  integWorkflow.addJob('init-typescript-app', {
    runsOn: ['ubuntu-latest'],
    strategy: {
      failFast: false,
      matrix: { domain: { nodeVersion: nodeVersions } },
    },
    permissions: {
      contents: github.workflows.JobPermission.READ,
    },
    steps: runSteps(['integ:init:typescript-app-npm', 'integ:init:typescript-app-yarn'], '${{ matrix.nodeVersion }}', false, false),
  });

  for (const nodeVersion of nodeVersions) {
    project.autoMerge!.addConditions(`status-success=init-typescript-app (${nodeVersion})`);
  }

  for (const os of oses) {
    project.autoMerge!.addConditions(`status-success=init (${os})`);
  }

}

function jest(args: string) {
  // we override 'testPathIgnorePatterns' and 'testMatch' so that it matches only integration tests
  // see https://github.com/jestjs/jest/issues/7914
  return `jest --testMatch "<rootDir>/test/integ/**/*.test.ts" --testPathIgnorePatterns "/node_modules/" --passWithNoTests --all --updateSnapshot --coverageProvider=v8 ${args}`;
};

function runSteps(tasks: string[], nodeVersion: string, python: boolean, go: boolean): github.workflows.JobStep[] {
  const steps: github.workflows.JobStep[] = [
    { uses: 'actions/checkout@v3' },
    {
      name: 'Set up Node.js',
      uses: 'actions/setup-node@v3',
      with: { 'node-version': nodeVersion },
    },
    {
      name: 'Install dependencies',
      run: 'yarn install --frozen-lockfile',
    },
  ];

  if (python) {
    steps.push({
      name: 'Set up Python 3.x',
      uses: 'actions/setup-python@v4',
      with: {
        'python-version': '3.x',
      },
    });
    steps.push({
      name: 'Install pipenv',
      run: 'pip install pipenv',
    });
  }

  if (go) {
    steps.push({
      name: 'Set up Go',
      uses: 'actions/setup-go@v4',
      with: {
        'go-version': '1.18',
      },
    });
  }

  for (const task of tasks) {
    steps.push({
      name: 'Run integration tests',
      run: `yarn run ${task}`,
    });
  }
  return steps;
}