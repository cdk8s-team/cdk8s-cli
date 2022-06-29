import * as fs from 'fs';
import * as path from 'path';
import { typescript, github } from 'projen';

export function addIntegTests(project: typescript.TypeScriptProject) {

  const integWorkflow = project.github!.addWorkflow('integ');
  integWorkflow.on({ pullRequest: {}, workflowDispatch: {} });

  const initTask = project.addTask('integ:init');
  initTask.exec(`yarn run ${project.compileTask.name}`);
  initTask.exec(`yarn run ${project.packageTask.name}`);
  initTask.exec(jest('integ/init.test.ts'));

  const templatesDir = path.join(__dirname, '..', 'templates');
  for (const template of fs.readdirSync(templatesDir)) {
    if (fs.statSync(path.join(templatesDir, template)).isDirectory()) {
      const task = project.addTask(`integ:init:${template}`);
      task.exec(`yarn run ${project.compileTask.name}`);
      task.exec(`yarn run ${project.packageTask.name}`);
      task.exec(jest(`integ/init.test.ts -t ${template}`));
    }
  }

  // run all init tests on node 14
  integWorkflow.addJob('init', {
    runsOn: ['ubuntu-latest'],
    permissions: { contents: github.workflows.JobPermission.READ },
    steps: runSteps(initTask.name, '14', true, true),
  });

  // run typescript app on node 16 and 18 as well
  const nodeVersions = [16, 18];
  integWorkflow.addJob('init-typescript-app', {
    runsOn: ['ubuntu-latest'],
    strategy: {
      failFast: false,
      matrix: { domain: { nodeVersion: nodeVersions } },
    },
    permissions: {
      contents: github.workflows.JobPermission.READ,
    },
    steps: runSteps('integ:init:typescript-app', '${{ matrix.nodeVersion }}', false, false),
  });

  project.autoMerge!.addConditions('status-success=init');

  for (const nodeVersion of nodeVersions) {
    project.autoMerge!.addConditions(`status-success=init-typescript-app (${nodeVersion})`);
  }

}

function jest(args: string) {
  // we override 'testPathIgnorePatterns' so that it matches only integration tests
  return `jest --testPathIgnorePatterns "^((?!integ).)*$" --passWithNoTests --all --updateSnapshot --coverageProvider=v8 ${args}`;
};

function runSteps(task: string, nodeVersion: string, python: boolean, go: boolean): github.workflows.JobStep[] {
  const steps: github.workflows.JobStep[] = [
    { uses: 'actions/checkout@v2' },
    {
      name: 'Set up Node.js',
      uses: 'actions/setup-node@v2',
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
      uses: 'actions/setup-python@v2',
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
      uses: 'actions/setup-go@v2',
      with: {
        'go-version': '1.16',
      },
    });
  }

  steps.push({
    name: 'Run integration tests',
    run: `yarn run ${task}`,
  },
  );
  return steps;
}