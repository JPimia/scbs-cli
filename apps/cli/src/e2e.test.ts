import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './cli';
import { createDurableScbsService } from './durable-service';

const childProcesses: Array<ReturnType<typeof spawn>> = [];

afterEach(async () => {
  await Promise.all(
    childProcesses.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) {
            resolve();
            return;
          }

          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        })
    )
  );
});

describe('CLI happy path', () => {
  it('reports the local durable surface through init, serve, doctor, and migrate', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-surface-'));
    const service = createDurableScbsService({ cwd });

    const doctorBeforeInit = await runCli(['doctor', '--json'], service);
    expect(doctorBeforeInit.exitCode).toBe(0);
    expect(JSON.parse(doctorBeforeInit.stdout)).toMatchObject({
      data: {
        status: 'warn',
        storage: {
          adapter: 'local-json',
          configPath: 'config/scbs.config.yaml',
          statePath: '.scbs/state.json',
          stateExists: true,
        },
      },
    });

    const init = await runCli(['init', '--json'], service);
    expect(init.exitCode).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({
      data: {
        mode: 'local-durable',
        configPath: 'config/scbs.config.yaml',
        statePath: '.scbs/state.json',
        created: true,
        configCreated: true,
        stateCreated: false,
      },
    });

    const serve = await runCli(['serve', '--json'], service);
    expect(serve.exitCode).toBe(0);
    expect(JSON.parse(serve.stdout)).toMatchObject({
      data: {
        service: 'scbs',
        status: 'listening',
        api: {
          baseUrl: 'http://127.0.0.1:8791',
          apiVersion: 'v1',
          mode: 'live',
        },
        storage: {
          adapter: 'local-json',
          configPath: 'config/scbs.config.yaml',
          statePath: '.scbs/state.json',
          stateExists: true,
        },
      },
    });

    const doctorAfterInit = await runCli(['doctor', '--json'], service);
    expect(doctorAfterInit.exitCode).toBe(0);
    expect(JSON.parse(doctorAfterInit.stdout)).toMatchObject({
      data: {
        status: 'ok',
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: 'config',
            status: 'ok',
          }),
          expect.objectContaining({
            name: 'api',
            status: 'ok',
          }),
        ]),
      },
    });

    const migrate = await runCli(['migrate', '--json'], service);
    expect(migrate.exitCode).toBe(0);
    expect(JSON.parse(migrate.stdout)).toMatchObject({
      data: {
        adapter: 'local-json',
        statePath: '.scbs/state.json',
        pending: 0,
        baselineVersion: '0.1.0',
        stateCreated: false,
      },
    });

    const configContents = await readFile(path.join(cwd, 'config/scbs.config.yaml'), 'utf8');
    expect(configContents).toContain('adapter: local-json');
    expect(configContents).toContain('statePath:');
  });

  it('registers a repo and plans a bundle through the durable adapter', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-cli-'));
    const service = createDurableScbsService({ cwd });

    const register = await runCli(
      ['repo', 'register', '--name', 'demo-repo', '--path', '/tmp/demo-repo', '--json'],
      service
    );
    expect(register.exitCode).toBe(0);
    expect(JSON.parse(register.stdout)).toMatchObject({
      data: {
        id: 'repo_demo-repo',
        name: 'demo-repo',
      },
    });

    const bundle = await runCli(
      ['bundle', 'plan', '--task', 'bootstrap context', '--repo', 'repo_demo-repo', '--json'],
      service
    );
    expect(bundle.exitCode).toBe(0);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      data: {
        id: 'bundle_bootstrap-context',
        repoIds: ['repo_demo-repo'],
        task: 'bootstrap context',
      },
    });

    const nextService = createDurableScbsService({ cwd });
    const repos = await runCli(['repo', 'list', '--json'], nextService);
    expect(repos.exitCode).toBe(0);
    expect(JSON.parse(repos.stdout)).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: 'repo_demo-repo',
          name: 'demo-repo',
        }),
      ]),
    });

    const statePath = path.join(cwd, '.scbs/state.json');
    const persistedState = JSON.parse(await readFile(statePath, 'utf8'));
    expect(persistedState.bundles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'bundle_bootstrap-context' })])
    );
  });

  it('initializes config and state files for the local durable adapter', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-init-'));
    const service = createDurableScbsService({ cwd });

    const result = await runCli(['init', '--json'], service);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        configPath: 'config/scbs.config.yaml',
        statePath: '.scbs/state.json',
        created: true,
      },
    });

    const configContents = await readFile(path.join(cwd, 'config/scbs.config.yaml'), 'utf8');
    expect(configContents).toContain('adapter: local-json');
    await expect(readFile(path.join(cwd, '.scbs/state.json'), 'utf8')).resolves.toContain(
      'repo_local-default'
    );
  });

  it('starts a reachable HTTP surface for the real serve entrypoint', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-serve-'));
    const entrypoint = new URL('./index.ts', import.meta.url);
    const repoRoot = path.resolve(path.dirname(entrypoint.pathname), '../../..');
    const child = spawn('bun', ['run', entrypoint.pathname, 'serve', '--json'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SCBS_CWD: cwd,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    childProcesses.push(child);

    const stdout = await waitForServeOutput(child);
    const report = JSON.parse(stdout);

    expect(report).toMatchObject({
      ok: true,
      command: 'serve',
      data: {
        service: 'scbs',
        status: 'listening',
        api: {
          baseUrl: 'http://127.0.0.1:8791',
          apiVersion: 'v1',
          mode: 'live',
        },
      },
    });

    const healthResponse = await waitForJson('http://127.0.0.1:8791/health');
    expect(healthResponse).toMatchObject({
      status: 'ok',
      service: 'scbs',
      version: '0.1.0',
    });

    const apiRootResponse = await waitForJson('http://127.0.0.1:8791/api/v1');
    expect(apiRootResponse).toMatchObject({
      service: 'scbs',
      status: 'listening',
      api: {
        apiVersion: 'v1',
        mode: 'live',
      },
      endpoints: {
        health: '/health',
        root: '/api/v1',
      },
    });
  });
});

async function waitForServeOutput(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;

    if (!stdoutStream || !stderrStream) {
      reject(new Error('Serve process did not expose stdout/stderr pipes.'));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for serve output. stderr: ${stderr}`));
    }, 10_000);

    stdoutStream.setEncoding('utf8');
    stderrStream.setEncoding('utf8');

    stdoutStream.on('data', (chunk) => {
      stdout += chunk;
      const trimmed = stdout.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        clearTimeout(timeout);
        resolve(trimmed);
      }
    });

    stderrStream.on('data', (chunk) => {
      stderr += chunk;
    });

    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Serve process exited early with code ${code}. stderr: ${stderr}`));
    });
  });
}

async function waitForJson(url: string): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}
