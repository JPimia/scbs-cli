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
    const setupService = createDurableScbsService({ cwd });
    const repo = await setupService.registerRepo({ name: 'demo-repo', path: '/tmp/demo-repo' });
    const bundle = await setupService.planBundle({
      repoId: repo.id,
      task: 'bootstrap context',
    });
    await setupService.expireBundle(bundle.id);
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
        planBundle: '/api/v1/bundles/plan',
        showBundle: '/api/v1/bundles/:id',
        bundleFreshness: '/api/v1/bundles/:id/freshness',
        freshnessImpacts: '/api/v1/freshness/impacts',
        freshnessStatus: '/api/v1/freshness/status',
        recomputeFreshness: '/api/v1/freshness/recompute',
        createReceipt: '/api/v1/receipts',
        listReceipts: '/api/v1/receipts',
        showReceipt: '/api/v1/receipts/:id',
      },
    });

    const bundleResponse = await requestJson(`http://127.0.0.1:8791/api/v1/bundles/${bundle.id}`);
    expect(bundleResponse.status).toBe(200);
    expect(bundleResponse.body).toMatchObject({
      id: bundle.id,
      repoIds: [repo.id],
      task: 'bootstrap context',
      freshness: 'expired',
    });

    const malformedBundleResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/bundles/%E0%A4%A'
    );
    expect(malformedBundleResponse.status).toBe(400);
    expect(malformedBundleResponse.body).toMatchObject({
      error: 'Bad Request',
      message: 'Route parameter contains invalid percent-encoding.',
    });

    const bundleFreshnessResponse = await requestJson(
      `http://127.0.0.1:8791/api/v1/bundles/${bundle.id}/freshness`
    );
    expect(bundleFreshnessResponse.status).toBe(200);
    expect(bundleFreshnessResponse.body).toMatchObject({
      bundleId: bundle.id,
      freshness: 'expired',
    });

    const freshnessImpactsResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/freshness/impacts'
    );
    expect(freshnessImpactsResponse.status).toBe(200);
    expect(freshnessImpactsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: 'bundle',
          artifactId: bundle.id,
          state: 'expired',
        }),
      ])
    );

    const freshnessStatusBefore = await requestJson(
      'http://127.0.0.1:8791/api/v1/freshness/status'
    );
    expect(freshnessStatusBefore.status).toBe(200);
    expect(freshnessStatusBefore.body).toMatchObject({
      overall: 'partial',
      staleArtifacts: 1,
    });

    const recomputeResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/freshness/recompute',
      {
        method: 'POST',
      }
    );
    expect(recomputeResponse.status).toBe(200);
    expect(recomputeResponse.body).toMatchObject({
      updated: 1,
    });

    const freshnessStatusAfter = await requestJson('http://127.0.0.1:8791/api/v1/freshness/status');
    expect(freshnessStatusAfter.status).toBe(200);
    expect(freshnessStatusAfter.body).toMatchObject({
      overall: 'fresh',
      staleArtifacts: 0,
    });

    const createdBundleResponse = await requestJson('http://127.0.0.1:8791/api/v1/bundles/plan', {
      method: 'POST',
      body: { task: 'ship api', repo: repo.id },
    });
    expect(createdBundleResponse.status).toBe(201);
    expect(createdBundleResponse.body).toMatchObject({
      id: 'bundle_ship-api',
      repoIds: [repo.id],
      task: 'ship api',
      freshness: 'fresh',
    });

    const createdReceiptResponse = await requestJson('http://127.0.0.1:8791/api/v1/receipts', {
      method: 'POST',
      body: { bundle: bundle.id, agent: 'agent-1', summary: 'submitted proof' },
    });
    expect(createdReceiptResponse.status).toBe(201);
    expect(createdReceiptResponse.body).toMatchObject({
      id: 'receipt_agent-1-submitted-proof',
      bundleId: bundle.id,
      agent: 'agent-1',
      summary: 'submitted proof',
      status: 'pending',
    });

    const receiptsResponse = await requestJson('http://127.0.0.1:8791/api/v1/receipts');
    expect(receiptsResponse.status).toBe(200);
    expect(receiptsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'receipt_agent-1-submitted-proof',
          bundleId: bundle.id,
        }),
      ])
    );

    const receiptResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/receipts/receipt_agent-1-submitted-proof'
    );
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.body).toMatchObject({
      id: 'receipt_agent-1-submitted-proof',
      agent: 'agent-1',
      summary: 'submitted proof',
    });

    const invalidJsonResponse = await requestJson('http://127.0.0.1:8791/api/v1/bundles/plan', {
      method: 'POST',
      rawBody: '{bad json',
      headers: { 'content-type': 'application/json' },
    });
    expect(invalidJsonResponse.status).toBe(400);
    expect(invalidJsonResponse.body).toMatchObject({
      error: 'Bad Request',
      message: 'Request body must be valid JSON.',
    });

    const missingBundleFieldsResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/bundles/plan',
      {
        method: 'POST',
        body: { repo: repo.id },
      }
    );
    expect(missingBundleFieldsResponse.status).toBe(400);
    expect(missingBundleFieldsResponse.body).toMatchObject({
      error: 'Bad Request',
      message: 'Missing required field "task".',
    });

    const missingReceiptFieldsResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/receipts',
      {
        method: 'POST',
        body: { summary: 'missing agent' },
      }
    );
    expect(missingReceiptFieldsResponse.status).toBe(400);
    expect(missingReceiptFieldsResponse.body).toMatchObject({
      error: 'Bad Request',
      message: 'Missing required field "agent".',
    });

    const methodMismatchResponse = await requestJson('http://127.0.0.1:8791/api/v1/receipts', {
      method: 'DELETE',
    });
    expect(methodMismatchResponse.status).toBe(405);
    expect(methodMismatchResponse.body).toMatchObject({
      error: 'Method Not Allowed',
      message: 'No route for DELETE /api/v1/receipts',
    });

    const unknownRouteResponse = await requestJson('http://127.0.0.1:8791/api/v1/nope');
    expect(unknownRouteResponse.status).toBe(404);
    expect(unknownRouteResponse.body).toMatchObject({
      error: 'Not Found',
      message: 'No route for GET /api/v1/nope',
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
  const response = await requestJson(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Unexpected status ${response.status}`);
  }

  return response.body;
}

async function requestJson(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: unknown }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const headers = new Headers(options.headers);
      let body: string | undefined;

      if (options.rawBody !== undefined) {
        body = options.rawBody;
      } else if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
      }

      const response = await fetch(url, {
        method: options.method,
        headers,
        body,
      });

      return {
        status: response.status,
        body: await response.json(),
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}
