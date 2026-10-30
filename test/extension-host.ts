import { run as runSuite } from './extension.test';

export async function run(): Promise<void> {
  await runSuite();
  process.stdout.write('Extension-host tests passed\n');
}
