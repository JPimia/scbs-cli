import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './cli';
import { DurableScbsService, createDurableScbsService } from './durable-service';

const childProcesses: Array<ReturnType<typeof spawn>> = [];
const cliEntryPath = fileURLToPath(new URL('./index.ts', import.meta.url));
const repoRoot = path.resolve(path.dirname(cliEntryPath), '../../..');
const psqlPrefix = (() => {
  const localClient = spawnSync('bash', ['-lc', 'command -v psql >/dev/null 2>&1']);
  if (localClient.status === 0) {
    return ['psql'];
  }

  const dockerClient = spawnSync('bash', ['-lc', 'command -v docker >/dev/null 2>&1']);
  return dockerClient.status === 0
    ? ['docker', 'run', '--rm', '--network', 'host', 'postgres:16', 'psql']
    : null;
})();

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

async function execPsql(args: string[], options?: { stdin?: string }) {
  if (!psqlPrefix) {
    throw new Error('PostgreSQL runtime tests require either psql or Docker.');
  }

  const child = spawn(psqlPrefix[0] as string, [...psqlPrefix.slice(1), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  if (options?.stdin) {
    child.stdin.write(options.stdin);
  }
  child.stdin.end();

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`psql exited with signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(Buffer.concat(stderr).toString('utf8').trim() || 'psql command failed');
  }

  return Buffer.concat(stdout).toString('utf8').trim();
}

async function createTemporaryPostgresDatabase() {
  const databaseUrlValue = process.env.DATABASE_URL;
  if (!databaseUrlValue) {
    throw new Error('DATABASE_URL is required for PostgreSQL runtime tests.');
  }

  const adminUrl = new URL(databaseUrlValue);
  const databaseName = `scbs_runtime_${randomUUID().replaceAll('-', '_')}`;
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.pathname = `/${databaseName}`;

  await execPsql([
    '-d',
    adminUrl.toString(),
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `CREATE DATABASE "${databaseName}";`,
  ]);

  return {
    databaseUrl: runtimeUrl.toString(),
    async query(sql: string) {
      return execPsql(['-d', runtimeUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]);
    },
    async cleanup() {
      await execPsql([
        '-d',
        adminUrl.toString(),
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        [
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();`,
          `DROP DATABASE IF EXISTS "${databaseName}";`,
        ].join(' '),
      ]);
    },
  };
}

const postgresIt = process.env.DATABASE_URL ? it : it.skip;

