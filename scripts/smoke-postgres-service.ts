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

  const register = await run(
    'bun',
    ['run', 'cli', '--', 'repo', 'register', '--name', 'smoke', '--path', '.', '--json'],
    { capture: true }
  );
  if (register.code !== 0) {
    process.stderr.write(register.stderr || register.stdout);
    process.exit(register.code);
  }

  const health = await run('bun', ['run', 'cli', '--', 'health', '--json'], { capture: true });
  if (health.code !== 0) {
    process.stderr.write(health.stderr || health.stdout);
    process.exit(health.code);
  }

  const queueScan = await run(
    'bun',
    ['run', 'cli', '--', 'repo', 'scan', 'repo_smoke', '--queue', '--json'],
    { capture: true }
  );
  if (queueScan.code !== 0) {
    process.stderr.write(queueScan.stderr || queueScan.stdout);
    process.exit(queueScan.code);
  }

  const worker = await run(
    'bun',
    ['run', 'cli', '--', 'freshness', 'worker', '--watch', '--max-idle-cycles', '1', '--json'],
    { capture: true }
  );
  if (worker.code !== 0) {
    process.stderr.write(worker.stderr || worker.stdout);
    process.exit(worker.code);
  }

  const workerPayload = JSON.parse(worker.stdout);
  if (workerPayload?.data?.processed !== 1) {
    process.stderr.write(worker.stdout);
    process.exit(1);
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
  let baseUrl = '';

  serve.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    if (stdout.includes('"command":"serve"') && !settled) {
      settled = true;
    }
  });
  serve.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitPromise = new Promise<number>((resolve, reject) => {
    serve.once('error', (error) => {
      reject(error);
    });
    serve.once('exit', (code, signal) => {
      if (signal && signal !== 'SIGTERM') {
        reject(new Error(`Serve process terminated with signal ${signal}. stderr: ${stderr}`));
        return;
      }
      resolve(code ?? 0);
    });
  });

  await Promise.race([
    new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (settled) {
          clearInterval(interval);
          resolve();
        }
      }, 25);
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        serve.kill('SIGTERM');
        reject(new Error(`Timed out waiting for PostgreSQL serve output. stderr: ${stderr}`));
      }, 15000);
    }),
    exitPromise.then((code) => {
      throw new Error(`Serve process exited before readiness with code ${code}. stderr: ${stderr}`);
    }),
  ]);

  const servePayload = JSON.parse(stdout);
  baseUrl = String(servePayload?.data?.api?.baseUrl ?? '');
  if (!baseUrl) {
    process.stderr.write(stdout);
    process.exit(1);
  }

  const diagnostics = await fetch(`${baseUrl}/api/v1/admin/diagnostics`);
  if (!diagnostics.ok) {
    process.stderr.write(`Diagnostics failed: ${diagnostics.status}\n`);
    process.exit(1);
  }

  const jobs = await fetch(`${baseUrl}/api/v1/admin/jobs`);
  if (!jobs.ok) {
    process.stderr.write(`Jobs endpoint failed: ${jobs.status}\n`);
    process.exit(1);
  }

  serve.kill('SIGTERM');
  const exitCode = await exitPromise;
  if (exitCode !== 0) {
    process.stderr.write(stderr || stdout);
    process.exit(exitCode || 1);
  }

  process.stdout.write('SCBS PostgreSQL smoke passed.\n');
}

await main();
