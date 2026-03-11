import { describe, expect, it } from 'vitest';
import { runCli } from './cli';
import { InMemoryScbsService, type SeedState } from './in-memory-service';

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
        files: ['src/a.ts', 'src/b.ts'],
        impacts: 0,
      },
    });
  });

  it('queues repo scans and receipt validation for the worker when requested', async () => {
    const repoId = 'repo_queue';
    const service = new InMemoryScbsService({
      repos: [
        {
          id: repoId,
          name: 'queue',
          path: '.',
          status: 'registered',
          lastScannedAt: null,
        },
      ],
      facts: [],
      claims: [],
      views: [],
      bundles: [
        {
          id: 'bundle_queue',
          repoIds: [repoId],
          task: 'queued',
          viewIds: [],
          freshness: 'fresh',
          fileScope: ['src/index.ts'],
          symbolScope: [],
        },
      ],
      receipts: [
        {
          id: 'receipt_queue',
          bundleId: 'bundle_queue',
          agent: 'agent',
          summary: 'queued validation',
          status: 'pending',
          repoIds: [repoId],
          type: 'workflow_note',
          fromRole: 'agent',
          payload: {},
          createdAt: '',
          updatedAt: '',
        },
      ],
      bundleCache: [],
      freshnessEvents: [],
      freshnessJobs: [],
    } as unknown as SeedState);

    const queuedScan = await runCli(['repo', 'scan', repoId, '--queue', '--json'], service);
    expect(queuedScan.exitCode).toBe(0);
    expect(JSON.parse(queuedScan.stdout)).toMatchObject({
      data: {
        id: repoId,
        status: 'registered',
      },
    });

    const queuedReceipt = await runCli(
      ['receipt', 'validate', 'receipt_queue', '--queue', '--json'],
      service
    );
    expect(queuedReceipt.exitCode).toBe(0);
    expect(JSON.parse(queuedReceipt.stdout)).toMatchObject({
      data: {
        id: 'receipt_queue',
        status: 'pending',
      },
    });

    const queuedDoctor = await runCli(['doctor', '--json'], service);
    expect(JSON.parse(queuedDoctor.stdout)).toMatchObject({
      data: {
        diagnostics: {
          freshness: {
            pendingJobs: 2,
          },
        },
      },
    });

    const worker = await runCli(['freshness', 'worker', '--json'], service);
    expect(worker.exitCode).toBe(0);
    expect(JSON.parse(worker.stdout)).toMatchObject({
      data: {
        processed: 2,
        remaining: 0,
      },
    });

    expect((await service.showRepo(repoId)).status).toBe('scanned');
    expect((await service.showReceipt('receipt_queue')).status).toBe('validated');
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
          kind: 'standalone',
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

  it('preserves richer graph-derived views when receipt validation rebuilds repo views', async () => {
    const repoId = 'repo_graph';
    const seedState = {
      repos: [
        {
          id: repoId,
          name: 'graph',
          path: '.',
          status: 'scanned',
          lastScannedAt: null,
        },
      ],
      facts: [],
      claims: [
        {
          id: 'claim_interface',
          repoId,
          statement: 'src/index.ts exports hello',
          factIds: ['fact_symbol'],
          freshness: 'fresh',
          text: 'src/index.ts exports hello',
          type: 'observed',
          confidence: 1,
          trustTier: 'source',
          anchors: [
            {
              repoId,
              filePath: 'src/index.ts',
              fileHash: 'hash-src',
              symbolId: 'symbol_hello',
            },
          ],
          invalidationKeys: ['src/index.ts'],
          metadata: {
            filePath: 'src/index.ts',
            claimKind: 'file_interface',
            symbolNames: ['hello'],
            edgeIds: ['edge_contains'],
          },
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'claim_import',
          repoId,
          statement: 'src/index.ts imports node:fs/promises',
          factIds: ['fact_import'],
          freshness: 'fresh',
          text: 'src/index.ts imports node:fs/promises',
          type: 'observed',
          confidence: 1,
          trustTier: 'source',
          anchors: [{ repoId, filePath: 'src/index.ts', fileHash: 'hash-src' }],
          invalidationKeys: ['src/index.ts'],
          metadata: {
            filePath: 'src/index.ts',
            claimKind: 'file_import',
            importPath: 'node:fs/promises',
            isExternal: true,
          },
          createdAt: '',
          updatedAt: '',
        },
      ],
      views: [
        {
          id: 'view_interface',
          repoId,
          name: 'Interface src/index.ts',
          claimIds: ['claim_interface'],
          freshness: 'fresh',
          type: 'interface',
          key: 'src/index.ts',
          title: 'Interface src/index.ts',
          summary: 'existing interface view',
          fileScope: ['src/index.ts'],
          symbolScope: ['hello'],
          metadata: {},
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'view_subsystem',
          repoId,
          name: 'Subsystem src',
          claimIds: ['claim_interface', 'claim_import'],
          freshness: 'fresh',
          type: 'subsystem',
          key: 'src',
          title: 'Subsystem src',
          summary: 'existing subsystem view',
          fileScope: ['src/index.ts'],
          symbolScope: ['hello'],
          metadata: {},
          createdAt: '',
          updatedAt: '',
        },
      ],
      bundles: [
        {
          id: 'bundle_graph',
          repoIds: [repoId],
          task: 'graph bundle',
          viewIds: ['view_interface', 'view_subsystem'],
          freshness: 'fresh',
          fileScope: ['src/index.ts'],
          symbolScope: ['hello'],
        },
      ],
      receipts: [
        {
          id: 'receipt_graph',
          bundleId: 'bundle_graph',
          agent: 'agent-1',
          summary: 'validated graph proof',
          status: 'pending',
        },
      ],
      bundleCache: [],
      files: [
        {
          id: 'file_src_index',
          repoId,
          path: 'src/index.ts',
          hash: 'hash-src',
          language: 'typescript',
          versionStamp: 'hash-src',
          scannedAt: '',
        },
      ],
      symbols: [
        {
          id: 'symbol_hello',
          repoId,
          fileId: 'file_src_index',
          name: 'hello',
          kind: 'function',
          exported: true,
          signature: 'function hello(): string',
          line: 1,
          column: 1,
        },
      ],
      edges: [
        {
          id: 'edge_contains',
          repoId,
          fromType: 'file',
          fromId: 'file_src_index',
          toType: 'symbol',
          toId: 'symbol_hello',
          edgeType: 'contains',
        },
        {
          id: 'edge_imports',
          repoId,
          fromType: 'file',
          fromId: 'file_src_index',
          toType: 'file',
          toId: 'dep_node_fs_promises',
          edgeType: 'imports',
          metadata: { importPath: 'node:fs/promises', isExternal: true },
        },
      ],
    } as unknown as SeedState;

    const service = new InMemoryScbsService(seedState);
    await service.validateReceipt('receipt_graph');

    const views = (await service.listViews()) as Array<
      Awaited<ReturnType<InMemoryScbsService['listViews']>>[number] & {
        type?: string;
        fileScope?: string[];
      }
    >;
    expect(views.some((view) => view.repoId === repoId && view.type === 'interface')).toBe(true);
    expect(views.some((view) => view.repoId === repoId && view.type === 'subsystem')).toBe(true);
    expect(
      views.some(
        (view) =>
          view.repoId === repoId &&
          view.claimIds.includes('claim_from_receipt_graph') &&
          view.fileScope?.includes('src/index.ts')
      )
    ).toBe(true);
  });
});
