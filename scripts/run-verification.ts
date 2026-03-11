import { spawn } from 'node:child_process';

const lane = process.argv[2] ?? 'local';

type CommandSpec = {
  command: string;
  args: string[];
};

const baseCommands: CommandSpec[] = [
  { command: 'bun', args: ['run', 'lint'] },
  { command: 'bun', args: ['run', 'typecheck'] },
  { command: 'bun', args: ['test'] },
  { command: 'bun', args: ['run', 'test:packages'] },
  { command: 'bun', args: ['run', 'verify:openapi'] },
];

const ciCommands: CommandSpec[] = [
  ...baseCommands,
  { command: 'bun', args: ['run', 'verify:postgres'] },
];
const commands = lane === 'ci' ? ciCommands : baseCommands;

if (!['local', 'ci'].includes(lane)) {
  console.error(`Unknown verification lane "${lane}". Expected "local" or "ci".`);
  process.exit(1);
}

for (const { command, args } of commands) {
  console.log(`\n> ${command} ${args.join(' ')}`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated with signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
