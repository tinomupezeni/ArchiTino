const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

runTests({
  vscodeExecutablePath: process.env.ARCHI_VSCODE_PATH || '/usr/share/code/code',
  extensionDevelopmentPath: path.resolve(__dirname, '..'),
  extensionTestsPath: path.resolve(__dirname, '../dist/test/benchmark.js'),
  extensionTestsEnv: { ...process.env, ARCHI_TEST: '1' },
  launchArgs: [process.env.ARCHI_TEST_WORKSPACE || path.resolve(__dirname, '..'), '--disable-extensions'],
}).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
