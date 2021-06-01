import { execFileSync } from 'child_process';
import { mkdtempSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const cli = require.resolve('../../lib/cli/index');

const templates = [];
const tdir = join(__dirname, '..', '..', 'templates');
for (const file of readdirSync(tdir)) {
  if (statSync(join(tdir, file)).isDirectory()) {
    templates.push(file);
  }
}

test.each(templates)('%s', name => {
  const workdir = mkdtempSync(join(tmpdir(), 'cdk8s-init-test-'));
  execFileSync(process.execPath, [cli, 'init', name], {
    cwd: workdir,
    env: {
      ...process.env,
      CDK8S_TEST: 'true',
    },
  });
});