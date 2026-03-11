import { spawn } from 'node:child_process';

const packageDirs = ['apps/cli', 'apps/server'];
const scriptName = process.argv[2];

if (!scriptName) {
  console.error('Usage: bun scripts/run-package-checks.ts <script-name>');
  process.exit(1);
}

for (const packageDir of packageDirs) {
  console.log(`\n> ${packageDir}:${scriptName}`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn('bun', ['run', '--cwd', packageDir, scriptName], {
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${packageDir}:${scriptName} terminated with signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
