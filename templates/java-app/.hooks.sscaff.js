const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { platform } = require('os');

const cli = require.resolve('../../bin/cdk8s');

exports.pre = (variables) => {
  try {
    execSync(`${platform() === 'win32' ? 'where' : 'which'} mvn`);
  } catch {
    console.error(`Unable to find "mvn". Install from https://maven.apache.org/install.html`);
    process.exit(1);
  }
  variables.constructs_version = variables.constructs_version.replace('^', '').replace('~', '');
};

exports.post = options => {
  const { mvn_cdk8s, cdk8s_core_version } = options;
  if (!mvn_cdk8s) {
    throw new Error(`missing context "mvn_cdk8s"`);
  }

  // This is used for installing artifacts that are local (not from Maven)
  // https://maven.apache.org/plugins/maven-install-plugin/usage.html
  if (mvn_cdk8s.endsWith('.jar')) {
    execSync(`mvn install:install-file -Dfile=${mvn_cdk8s} -DgroupId=org.cdk8s -DartifactId=cdk8s -Dversion=${cdk8s_core_version} -Dpackaging=jar`)
  }

  execSync(`mvn install`);
  execSync(`node "${cli}" import k8s -l java`);
  execSync(`mvn compile`);
  execSync(`mvn exec:java -Dexec.mainClass="com.mycompany.app.Main"`);

  console.log(readFileSync('./help', 'utf-8'));
};
