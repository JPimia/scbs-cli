import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCoreServices, planBundle, registerAndScanRepository } from './index';

describe('core services', () => {
  it('registers, scans, derives, plans bundles, and caches them', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'scbs-core-'));
    await mkdir(path.join(rootPath, 'src'), { recursive: true });
    await writeFile(
      path.join(rootPath, 'package.json'),
      JSON.stringify({ scripts: { test: 'bun test' } })
    );
    await writeFile(path.join(rootPath, 'src/index.ts'), 'export const version = "1";');

    const { repository, services } = await registerAndScanRepository({
      name: 'fixture',
      rootPath,
    });

    expect(services.store.files.length).toBe(2);
    expect(services.store.claims.length).toBeGreaterThan(0);
    expect(services.store.views.length).toBeGreaterThan(0);

    const result = planBundle(services, {
      id: 'req_1',
      taskTitle: 'Inspect fixture',
      repoIds: [repository.id],
      fileScope: ['src/index.ts'],
      constraints: { includeCommands: true },
    });

    expect(result.bundle.fileScope).toContain('src/index.ts');
    expect(services.cache.get(result.bundle.cacheKey ?? '')?.id).toBe(result.bundle.id);
  });

  it('transitions freshness and receipt lifecycle', async () => {
    const services = createCoreServices();
    const repo = services.repositories.register({ name: 'manual', rootPath: '/tmp/manual' });
    services.store.facts.push({
      id: 'fact_1',
      repoId: repo.id,
      type: 'file_hash',
      subjectType: 'file',
      subjectId: 'file_1',
      value: { path: 'src/index.ts' },
      anchors: [{ repoId: repo.id, filePath: 'src/index.ts', fileHash: 'abc' }],
      versionStamp: 'abc',
      freshness: 'fresh',
      createdAt: '',
      updatedAt: '',
    });
    services.store.claims = [
      {
        id: 'claim_1',
        repoId: repo.id,
        text: 'src/index.ts is important',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_1'],
        anchors: [{ repoId: repo.id, filePath: 'src/index.ts', fileHash: 'abc' }],
        freshness: 'fresh',
        invalidationKeys: ['src/index.ts'],
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_1',
        repoId: repo.id,
        type: 'file_scope',
        key: 'src/index.ts',
        title: 'src/index.ts',
        summary: 'summary',
        claimIds: ['claim_1'],
        fileScope: ['src/index.ts'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const bundleResult = services.bundles.plan({
      id: 'req_2',
      taskTitle: 'Fix src/index.ts',
      repoIds: [repo.id],
      fileScope: ['src/index.ts'],
    });

    const freshness = services.freshness.markChanged(['src/index.ts']);
    expect(freshness.bundles[0]?.freshness).toBe('expired');

    const receipt = services.receipts.submit({
      repoIds: [repo.id],
      type: 'finding',
      summary: 'Observed a failing command',
      payload: { command: 'bun test' },
    });
    const validated = services.receipts.validate(receipt.id, [
      { repoId: repo.id, filePath: 'src/index.ts', fileHash: 'abc' },
    ]);
    expect(validated.status).toBe('validated');
    expect(bundleResult.bundle.id).toBeTruthy();
  });
});
