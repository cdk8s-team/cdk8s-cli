const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { dirname } = require('path');

const clibin = dirname(require.resolve('../../bin/cdk8s'));

exports.post = ctx => {
  const npm_cdk8s = ctx.npm_cdk8s;
  const npm_cdk8s_plus = ctx.npm_cdk8s_plus;
  const npm_cdk8s_cli = ctx.npm_cdk8s_cli;
  const constructs_version = ctx.constructs_version;

  if (!npm_cdk8s) { throw new Error(`missing context "npm_cdk8s"`); }

  installDeps([ npm_cdk8s, npm_cdk8s_plus, `constructs@^${constructs_version}` ]);
  installDeps([
      '@types/node@14',
      '@types/jest@26',
      'jest@26',
      'ts-jest@26',
      'typescript'
  ], true);

  const env = { ...process.env };

  // install cdk8s cli if defined
  if (npm_cdk8s_cli) {
    installDeps([npm_cdk8s_cli], true);
  } else {
    env.PATH = `${clibin}:${process.env.PATH}`;
  }

  // import k8s objects
  execSync('npm run import', { stdio: 'inherit', env });
  execSync('npm run compile', { stdio: 'inherit', env });
  execSync('npm run test -- -u', { stdio: 'inherit', env });
  execSync('npm run synth', { stdio: 'inherit', env });

  console.log(readFileSync('./help', 'utf-8'));
};

function installDeps(deps, isDev) {
  const devDep = isDev ? '-D' : '';
  execSync(`npm install ${devDep} ${deps.join(' ')}`, { stdio: 'inherit' });
}

