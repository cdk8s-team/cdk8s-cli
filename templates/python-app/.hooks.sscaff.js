const { execSync } = require('child_process');
const { chmodSync } = require('fs');
const { readFileSync } = require('fs');
const { platform } = require('os');

const cli = require.resolve('../../bin/cdk8s');

exports.pre = () => {
  try {
    execSync(`${platform() === 'win32' ? 'where' : 'which'} pipenv`);
  } catch {
    console.error(`Unable to find "pipenv". Install from https://pipenv.pypa.io/en/latest/installation/`);
    process.exit(1);
  }
};

exports.post = options => {
  const { pypi_cdk8s } = options;
  if (!pypi_cdk8s) {
    throw new Error(`missing context "pypi_cdk8s"`);
  }

  execSync('pipenv lock --clear')

  // this installs the libraries in the Pipfile we provide
  execSync('pipenv install', { stdio: 'inherit' });

  // these are more akward to put in the Pipfile since they can be local wheel files
  execSync(`pipenv install --pre ${pypi_cdk8s}`, { stdio: 'inherit' });

  chmodSync('main.py', '700');

  execSync(`node "${cli}" import k8s -l python`);
  execSync(`pipenv run python main.py`);

  console.log(readFileSync('./help', 'utf-8'));
};

