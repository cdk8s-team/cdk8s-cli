const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');

exports.post = ctx => {

  const deps = {
    'cdk8s': `^${ctx.cdk8s_core_version}`,
    'cdk8s-plus-25': `^${ctx.cdk8s_plus_version}`,
    'constructs': `^${ctx.constructs_version}`
  }

  const cliSpec = ctx.npm_cdk8s_cli_path ?? `^${ctx.npm_cdk8s_cli_version}`

  const devDeps = {
    'cdk8s-cli': cliSpec,
    '@types/node': '^14',
    '@types/jest': '^26',
    'jest': '^26',
    'ts-jest': '^26',
    'typescript': '^4.9.5',
    'ts-node': '^10',
  }

  const packageJson = JSON.parse(readFileSync('package.json', { encoding: 'utf-8' }));
  packageJson.dependencies = deps;
  packageJson.devDependencies = devDeps;
  writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

  const env = { ...process.env };

  execSync('npm install', { stdio: 'inherit', env });

  // import k8s objects
  execSync('npm run import', { stdio: 'inherit', env });
  execSync('npm run compile', { stdio: 'inherit', env });
  execSync('npm run test -- -u', { stdio: 'inherit', env });
  execSync('npm run synth', { stdio: 'inherit', env });

  console.log(readFileSync('./help', 'utf-8'));
};
