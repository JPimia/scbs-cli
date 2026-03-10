import { describe, expect, it } from 'bun:test';

import { parseBundleRequest, parseClaimRecord } from './schemas';

describe('protocol schemas', () => {
  it('accepts a valid bundle request', () => {
    const parsed = parseBundleRequest({
      id: 'req_1',
      taskTitle: 'Inspect bundle',
      repoIds: ['repo_1'],
      fileScope: ['packages/core/src/index.ts'],
    });

    expect(parsed.taskTitle).toBe('Inspect bundle');
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
});
