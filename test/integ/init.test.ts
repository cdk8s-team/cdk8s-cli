import { execSync } from 'child_process';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const cli = join(__dirname, '..', '..', 'dist', 'js', 'cdk8s-cli-0.0.0.tgz');

if (!existsSync(cli)) {
  throw new Error(`Unable to find cli distribution at: ${cli}. Make sure you run 'npx projen package' before running this test`);
}

const cliNpmdir = mkdtempSync(join(tmpdir(), 'cdk8s-cli-npm-'));
const cliYarndir = mkdtempSync(join(tmpdir(), 'cdk8s-cli-yarn-'));

execSync(`npm install ${cli}`, {
  cwd: cliNpmdir,
  stdio: ['inherit', 'inherit', 'inherit'],
});

execSync(`yarn add ${cli}`, {
  cwd: cliYarndir,
  stdio: ['inherit', 'inherit', 'inherit'],
});

test('typescript-app-npm', () => {
  init('typescript-app', cliNpmdir);
});

test('go-app-npm', () => {
  init('go-app', cliNpmdir);
});

test('java-app-npm', () => {
  init('java-app', cliNpmdir);
});

test('python-app-npm', () => {
  init('python-app', cliNpmdir);
});

test('typescript-app-yarn', () => {
  init('typescript-app', cliYarndir);
});

test('go-app-yarn', () => {
  init('go-app', cliYarndir);
});

test('java-app-yarn', () => {
  init('java-app', cliYarndir);
});

test('python-app-yarn', () => {
  init('python-app', cliYarndir);
});

function init(template: string, clidir: string) {

  const workdir = mkdtempSync(join(tmpdir(), 'cdk8s-init-test-'));
  execSync(`${clidir}/node_modules/.bin/cdk8s init ${template}`, {
    cwd: workdir,
    env: {
      ...process.env,
      CDK8S_TARBALL: cli,
    },
    stdio: ['inherit', 'inherit', 'inherit'],
  });

}
