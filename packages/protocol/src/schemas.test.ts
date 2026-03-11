import { describe, expect, it } from 'bun:test';

import {
  parseBundleRequest,
  parseClaimRecord,
  parseDependencyEdge,
  parseSymbolRecord,
} from './schemas';

describe('protocol schemas', () => {
  it('accepts a valid bundle request', () => {
    const parsed = parseBundleRequest({
      id: 'req_1',
      taskTitle: 'Inspect bundle',
      repoIds: ['repo_1'],
      fileScope: ['packages/core/src/index.ts'],
      symbolScope: ['BundlePlanner'],
      parentBundleId: 'bundle_1',
    });

    expect(parsed.taskTitle).toBe('Inspect bundle');
    expect(parsed.parentBundleId).toBe('bundle_1');
  });

  it('rejects invalid claim confidence', () => {
    expect(() =>
      parseClaimRecord({
        id: 'claim_1',
        repoId: 'repo_1',
        text: 'invalid',
        type: 'observed',
        confidence: 1.2,
        trustTier: 'source',
        factIds: [],
        anchors: [],
        freshness: 'fresh',
        invalidationKeys: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).toThrow('claim.confidence');
  });

  it('parses symbol and dependency edge records', () => {
    const symbol = parseSymbolRecord({
      id: 'sym_1',
      repoId: 'repo_1',
      fileId: 'file_1',
      name: 'hello',
      kind: 'function',
      exportName: 'hello',
      signature: 'function hello',
      anchor: {
        repoId: 'repo_1',
        filePath: 'src/index.ts',
        fileHash: 'hash_1',
        startLine: 1,
      },
      metadata: { visibility: 'public' },
    });
    const edge = parseDependencyEdge({
      id: 'edge_1',
      repoId: 'repo_1',
      fromType: 'file',
      fromId: 'file_1',
      toType: 'symbol',
      toId: 'sym_1',
      edgeType: 'contains',
      metadata: { reason: 'export' },
    });

    expect(symbol.anchor.filePath).toBe('src/index.ts');
    expect(edge.edgeType).toBe('contains');
  });
});
