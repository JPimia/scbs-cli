import { spawn } from 'node:child_process';

const databaseUrl =
  process.env.SCBS_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@127.0.0.1:5432/scbs';
const cwd = process.env.SCBS_CWD ?? process.cwd();

async function run(command: string, args: string[], options?: { capture?: boolean }) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        SCBS_STORAGE_ADAPTER: 'postgres',
        SCBS_DATABASE_URL: databaseUrl,
      },
      stdio: options?.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (options?.capture) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated with signal ${signal}`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function main() {
  const migrate = await run('bun', ['run', 'cli', '--', 'migrate', '--json'], { capture: true });
  if (migrate.code !== 0) {
    process.stderr.write(migrate.stderr || migrate.stdout);
    process.exit(migrate.code);
  }

  const health = await run('bun', ['run', 'cli', '--', 'health', '--json'], { capture: true });
  if (health.code !== 0) {
    process.stderr.write(health.stderr || health.stdout);
    process.exit(health.code);
  }

  const serve = spawn('bun', ['run', 'cli', '--', 'serve', '--json'], {
    cwd,
    env: {
      ...process.env,
      SCBS_STORAGE_ADAPTER: 'postgres',
      SCBS_DATABASE_URL: databaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  serve.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    if (stdout.includes('"command":"serve"') && !settled) {
      settled = true;
      serve.kill('SIGTERM');
      process.stdout.write('SCBS PostgreSQL smoke passed.\n');
    }
  });
  serve.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!settled) {
        serve.kill('SIGTERM');
        reject(new Error(`Timed out waiting for PostgreSQL serve output. stderr: ${stderr}`));
      }
    }, 15000);

    serve.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    serve.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (signal && signal !== 'SIGTERM') {
        reject(new Error(`Serve process terminated with signal ${signal}. stderr: ${stderr}`));
        return;
      }
      resolve(code ?? 0);
    });
  });

  if (!settled || exitCode !== 0) {
    process.stderr.write(stderr || stdout);
    process.exit(exitCode || 1);
  }
}

await main();
