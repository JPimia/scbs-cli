import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createCoreServices,
  createMemoryStore,
  planBundle,
  registerAndScanRepository,
} from './index';

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
    expect(services.store.symbols.map((symbol) => symbol.name)).toEqual(['version']);
    expect(services.store.claims.length).toBeGreaterThan(0);
    expect(services.store.views.length).toBeGreaterThan(0);
    expect(services.store.views.some((view) => view.type === 'command_workflow')).toBeTrue();

    const result = planBundle(services, {
      id: 'req_1',
      taskTitle: 'Inspect fixture',
      repoIds: [repository.id],
      fileScope: ['src/index.ts'],
      constraints: { includeCommands: true, includeProofHandles: true },
    });

    expect(result.bundle.fileScope).toContain('src/index.ts');
    expect(result.bundle.commands).toContain('bun test');
    expect(result.bundle.proofHandles.length).toBeGreaterThan(0);
    expect(services.cache.get(result.bundle.cacheKey ?? '')?.id).toBe(result.bundle.id);
  });

  it('accepts an injected store for durable callers', () => {
    const store = createMemoryStore();
    const services = createCoreServices({ store });

    expect(services.store).toBe(store);
    expect(services.repositories.list()).toEqual([]);
  });

  it('inherits bounded parent context when planning a child bundle', () => {
    const services = createCoreServices();
    const repo = services.repositories.register({ name: 'manual', rootPath: '/tmp/manual' });

    services.store.facts = [
      {
        id: 'fact_parent_command',
        repoId: repo.id,
        type: 'script_command',
        subjectType: 'script',
        subjectId: 'pkg',
        value: { path: 'package.json', command: 'bun test' },
        anchors: [{ repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' }],
        versionStamp: 'hash-parent',
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fact_unrelated_command',
        repoId: repo.id,
        type: 'script_command',
        subjectType: 'script',
        subjectId: 'docs',
        value: { path: 'docs/commands.sh', command: 'npm run docs' },
        anchors: [{ repoId: repo.id, filePath: 'docs/guide.md', fileHash: 'hash-docs' }],
        versionStamp: 'hash-docs',
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.claims = [
      {
        id: 'claim_parent',
        repoId: repo.id,
        text: 'parent implementation is relevant',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_parent_command'],
        anchors: [{ repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' }],
        freshness: 'fresh',
        invalidationKeys: ['src/parent.ts'],
        metadata: { filePath: 'src/parent.ts', symbolName: 'parentSymbol' },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'claim_child',
        repoId: repo.id,
        text: 'child implementation is relevant',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [],
        anchors: [{ repoId: repo.id, filePath: 'src/child.ts', fileHash: 'hash-child' }],
        freshness: 'fresh',
        invalidationKeys: ['src/child.ts'],
        metadata: { filePath: 'src/child.ts', symbolName: 'childSymbol' },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'claim_unrelated',
        repoId: repo.id,
        text: 'docs are unrelated',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_unrelated_command'],
        anchors: [{ repoId: repo.id, filePath: 'docs/guide.md', fileHash: 'hash-docs' }],
        freshness: 'fresh',
        invalidationKeys: ['docs/guide.md'],
        metadata: { filePath: 'docs/guide.md', symbolName: 'docSymbol' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_parent',
        repoId: repo.id,
        type: 'file_scope',
        key: 'src/parent.ts',
        title: 'Parent scope',
        summary: 'parent implementation view',
        claimIds: ['claim_parent'],
        fileScope: ['src/parent.ts'],
        symbolScope: ['parentSymbol'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'view_child',
        repoId: repo.id,
        type: 'file_scope',
        key: 'src/child.ts',
        title: 'Child scope',
        summary: 'child implementation view',
        claimIds: ['claim_child'],
        fileScope: ['src/child.ts'],
        symbolScope: ['childSymbol'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'view_unrelated',
        repoId: repo.id,
        type: 'file_scope',
        key: 'docs/guide.md',
        title: 'Docs scope',
        summary: 'docs view',
        claimIds: ['claim_unrelated'],
        fileScope: ['docs/guide.md'],
        symbolScope: ['docSymbol'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];

    services.store.bundles.push({
      id: 'bundle_parent',
      requestId: 'req_parent',
      repoIds: [repo.id],
      summary: 'Parent bundle',
      selectedViewIds: ['view_parent', 'view_unrelated'],
      selectedClaimIds: ['claim_parent', 'claim_unrelated'],
      fileScope: ['src/parent.ts'],
      symbolScope: ['parentSymbol'],
      commands: ['bun test', 'npm run docs'],
      proofHandles: [
        { repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' },
        { repoId: repo.id, filePath: 'docs/guide.md', fileHash: 'hash-docs' },
      ],
      freshness: 'fresh',
      cacheKey: 'parent-cache',
      metadata: {},
      createdAt: '',
    });

    const result = planBundle(services, {
      id: 'req_child',
      taskTitle: 'Ship child feature',
      repoIds: [repo.id],
      fileScope: ['src/child.ts'],
      parentBundleId: 'bundle_parent',
      constraints: { includeCommands: true, includeProofHandles: true },
    });

    expect(result.bundle.metadata?.parentBundleId).toBe('bundle_parent');
    expect(result.bundle.fileScope).toEqual(['src/child.ts', 'src/parent.ts']);
    expect(result.bundle.symbolScope).toEqual(['parentSymbol', 'childSymbol']);
    expect(result.bundle.selectedViewIds).toEqual(['view_parent', 'view_child']);
    expect(result.bundle.selectedClaimIds).toEqual(['claim_child', 'claim_parent']);
    expect(result.bundle.commands).toEqual(['bun test']);
    expect(result.bundle.proofHandles).toEqual([
      { repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' },
      { repoId: repo.id, filePath: 'src/child.ts', fileHash: 'hash-child' },
    ]);
    expect(result.bundle.selectedViewIds.includes('view_unrelated')).toBe(false);
    expect(result.bundle.selectedClaimIds.includes('claim_unrelated')).toBe(false);
  });

  it('fails explicitly when a requested parent bundle is missing', () => {
    const services = createCoreServices();
    const repo = services.repositories.register({ name: 'manual', rootPath: '/tmp/manual' });

    expect(() =>
      planBundle(services, {
        id: 'req_missing_parent',
        taskTitle: 'Ship feature',
        repoIds: [repo.id],
        parentBundleId: 'bundle_missing',
      })
    ).toThrow('Parent bundle "bundle_missing" was not found.');
  });

  it('marks inherited stale or expired parent context in child freshness and warnings', () => {
    const services = createCoreServices();
    const repo = services.repositories.register({ name: 'manual', rootPath: '/tmp/manual' });
    services.store.claims = [
      {
        id: 'claim_parent',
        repoId: repo.id,
        text: 'parent claim',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [],
        anchors: [{ repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' }],
        freshness: 'fresh',
        invalidationKeys: ['src/parent.ts'],
        metadata: { filePath: 'src/parent.ts' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_parent',
        repoId: repo.id,
        type: 'file_scope',
        key: 'src/parent.ts',
        title: 'Parent scope',
        summary: 'parent view',
        claimIds: ['claim_parent'],
        fileScope: ['src/parent.ts'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.bundles.push({
      id: 'bundle_parent_stale',
      requestId: 'req_parent',
      repoIds: [repo.id],
      summary: 'Parent bundle',
      selectedViewIds: ['view_parent'],
      selectedClaimIds: ['claim_parent'],
      fileScope: ['src/parent.ts'],
      symbolScope: [],
      commands: [],
      proofHandles: [{ repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' }],
      freshness: 'expired',
      cacheKey: 'parent-cache',
      metadata: {},
      createdAt: '',
    });

    const result = planBundle(services, {
      id: 'req_child',
      taskTitle: 'Ship child feature',
      repoIds: [repo.id],
      parentBundleId: 'bundle_parent_stale',
      constraints: { includeProofHandles: true },
    });

    expect(result.bundle.fileScope).toContain('src/parent.ts');
    expect(result.bundle.freshness).toBe('expired');
    expect(result.warnings).toContain('Inherited parent bundle context is expired');
    expect(result.warnings).toContain('Bundle freshness is expired');
  });

  it('narrows multi-repo parent inheritance to the requested repositories', () => {
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

    const result = planBundle(services, {
      id: 'req_alpha_only',
      taskTitle: 'Ship alpha changes',
      repoIds: [repoAlpha.id],
      fileScope: ['src/shared.ts'],
      parentBundleId: 'bundle_parent_multi',
      constraints: { includeCommands: true, includeProofHandles: true },
    });

    expect(result.bundle.selectedViewIds).toEqual(['view_alpha']);
    expect(result.bundle.selectedClaimIds).toEqual(['claim_alpha']);
    expect(result.bundle.commands).toEqual(['bun test --filter alpha']);
    expect(result.bundle.proofHandles).toEqual([
      { repoId: repoAlpha.id, filePath: 'src/shared.ts', fileHash: 'hash-alpha' },
    ]);
    expect(result.bundle.freshness).toBe('fresh');
    expect(result.bundle.fileScope).toEqual(['src/shared.ts']);
  });

  it('does not cross-select same-path inherited scope from another repo', () => {
    const services = createCoreServices();
    const repoAlpha = services.repositories.register({ name: 'alpha', rootPath: '/tmp/alpha' });
    const repoBeta = services.repositories.register({ name: 'beta', rootPath: '/tmp/beta' });

    services.store.claims = [
      {
        id: 'claim_alpha',
        repoId: repoAlpha.id,
        text: 'alpha entrypoint',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [],
        anchors: [{ repoId: repoAlpha.id, filePath: 'src/index.ts', fileHash: 'hash-alpha' }],
        freshness: 'fresh',
        invalidationKeys: ['src/index.ts'],
        metadata: { filePath: 'src/index.ts', symbolName: 'bootstrap' },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'claim_beta',
        repoId: repoBeta.id,
        text: 'beta entrypoint',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [],
        anchors: [{ repoId: repoBeta.id, filePath: 'src/index.ts', fileHash: 'hash-beta' }],
        freshness: 'fresh',
        invalidationKeys: ['src/index.ts'],
        metadata: { filePath: 'src/index.ts', symbolName: 'bootstrap' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_alpha',
        repoId: repoAlpha.id,
        type: 'file_scope',
        key: `${repoAlpha.id}:src/index.ts`,
        title: 'Alpha entrypoint',
        summary: 'alpha bootstrap',
        claimIds: ['claim_alpha'],
        fileScope: ['src/index.ts'],
        symbolScope: ['bootstrap'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'view_beta',
        repoId: repoBeta.id,
        type: 'file_scope',
        key: `${repoBeta.id}:src/index.ts`,
        title: 'Beta entrypoint',
        summary: 'beta bootstrap',
        claimIds: ['claim_beta'],
        fileScope: ['src/index.ts'],
        symbolScope: ['bootstrap'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.bundles.push({
      id: 'bundle_parent_beta',
      requestId: 'req_parent_beta',
      repoIds: [repoBeta.id],
      summary: 'Beta parent bundle',
      selectedViewIds: ['view_beta'],
      selectedClaimIds: ['claim_beta'],
      fileScope: ['src/index.ts'],
      symbolScope: ['bootstrap'],
      commands: [],
      proofHandles: [{ repoId: repoBeta.id, filePath: 'src/index.ts', fileHash: 'hash-beta' }],
      freshness: 'fresh',
      cacheKey: 'parent-beta',
      metadata: {},
      createdAt: '',
    });

    const result = planBundle(services, {
      id: 'req_alpha',
      taskTitle: 'Inspect alpha',
      repoIds: [repoAlpha.id],
      parentBundleId: 'bundle_parent_beta',
    });

    expect(result.bundle.selectedViewIds).toEqual(['view_alpha']);
    expect(result.bundle.selectedClaimIds).toEqual(['claim_alpha']);
    expect(result.bundle.proofHandles).toEqual([
      { repoId: repoAlpha.id, filePath: 'src/index.ts', fileHash: 'hash-alpha' },
    ]);
    expect(result.bundle.freshness).toBe('fresh');
  });

  it('changes the cache key when inherited parent context changes', () => {
    const services = createCoreServices();
    const repo = services.repositories.register({ name: 'manual', rootPath: '/tmp/manual' });
    services.store.claims = [
      {
        id: 'claim_parent',
        repoId: repo.id,
        text: 'parent claim',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [],
        anchors: [{ repoId: repo.id, filePath: 'src/parent.ts', fileHash: 'hash-parent' }],
        freshness: 'fresh',
        invalidationKeys: ['src/parent.ts'],
        metadata: { filePath: 'src/parent.ts' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    services.store.views = [
      {
        id: 'view_parent',
        repoId: repo.id,
        type: 'file_scope',
        key: 'src/parent.ts',
        title: 'Parent scope',
        summary: 'parent view',
        claimIds: ['claim_parent'],
        fileScope: ['src/parent.ts'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const parentBundle = {
      id: 'bundle_parent',
      requestId: 'req_parent',
      repoIds: [repo.id],
      summary: 'Parent bundle',
      selectedViewIds: ['view_parent'],
      selectedClaimIds: ['claim_parent'],
      fileScope: ['src/parent.ts'],
      symbolScope: [],
      commands: [],
      proofHandles: [],
      freshness: 'fresh' as const,
      cacheKey: 'parent-cache',
      metadata: {},
      createdAt: '',
    };
    services.store.bundles.push(parentBundle);

    const initial = planBundle(services, {
      id: 'req_child_1',
      taskTitle: 'Ship child feature',
      repoIds: [repo.id],
      parentBundleId: 'bundle_parent',
    });

    parentBundle.fileScope = ['src/parent.ts', 'src/extra.ts'];

    const updated = planBundle(services, {
      id: 'req_child_2',
      taskTitle: 'Ship child feature',
      repoIds: [repo.id],
      parentBundleId: 'bundle_parent',
    });

    expect(initial.bundle.cacheKey === updated.bundle.cacheKey).toBe(false);
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
    expect(services.receipts.promotedClaims()[0]?.anchors[0]?.filePath).toBe('src/index.ts');
    expect(
      services.store.views.some(
        (view) =>
          view.claimIds.includes(`claim_from_${receipt.id}`) &&
          view.fileScope?.[0] === 'src/index.ts'
      )
    ).toBeTrue();
    expect(bundleResult.bundle.id).toBeTruthy();
  });

  it('marks only the changed repository stale when repos share a relative path', () => {
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

    const alphaBundle = planBundle(services, {
      id: 'req_alpha',
      taskTitle: 'Inspect alpha',
      repoIds: [repoAlpha.id],
      fileScope: ['src/shared.ts'],
      constraints: { includeProofHandles: true },
    });
    const betaBundle = planBundle(services, {
      id: 'req_beta',
      taskTitle: 'Inspect beta',
      repoIds: [repoBeta.id],
      fileScope: ['src/shared.ts'],
      constraints: { includeProofHandles: true },
    });

    const freshness = services.freshness.markChanged([
      { repoId: repoBeta.id, filePath: 'src/shared.ts' },
    ]);

    expect(alphaBundle.bundle.id).toBeTruthy();
    expect(betaBundle.bundle.id).toBeTruthy();
    expect(freshness.claims.find((claim) => claim.id === 'claim_alpha')?.freshness).toBe('fresh');
    expect(freshness.claims.find((claim) => claim.id === 'claim_beta')?.freshness).toBe('stale');
    expect(freshness.views.find((view) => view.id === 'view_alpha')?.freshness).toBe('fresh');
    expect(freshness.views.find((view) => view.id === 'view_beta')?.freshness).toBe('stale');
    expect(freshness.bundles.find((bundle) => bundle.id === alphaBundle.bundle.id)?.freshness).toBe(
      'fresh'
    );
    expect(freshness.bundles.find((bundle) => bundle.id === betaBundle.bundle.id)?.freshness).toBe(
      'expired'
    );
    expect(freshness.recompute.expireBundleIds).toEqual([betaBundle.bundle.id]);
  });
});
