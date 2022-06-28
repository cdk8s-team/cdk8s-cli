import { execSync } from 'child_process';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const cli = join(__dirname, '..', '..', 'dist', 'js', 'cdk8s-cli-0.0.0.tgz');

if (!existsSync(cli)) {
  throw new Error(`Unable to find cli distribution at: ${cli}. Make sure you run 'npx projen package' before running this test`);
}

const clidir = mkdtempSync(join(tmpdir(), 'cdk8s-cli-'));

execSync(`npm install ${cli}`, {
  cwd: clidir,
  stdio: ['inherit', 'inherit', 'inherit'],
});

test('typescript-app', () => {
  init('typescript-app');
});

test('go-app', () => {
  init('go-app');
});

test('java-app', () => {
  init('java-app');
});

test('python-app', () => {
  init('python-app');
});

function init(template: string) {

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
