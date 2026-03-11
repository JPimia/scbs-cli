import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCoreServices, planBundle as planCoreBundle } from '../../../packages/core/src/index';
import { runCli } from './cli';
import { DurableScbsService } from './durable-service';
import { InMemoryScbsService } from './in-memory-service';

describe('CLI parsing', () => {
  it('returns JSON for commands with --json', async () => {
    const result = await runCli(['health', '--json'], new InMemoryScbsService());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'health',
      data: {
        status: 'ok',
      },
    });
  });

  it('requires mandatory options for repo register', async () => {
    const result = await runCli(['repo', 'register', '--name', 'demo'], new InMemoryScbsService());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--path');
  });

  it('parses csv options for repo changes', async () => {
    const service = new InMemoryScbsService();
    const result = await runCli(
      ['repo', 'changes', 'repo_local-default', '--files', 'src/a.ts,src/b.ts', '--json'],
      service
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        repoId: 'repo_local-default',
        impacts: 2,
      },
    });
  });

  it('surfaces the operator-facing live API contract for serve', async () => {
    const result = await runCli(['serve', '--json'], new InMemoryScbsService());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'serve',
      data: {
        service: 'scbs',
        status: 'listening',
        api: {
          kind: 'local-durable',
          apiVersion: 'v1',
          mode: 'live',
        },
        storage: {
          adapter: 'local-json',
          configPath: 'config/scbs.config.yaml',
          statePath: '.scbs/state.json',
        },
      },
    });
  });

  it('uses core planner semantics for postgres bundle planning', async () => {
    const services = createCoreServices();
    const repoAlpha = services.repositories.register({ name: 'alpha', rootPath: '/tmp/alpha' });
    const repoBeta = services.repositories.register({ name: 'beta', rootPath: '/tmp/beta' });

    services.store.facts = [
      {
        id: 'fact_alpha_command',
        repoId: repoAlpha.id,
        type: 'script_command',
        subjectType: 'script',
        subjectId: 'alpha-pkg',
        value: { path: 'package.json', command: 'bun test --filter alpha' },
        anchors: [{ repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' }],
        versionStamp: 'hash-alpha',
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fact_beta_command',
        repoId: repoBeta.id,
        type: 'script_command',
        subjectType: 'script',
        subjectId: 'beta-pkg',
        value: { path: 'package.json', command: 'bun test --filter beta' },
        anchors: [{ repoId: repoBeta.id, filePath: 'src/shared.ts', fileHash: 'hash-beta' }],
        versionStamp: 'hash-beta',
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.claims = [
      {
        id: 'claim_alpha',
        repoId: repoAlpha.id,
        text: 'alpha shared implementation matters',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_alpha_command'],
        anchors: [{ repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' }],
        freshness: 'fresh',
        invalidationKeys: ['src/shared.ts'],
        metadata: { filePath: 'src/shared.ts', symbolName: 'sharedSymbol' },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'claim_beta',
        repoId: repoBeta.id,
        text: 'beta shared implementation matters',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_beta_command'],
        anchors: [{ repoId: repoBeta.id, filePath: 'src/shared.ts', fileHash: 'hash-beta' }],
        freshness: 'expired',
        invalidationKeys: ['src/shared.ts'],
        metadata: { filePath: 'src/shared.ts', symbolName: 'sharedSymbol' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_alpha',
        repoId: repoAlpha.id,
        type: 'file_scope',
        key: `${repoAlpha.id}:src/shared.ts`,
        title: 'Alpha shared scope',
        summary: 'alpha shared implementation',
        claimIds: ['claim_alpha'],
        fileScope: ['src/shared.ts'],
        symbolScope: ['sharedSymbol'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'view_beta',
        repoId: repoBeta.id,
        type: 'file_scope',
        key: `${repoBeta.id}:src/shared.ts`,
        title: 'Beta shared scope',
        summary: 'beta shared implementation',
        claimIds: ['claim_beta'],
        fileScope: ['src/shared.ts'],
        symbolScope: ['sharedSymbol'],
        freshness: 'expired',
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.bundles.push({
      id: 'bundle_parent_multi',
      requestId: 'req_parent_multi',
      repoIds: [repoAlpha.id, repoBeta.id],
      summary: 'Parent multi-repo bundle',
      selectedViewIds: ['view_alpha', 'view_beta'],
      selectedClaimIds: ['claim_alpha', 'claim_beta'],
      fileScope: ['src/shared.ts'],
      symbolScope: ['sharedSymbol'],
      commands: ['bun test --filter alpha', 'bun test --filter beta'],
      proofHandles: [
        { repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' },
        { repoId: repoBeta.id, filePath: 'src/shared.ts', fileHash: 'hash-beta' },
      ],
      freshness: 'expired',
      cacheKey: 'parent-multi',
      metadata: {},
      createdAt: '',
    });

    const service = new DurableScbsService();
    const pgService = service as unknown as {
      resolvePostgresBackend: () => Promise<{ kind: 'postgres'; connectionString: string }>;
      withPostgresMutation: <T>(
        backend: { kind: 'postgres'; connectionString: string },
        run: (store: ReturnType<typeof createCoreServices>['store']) => Promise<T>
      ) => Promise<T>;
    };
    pgService.resolvePostgresBackend = async () => ({
      kind: 'postgres',
      connectionString: 'postgres://test/scbs',
    });
    pgService.withPostgresMutation = async (_backend, run) => run(services.store);

    const bundle = await service.planBundle({
      task: 'Ship alpha changes',
      repoIds: [repoAlpha.id],
      fileScope: ['src/shared.ts'],
      parentBundleId: 'bundle_parent_multi',
    });

    expect(bundle.viewIds).toEqual(['view_alpha']);
    expect(bundle.fileScope).toEqual(['src/shared.ts']);
    expect(bundle.commands).toEqual(['bun test --filter alpha']);
    expect(bundle.proofHandles).toEqual([
      { repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' },
    ]);
    expect(bundle.warnings).toEqual([]);
  });

  it('keeps repo-change invalidation scoped to the changed repository', async () => {
    const services = createCoreServices();
    const repoAlpha = services.repositories.register({ name: 'alpha', rootPath: '/tmp/alpha' });
    const repoBeta = services.repositories.register({ name: 'beta', rootPath: '/tmp/beta' });

    services.store.facts = [
      {
        id: 'fact_alpha',
        repoId: repoAlpha.id,
        type: 'file_hash',
        subjectType: 'file',
        subjectId: 'file_alpha',
        value: {},
        anchors: [{ repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' }],
        versionStamp: 'hash-alpha',
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fact_beta',
        repoId: repoBeta.id,
        type: 'file_hash',
        subjectType: 'file',
        subjectId: 'file_beta',
        value: {},
        anchors: [{ repoId: repoBeta.id, filePath: 'src/shared.ts', fileHash: 'hash-beta' }],
        versionStamp: 'hash-beta',
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.claims = [
      {
        id: 'claim_alpha',
        repoId: repoAlpha.id,
        text: 'alpha shared implementation',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_alpha'],
        anchors: [{ repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' }],
        freshness: 'fresh',
        invalidationKeys: ['src/shared.ts'],
        metadata: { filePath: 'src/shared.ts', symbolName: 'shared' },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'claim_beta',
        repoId: repoBeta.id,
        text: 'beta shared implementation',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_beta'],
        anchors: [{ repoId: repoBeta.id, filePath: 'src/shared.ts', fileHash: 'hash-beta' }],
        freshness: 'fresh',
        invalidationKeys: ['src/shared.ts'],
        metadata: { filePath: 'src/shared.ts', symbolName: 'shared' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_alpha',
        repoId: repoAlpha.id,
        type: 'file_scope',
        key: `${repoAlpha.id}:src/shared.ts`,
        title: 'Alpha shared scope',
        summary: 'alpha shared implementation',
        claimIds: ['claim_alpha'],
        fileScope: ['src/shared.ts'],
        symbolScope: ['shared'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'view_beta',
        repoId: repoBeta.id,
        type: 'file_scope',
        key: `${repoBeta.id}:src/shared.ts`,
        title: 'Beta shared scope',
        summary: 'beta shared implementation',
        claimIds: ['claim_beta'],
        fileScope: ['src/shared.ts'],
        symbolScope: ['shared'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const alphaBundle = planCoreBundle(services, {
      id: 'req_alpha',
      taskTitle: 'Inspect alpha',
      repoIds: [repoAlpha.id],
      fileScope: ['src/shared.ts'],
      constraints: { includeProofHandles: true },
    });
    const betaBundle = planCoreBundle(services, {
      id: 'req_beta',
      taskTitle: 'Inspect beta',
      repoIds: [repoBeta.id],
      fileScope: ['src/shared.ts'],
      constraints: { includeProofHandles: true },
    });

    const service = new DurableScbsService();
    const pgService = service as unknown as {
      resolvePostgresBackend: () => Promise<{ kind: 'postgres'; connectionString: string }>;
      withPostgresMutation: <T>(
        backend: { kind: 'postgres'; connectionString: string },
        run: (store: ReturnType<typeof createCoreServices>['store']) => Promise<T>
      ) => Promise<T>;
    };
    pgService.resolvePostgresBackend = async () => ({
      kind: 'postgres',
      connectionString: 'postgres://test/scbs',
    });
    pgService.withPostgresMutation = async (_backend, run) => run(services.store);

    const result = await service.reportRepoChanges({
      id: repoBeta.id,
      files: ['src/shared.ts'],
    });

    expect(result.impacts).toBe(1);
    expect(
      services.store.bundles.find((bundle) => bundle.id === alphaBundle.bundle.id)?.freshness
    ).toBe('fresh');
    expect(
      services.store.bundles.find((bundle) => bundle.id === betaBundle.bundle.id)?.freshness
    ).toBe('expired');
  });

  it('does not downgrade configured postgres failures to local-json fallback', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'scbs-durable-'));
    await mkdir(path.join(cwd, 'config'), { recursive: true });
    await writeFile(
      path.join(cwd, 'config/scbs.config.yaml'),
      'storage:\n  adapter: postgres\n  databaseUrl: postgres://configured/scbs\n'
    );

    const service = new DurableScbsService({
      cwd,
      databaseUrl: 'postgres://configured/scbs',
    });
    const pgService = service as unknown as {
      initializePostgresBackend: () => Promise<never>;
    };
    pgService.initializePostgresBackend = async () => {
      throw new Error('connect failed');
    };

    await expect(service.serve()).rejects.toThrow(
      'PostgreSQL durable storage initialization failed: connect failed'
    );
  });
});
