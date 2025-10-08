const { execSync } = require('child_process');
const { chmodSync } = require('fs');
const { readFileSync } = require('fs');
const { platform } = require('os');

const cli = require.resolve('../../bin/cdk8s');

exports.pre = () => {
  try {
    execSync(`${platform() === 'win32' ? 'where' : 'which'} uv`);
  } catch {
    console.error(`Unable to find "uv". Install from https://docs.astral.sh/uv/getting-started/installation/`);
    process.exit(1);
  }
};

exports.post = options => {
  const { pypi_cdk8s, pypi_cdk8s_plus } = options;
  if (!pypi_cdk8s) {
    throw new Error(`missing context "pypi_cdk8s"`);
  }
  if (!pypi_cdk8s_plus) {
    throw new Error(`missing context "pypi_cdk8s_plus"`);
  }

  execSync('uv lock --refresh')

  // this installs the libraries in the pyproject.toml we provide
  execSync('uv sync', { stdio: 'inherit' });

  // these are more akward to put in the pyproject.toml since they can be local wheel files
  execSync(`uv pip install --prerelease allow ${pypi_cdk8s}`, { stdio: 'inherit' });
  execSync(`uv pip install --prerelease allow ${pypi_cdk8s_plus}`, { stdio: 'inherit' });

  chmodSync('main.py', '700');

  execSync(`node "${cli}" import k8s -l python`);
  execSync(`uv run python main.py`);

  console.log(readFileSync('./help', 'utf-8'));
};

