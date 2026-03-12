import { type ChildProcess, spawn, spawnSync } from 'node:child_process';

const cwd = process.env.SCBS_CWD ?? process.cwd();
const scbsBaseUrl = process.env.SCBS_BASE_URL ?? 'http://127.0.0.1:8791';
const databaseUrl =
  process.env.SCBS_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@127.0.0.1:5432/scbs';
const startPostgres = process.env.SCBS_PLATFORM_START_POSTGRES !== '0';
const skipMigrate = process.env.SCBS_PLATFORM_SKIP_MIGRATE === '1';
const reuseRunning = process.env.SCBS_PLATFORM_REUSE_RUNNING !== '0';
const pollIntervalMs = Number(process.env.SCBS_PLATFORM_POLL_INTERVAL_MS ?? '500');
const sisuStartCommand = process.env.SISU_START_COMMAND;
const missionControlStartCommand = process.env.MISSION_CONTROL_START_COMMAND;

const children: ChildProcess[] = [];

function log(message: string) {
  process.stdout.write(`[platform-up] ${message}\n`);
}

function logError(message: string) {
  process.stderr.write(`[platform-up] ${message}\n`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function commandExists(command: string): boolean {
  return (
    spawnSync('bash', ['-lc', `command -v ${command} >/dev/null 2>&1`], {
      cwd,
      stdio: 'ignore',
    }).status === 0
  );
}

function createEnv() {
  return {
    ...process.env,
    SCBS_STORAGE_ADAPTER: 'postgres',
    SCBS_DATABASE_URL: databaseUrl,
  };
}

async function run(command: string, args: string[], name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: createEnv(),
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${name} terminated with signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`${name} exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

function spawnManaged(command: string, args: string[], name: string): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: createEnv(),
    stdio: 'inherit',
  });
  children.push(child);

  child.once('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    logError(`${name} exited unexpectedly with ${detail}.`);
    shutdown(1).catch((error) => {
      logError(String(error));
      process.exit(1);
    });
  });

  return child;
}

function spawnShellManaged(command: string, name: string): ChildProcess {
  const child = spawn('bash', ['-lc', command], {
    cwd,
    env: createEnv(),
    stdio: 'inherit',
  });
  children.push(child);

  child.once('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    logError(`${name} exited unexpectedly with ${detail}.`);
    shutdown(1).catch((error) => {
      logError(String(error));
      process.exit(1);
    });
  });

  return child;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {}
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for SCBS health at ${url}/health`);
}

async function startPostgresIfNeeded(): Promise<void> {
  if (!startPostgres) {
    log('Skipping PostgreSQL startup by configuration.');
    return;
  }
  if (!commandExists('docker')) {
    throw new Error('Docker is required to auto-start PostgreSQL, but it was not found.');
  }

  log('Starting PostgreSQL via compose.scbs-postgres.yaml.');
  await run('docker', ['compose', '-f', 'compose.scbs-postgres.yaml', 'up', '-d'], 'postgres');
}

let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  log('Shutting down managed child processes.');
  for (const child of children) {
    if (child.killed || child.exitCode !== null) {
      continue;
    }
    child.kill('SIGTERM');
  }

  await sleep(750);

  for (const child of children) {
    if (child.killed || child.exitCode !== null) {
      continue;
    }
    child.kill('SIGKILL');
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => {
  shutdown(0).catch((error) => {
    logError(String(error));
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown(0).catch((error) => {
    logError(String(error));
    process.exit(1);
  });
});

async function main() {
  log(`Using SCBS base URL ${scbsBaseUrl}`);
  log(`Using SCBS database ${databaseUrl}`);

  const alreadyHealthy = reuseRunning
    ? await (async () => {
        try {
          const response = await fetch(`${scbsBaseUrl}/health`);
          return response.ok;
        } catch {
          return false;
        }
      })()
    : false;

  if (alreadyHealthy) {
    log('SCBS API already appears healthy; reusing existing SCBS stack.');
  } else {
    await startPostgresIfNeeded();

    if (!skipMigrate) {
      log('Running SCBS migrations.');
      await run('bun', ['run', 'cli', '--', 'migrate', '--json'], 'scbs migrate');
    } else {
      log('Skipping SCBS migration by configuration.');
    }

    log('Starting SCBS API.');
    spawnManaged('bun', ['run', 'cli', '--', 'serve', '--json'], 'scbs-api');

    await waitForHealth(scbsBaseUrl, 15_000);
    log('SCBS API is healthy.');

    log('Starting SCBS worker.');
    spawnManaged(
      'bun',
      [
        'run',
        'cli',
        '--',
        'freshness',
        'worker',
        '--watch',
        '--poll-interval-ms',
        String(pollIntervalMs),
        '--json',
      ],
      'scbs-worker'
    );
  }

  if (sisuStartCommand) {
    log(`Starting SISU with command: ${sisuStartCommand}`);
    spawnShellManaged(sisuStartCommand, 'sisu');
  } else {
    log('SISU_START_COMMAND not set; not starting SISU.');
  }

  if (missionControlStartCommand) {
    log(`Starting Mission Control with command: ${missionControlStartCommand}`);
    spawnShellManaged(missionControlStartCommand, 'mission-control-web');
  } else {
    log('MISSION_CONTROL_START_COMMAND not set; not starting Mission Control web.');
  }

  log('Platform is up. Press Ctrl+C to stop managed processes.');

  await new Promise(() => {});
}

await main().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  shutdown(1).catch((shutdownError) => {
    logError(String(shutdownError));
    process.exit(1);
  });
});
