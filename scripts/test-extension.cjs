const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const options = {
  extensionDevelopmentPath: path.resolve(__dirname, '..'),
  extensionTestsPath: path.resolve(__dirname, '../dist/test/extension-host.js'),
  extensionTestsEnv: { ...process.env, ARCHI_TEST: '1' },
  launchArgs: [process.env.ARCHI_TEST_WORKSPACE || path.resolve(__dirname, '..'), '--disable-extensions'],
};

if (process.env.ARCHI_VSCODE_PATH) options.vscodeExecutablePath = process.env.ARCHI_VSCODE_PATH;
else if (process.platform === 'linux' && require('node:fs').existsSync('/usr/share/code/code')) options.vscodeExecutablePath = '/usr/share/code/code';

runTests(options).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
