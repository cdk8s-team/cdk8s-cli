import { yellow, red } from 'colors';
import * as yargs from 'yargs';
import { upgradeAvailable } from '../upgrades';

if (new Date() < new Date('2025-01-01')) {
  console.warn(yellow('⚠️ Version 1.x of the cdk8s toolchain is deprecated and will become end-of-life on 01/01/25.'));
  console.warn(yellow('We strongly recommend migrating to 2.x. See https://cdk8s.io/docs/latest/migrating-from-1.x/'));
} else {
  console.warn(red('⚠️ Version 1.x of the cdk8s toolchain is end-of-life (since 01/01/25).'));
  console.warn(red('We strongly recommend migrating to 2.x. See https://cdk8s.io/docs/latest/migrating-from-1.x/'));
}

async function main() {
  const ya = yargs
    .option('check-upgrade', { type: 'boolean', desc: 'Check for cdk8s-cli upgrade', default: true })
    .check(argv => {
      if (argv.checkUpgrade) {
        const versions = upgradeAvailable();
        if (versions) {
          console.error('------------------------------------------------------------------------------------------------');
          console.error(yellow(`A new version ${versions.latest} of cdk8s-cli is available (current ${versions.current}).`));
          console.error(yellow('Run "npm install -g cdk8s-cli" to install the latest version on your system.'));
          console.error(yellow('For additional installation methods, see https://cdk8s.io/docs/latest/getting-started'));
          console.error('------------------------------------------------------------------------------------------------');
        }
      }

      return true;
    }, true)
    .commandDir('cmds')
    .recommendCommands()
    .wrap(yargs.terminalWidth())
    .showHelpOnFail(false)
    .env('CDK8S')
    .epilogue('Options can be specified via environment variables with the "CDK8S_" prefix (e.g. "CDK8S_OUTPUT")')
    .help();

  const args = ya.argv;
  if (args._.length === 0) {
    yargs.showHelp();
  }
}

main().catch(e => {
  console.error(e.stack);
  process.exit(1);
});