describe('CLI happy path', () => {
  it('reports the standalone service surface through init, serve, doctor, and migrate', async () => {
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
        diagnostics: {
          artifacts: {
            repos: 1,
            bundles: 1,
            receipts: 1,
          },
          receipts: {
            validated: 1,
          },
        },
      },
    });

    const init = await runCli(['init', '--json'], service);
    expect(init.exitCode).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({
      data: {
        mode: 'local-json',
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
          kind: 'standalone',
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
        diagnostics: {
          artifacts: {
            repos: 1,
          },
          freshness: {
            overall: 'fresh',
          },
        },
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

    const secondRegister = await runCli(
      ['repo', 'register', '--name', 'docs-repo', '--path', '/tmp/docs-repo', '--json'],
      service
    );
    expect(secondRegister.exitCode).toBe(0);
    expect(JSON.parse(secondRegister.stdout)).toMatchObject({
      data: {
        id: 'repo_docs-repo',
        name: 'docs-repo',
      },
    });

    const bundle = await runCli(
      [
        'bundle',
        'plan',
        '--task',
        'bootstrap context',
        '--repo',
        'repo_demo-repo,repo_docs-repo',
        '--json',
      ],
      service
    );
    expect(bundle.exitCode).toBe(0);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      data: {
        id: 'bundle_bootstrap-context',
        requestId: 'req_bootstrap-context',
        repoIds: ['repo_demo-repo', 'repo_docs-repo'],
        summary: 'Bundle for bootstrap context across 2 views',
      },
    });

    const childBundle = await runCli(
      [
        'bundle',
        'plan',
        '--task',
        'inherit context',
        '--repo',
        'repo_demo-repo',
        '--parent-bundle',
        'bundle_bootstrap-context',
        '--file-scope',
        'src/index.ts',
        '--json',
      ],
      service
    );
    expect(childBundle.exitCode).toBe(0);
    expect(JSON.parse(childBundle.stdout)).toMatchObject({
      data: {
        id: 'bundle_inherit-context',
        requestId: 'req_inherit-context',
        repoIds: ['repo_demo-repo'],
        summary: 'Bundle for inherit context across 1 views',
        metadata: {
          parentBundleId: 'bundle_bootstrap-context',
        },
        fileScope: ['src/index.ts'],
      },
    });

    const missingParent = await runCli(
      [
        'bundle',
        'plan',
        '--task',
        'broken inheritance',
        '--repo',
        'repo_demo-repo',
        '--parent-bundle',
        'bundle_missing',
      ],
      service
    );
    expect(missingParent.exitCode).toBe(1);
    expect(missingParent.stderr).toBe('Parent bundle "bundle_missing" was not found.');

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
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bundle_bootstrap-context',
          repoIds: ['repo_demo-repo', 'repo_docs-repo'],
        }),
      ])
    );
  });

  it('initializes config and state files for the local JSON adapter', async () => {
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

  it('enqueues and drains durable freshness recompute jobs locally', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-freshness-worker-'));
    const service = createDurableScbsService({ cwd });
    const repo = await service.registerRepo({ name: 'demo-repo', path: '/tmp/demo-repo' });
    await service.planBundle({
      repoIds: [repo.id],
      task: 'refresh me',
      fileScope: ['src/index.ts'],
    });

    const report = await runCli(
      ['repo', 'changes', repo.id, '--files', 'src/index.ts', '--json'],
      service
    );
    expect(report.exitCode).toBe(0);
    expect(JSON.parse(report.stdout)).toMatchObject({
      data: {
        repoId: repo.id,
        files: ['src/index.ts'],
        impacts: 1,
      },
    });

    await expect(service.getFreshnessStatus()).resolves.toMatchObject({
      overall: 'partial',
      staleArtifacts: 1,
    });

    const worker = await runCli(['freshness', 'worker', '--limit', '1', '--json'], service);
    expect(worker.exitCode).toBe(0);
    expect(JSON.parse(worker.stdout)).toMatchObject({
      data: {
        processed: 1,
        remaining: 0,
      },
    });

    await expect(service.getFreshnessStatus()).resolves.toMatchObject({
      overall: 'fresh',
      staleArtifacts: 0,
    });
  });

  postgresIt('persists the durable flow through the PostgreSQL adapter', async () => {
    const postgres = await createTemporaryPostgresDatabase();
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-pg-'));
    const service = new DurableScbsService({
      cwd,
      adapter: 'postgres',
      databaseUrl: postgres.databaseUrl,
    });

    try {
      const doctorBeforeInit = await runCli(['doctor', '--json'], service);
      expect(doctorBeforeInit.exitCode).toBe(0);
      expect(JSON.parse(doctorBeforeInit.stdout)).toMatchObject({
        data: {
          storage: {
            adapter: 'postgres',
            configPath: 'config/scbs.config.yaml',
            stateExists: true,
            databaseUrlConfigured: true,
          },
          diagnostics: {
            artifacts: {
              repos: 1,
            },
            receipts: {
              validated: 1,
            },
          },
        },
      });

      const init = await runCli(['init', '--json'], service);
      expect(init.exitCode).toBe(0);
      expect(JSON.parse(init.stdout)).toMatchObject({
        data: {
          mode: 'postgres',
          configPath: 'config/scbs.config.yaml',
          created: true,
          configCreated: true,
          stateCreated: false,
        },
      });

      const register = await runCli(
        ['repo', 'register', '--name', 'pg-repo', '--path', '/tmp/pg-repo', '--json'],
        service
      );
      expect(register.exitCode).toBe(0);
      expect(JSON.parse(register.stdout)).toMatchObject({
        data: {
          id: 'repo_pg-repo',
          name: 'pg-repo',
        },
      });

      const bundle = await runCli(
        [
          'bundle',
          'plan',
          '--task',
          'postgres bundle',
          '--repo',
          'repo_pg-repo',
          '--file-scope',
          'src/index.ts',
          '--json',
        ],
        service
      );
      expect(bundle.exitCode).toBe(0);
      expect(JSON.parse(bundle.stdout)).toMatchObject({
        data: {
          id: 'bundle_postgres-bundle',
          repoIds: ['repo_pg-repo'],
        },
      });

      const reportedChanges = await runCli(
        ['repo', 'changes', 'repo_pg-repo', '--files', 'src/index.ts', '--json'],
        service
      );
      expect(reportedChanges.exitCode).toBe(0);
      expect(JSON.parse(reportedChanges.stdout)).toMatchObject({
        data: {
          repoId: 'repo_pg-repo',
          files: ['src/index.ts'],
          impacts: 1,
        },
      });

      const receipt = await runCli(
        [
          'receipt',
          'submit',
          '--bundle',
          'bundle_postgres-bundle',
          '--agent',
          'postgres-agent',
          '--summary',
          'captured durable state',
          '--json',
        ],
        service
      );
      expect(receipt.exitCode).toBe(0);

      const validateReceipt = await runCli(
        ['receipt', 'validate', 'receipt_postgres-agent-captured-durable-state', '--json'],
        service
      );
      expect(validateReceipt.exitCode).toBe(0);
      expect(JSON.parse(validateReceipt.stdout)).toMatchObject({
        data: {
          id: 'receipt_postgres-agent-captured-durable-state',
          status: 'validated',
        },
      });

      const persistedService = new DurableScbsService({
        cwd,
        adapter: 'postgres',
        databaseUrl: postgres.databaseUrl,
      });

      try {
        await expect(persistedService.getFreshnessStatus()).resolves.toMatchObject({
          overall: 'partial',
          staleArtifacts: 1,
        });
        await expect(persistedService.runFreshnessWorker({ limit: 1 })).resolves.toMatchObject({
          processed: 1,
          remaining: 0,
        });
        await expect(persistedService.getFreshnessStatus()).resolves.toMatchObject({
          overall: 'fresh',
          staleArtifacts: 0,
        });
        await expect(persistedService.listRepos()).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'repo_pg-repo',
              name: 'pg-repo',
            }),
          ])
        );
        await expect(persistedService.showBundle('bundle_postgres-bundle')).resolves.toMatchObject({
          id: 'bundle_postgres-bundle',
          repoIds: ['repo_pg-repo'],
        });
        await expect(
          persistedService.showReceipt('receipt_postgres-agent-captured-durable-state')
        ).resolves.toMatchObject({
          id: 'receipt_postgres-agent-captured-durable-state',
          status: 'validated',
        });
        const claims = await persistedService.listClaims();
        expect(claims.length).toBeGreaterThan(1);
      } finally {
        await persistedService.close();
      }

      await expect(
        postgres.query("SELECT COUNT(*) FROM repositories WHERE id = 'repo_pg-repo'")
      ).resolves.toBe('1');
      await expect(postgres.query('SELECT COUNT(*) FROM freshness_events')).resolves.toBe('1');
      await expect(
        postgres.query("SELECT COUNT(*) FROM recompute_jobs WHERE status = 'completed'")
      ).resolves.toBe('1');
      await expect(
        postgres.query(
          "SELECT status FROM agent_receipts WHERE id = 'receipt_postgres-agent-captured-durable-state'"
        )
      ).resolves.toBe('validated');
      await expect(
        postgres.query("SELECT COUNT(*) FROM task_bundles WHERE id = 'bundle_postgres-bundle'")
      ).resolves.toBe('1');

      const configContents = await readFile(path.join(cwd, 'config/scbs.config.yaml'), 'utf8');
      expect(configContents).toContain('adapter: postgres');
      expect(configContents).toContain('databaseUrlEnv: SCBS_DATABASE_URL');
    } finally {
      await service.close();
      await postgres.cleanup();
    }
  });

  it('starts a reachable HTTP surface for the real serve entrypoint', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-serve-'));
    const setupService = createDurableScbsService({ cwd });
    const repo = await setupService.registerRepo({ name: 'demo-repo', path: '/tmp/demo-repo' });
    const bundle = await setupService.planBundle({
      repoIds: [repo.id],
      task: 'bootstrap context',
      fileScope: ['src/index.ts'],
    });
    await setupService.reportRepoChanges({ id: repo.id, files: ['src/index.ts'] });
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
        expireBundle: '/api/v1/bundles/:id/expire',
        listBundleCache: '/api/v1/bundles/cache',
        clearBundleCache: '/api/v1/bundles/cache/clear',
        freshnessImpacts: '/api/v1/freshness/impacts',
        freshnessStatus: '/api/v1/freshness/status',
        recomputeFreshness: '/api/v1/freshness/recompute',
        createReceipt: '/api/v1/receipts',
        listReceipts: '/api/v1/receipts',
        showReceipt: '/api/v1/receipts/:id',
        validateReceipt: '/api/v1/receipts/:id/validate',
        rejectReceipt: '/api/v1/receipts/:id/reject',
      },
    });

    const bundleResponse = await requestJson(`http://127.0.0.1:8791/api/v1/bundles/${bundle.id}`);
    expect(bundleResponse.status).toBe(200);
    expect(bundleResponse.body).toMatchObject({
      id: bundle.id,
      requestId: 'req_bootstrap-context',
      repoIds: [repo.id],
      summary: 'Bundle for bootstrap context across 1 views',
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

    const createdBundleResponse = await requestJson('http://127.0.0.1:8791/api/v1/bundles/plan', {
      method: 'POST',
      body: {
        task: 'ship api',
        repoIds: [repo.id],
        parentBundleId: bundle.id,
        fileScope: ['src/api.ts'],
      },
    });
    expect(createdBundleResponse.status).toBe(201);
    expect(createdBundleResponse.body).toMatchObject({
      id: 'bundle_ship-api',
      requestId: 'req_ship-api',
      repoIds: [repo.id],
      summary: 'Bundle for ship api across 1 views',
      freshness: 'fresh',
      metadata: {
        parentBundleId: bundle.id,
      },
      fileScope: ['src/api.ts'],
    });

    const expireBundleResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/bundles/bundle_ship-api/expire',
      {
        method: 'POST',
      }
    );
    expect(expireBundleResponse.status).toBe(200);
    expect(expireBundleResponse.body).toMatchObject({
      id: 'bundle_ship-api',
      freshness: 'expired',
    });

    const bundleCacheResponse = await requestJson('http://127.0.0.1:8791/api/v1/bundles/cache');
    expect(bundleCacheResponse.status).toBe(200);
    expect(Array.isArray(bundleCacheResponse.body)).toBe(true);
    const bundleCacheEntries = Array.isArray(bundleCacheResponse.body)
      ? bundleCacheResponse.body
      : [];
    expect(
      bundleCacheEntries.some(
        (entry) => entry.key === 'bundle:bootstrap' && entry.bundleId === 'bundle_bootstrap'
      )
    ).toBe(true);
    expect(
      bundleCacheEntries.some(
        (entry) => entry.key === 'bundle:bootstrap-context' && entry.bundleId === bundle.id
      )
    ).toBe(true);
    expect(
      bundleCacheEntries.some(
        (entry) =>
          entry.key === 'bundle:ship-api' &&
          entry.bundleId === 'bundle_ship-api' &&
          entry.freshness === 'fresh'
      )
    ).toBe(true);

    const clearBundleCacheResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/bundles/cache/clear',
      {
        method: 'POST',
      }
    );
    expect(clearBundleCacheResponse.status).toBe(200);
    expect(clearBundleCacheResponse.body).toMatchObject({
      cleared: bundleCacheEntries.length,
    });

    const bundleCacheAfterClearResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/bundles/cache'
    );
    expect(bundleCacheAfterClearResponse.status).toBe(200);
    expect(bundleCacheAfterClearResponse.body).toEqual([]);

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

    const missingParentResponse = await requestJson('http://127.0.0.1:8791/api/v1/bundles/plan', {
      method: 'POST',
      body: { task: 'missing parent', repoIds: [repo.id], parentBundleId: 'bundle_missing' },
    });
    expect(missingParentResponse.status).toBe(404);
    expect(missingParentResponse.body).toMatchObject({
      error: 'Not Found',
      message: 'Parent bundle "bundle_missing" was not found.',
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

    const validateReceiptResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/receipts/receipt_agent-1-submitted-proof/validate',
      {
        method: 'POST',
      }
    );
    expect(validateReceiptResponse.status).toBe(200);
    expect(validateReceiptResponse.body).toMatchObject({
      id: 'receipt_agent-1-submitted-proof',
      status: 'validated',
    });

    const persistedService = createDurableScbsService({ cwd });
    const claimsAfterValidation = await persistedService.listClaims();
    expect(claimsAfterValidation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claim_from_receipt_agent-1-submitted-proof',
          repoId: repo.id,
          statement: 'submitted proof',
          trustTier: 'human',
          freshness: 'partial',
          metadata: expect.objectContaining({
            claimKind: 'validated_receipt',
            receiptId: 'receipt_agent-1-submitted-proof',
          }),
          invalidationKeys: ['src/index.ts'],
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            claimKind: 'receipt_file_observation',
            receiptId: 'receipt_agent-1-submitted-proof',
            filePath: 'src/index.ts',
          }),
        }),
      ])
    );

    const viewsAfterValidation = await persistedService.listViews();
    expect(viewsAfterValidation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repoId: repo.id,
          claimIds: expect.arrayContaining(['claim_from_receipt_agent-1-submitted-proof']),
          freshness: 'partial',
          name: 'src/index.ts',
          fileScope: ['src/index.ts'],
        }),
      ])
    );

    const persistedStateAfterValidate = JSON.parse(
      await readFile(path.join(cwd, '.scbs/state.json'), 'utf8')
    );
    expect(persistedStateAfterValidate.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'receipt_agent-1-submitted-proof',
          status: 'validated',
        }),
      ])
    );
    expect(persistedStateAfterValidate.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claim_from_receipt_agent-1-submitted-proof',
          repoId: repo.id,
          statement: 'submitted proof',
          metadata: expect.objectContaining({
            receiptId: 'receipt_agent-1-submitted-proof',
            bundleId: bundle.id,
            claimKind: 'validated_receipt',
          }),
        }),
      ])
    );
    expect(persistedStateAfterValidate.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repoId: repo.id,
          claimIds: expect.arrayContaining(['claim_from_receipt_agent-1-submitted-proof']),
        }),
      ])
    );

    const rejectedReceiptResponse = await requestJson('http://127.0.0.1:8791/api/v1/receipts', {
      method: 'POST',
      body: { bundle: bundle.id, agent: 'agent-2', summary: 'failed proof' },
    });
    expect(rejectedReceiptResponse.status).toBe(201);
    expect(rejectedReceiptResponse.body).toMatchObject({
      id: 'receipt_agent-2-failed-proof',
      status: 'pending',
    });

    const rejectReceiptResponse = await requestJson(
      'http://127.0.0.1:8791/api/v1/receipts/receipt_agent-2-failed-proof/reject',
      {
        method: 'POST',
      }
    );
    expect(rejectReceiptResponse.status).toBe(200);
    expect(rejectReceiptResponse.body).toMatchObject({
      id: 'receipt_agent-2-failed-proof',
      status: 'rejected',
    });

    const persistedServiceAfterReject = createDurableScbsService({ cwd });
    await expect(persistedServiceAfterReject.listClaims()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claim_from_receipt_agent-2-failed-proof',
        }),
      ])
    );

    const persistedStateAfterReject = JSON.parse(
      await readFile(path.join(cwd, '.scbs/state.json'), 'utf8')
    );
    expect(persistedStateAfterReject.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'receipt_agent-2-failed-proof',
          status: 'rejected',
        }),
      ])
    );
    expect(persistedStateAfterReject.claims).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claim_from_receipt_agent-2-failed-proof',
        }),
      ])
    );
    expect(
      persistedStateAfterReject.views.some((view: { claimIds?: string[] }) =>
        view.claimIds?.includes('claim_from_receipt_agent-2-failed-proof')
      )
    ).toBe(false);

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
