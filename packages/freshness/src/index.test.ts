import { describe, expect, it } from 'bun:test';

import type { ClaimRecord, TaskBundle, ViewRecord } from '../../protocol/src/index';

import {
  determineChangeImpact,
  updateBundleFreshness,
  updateClaimFreshness,
  updateViewFreshness,
} from './index';

describe('freshness', () => {
  it('marks dependent artifacts stale and expired', () => {
    const claims: ClaimRecord[] = [
      {
        id: 'claim_1',
        repoId: 'repo_1',
        text: 'Observed',
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: ['fact_1'],
        anchors: [{ repoId: 'repo_1', filePath: 'src/index.ts', fileHash: 'abc' }],
        freshness: 'fresh',
        invalidationKeys: ['src/index.ts'],
        createdAt: '',
        updatedAt: '',
      },
    ];
    const views: ViewRecord[] = [
      {
        id: 'view_1',
        repoId: 'repo_1',
        type: 'file_scope',
        key: 'src-index',
        title: 'src/index.ts',
        summary: 'summary',
        claimIds: ['claim_1'],
        freshness: 'fresh',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const bundles: TaskBundle[] = [
      {
        id: 'bundle_1',
        requestId: 'req_1',
        repoIds: ['repo_1'],
        summary: 'summary',
        selectedViewIds: ['view_1'],
        selectedClaimIds: ['claim_1'],
        fileScope: ['src/index.ts'],
        symbolScope: [],
        commands: [],
        proofHandles: [],
        freshness: 'fresh',
        createdAt: '',
      },
    ];
    const impact = determineChangeImpact(
      ['src/index.ts'],
      [
        {
          id: 'fact_1',
          repoId: 'repo_1',
          type: 'file_hash',
          subjectType: 'file',
          subjectId: 'file_1',
          value: {},
          anchors: [{ repoId: 'repo_1', filePath: 'src/index.ts', fileHash: 'abc' }],
          versionStamp: 'abc',
          freshness: 'fresh',
          createdAt: '',
          updatedAt: '',
        },
      ],
      claims,
      views,
      bundles
    );

    const updatedClaims = updateClaimFreshness(claims, impact.staleClaimIds);
    const updatedViews = updateViewFreshness(views, updatedClaims);
    const updatedBundles = updateBundleFreshness(bundles, updatedViews, updatedClaims);

    expect(impact.staleClaimIds).toEqual(['claim_1']);
    expect(updatedViews[0]?.freshness).toBe('stale');
    expect(updatedBundles[0]?.freshness).toBe('expired');
  });

  it('uses invalidation keys, file scope, and proof handles for impact matching', () => {
    const impact = determineChangeImpact(
      ['src/lib'],
      [],
      [
        {
          id: 'claim_2',
          repoId: 'repo_1',
          text: 'Observed',
          type: 'observed',
          confidence: 1,
          trustTier: 'source',
          factIds: [],
          anchors: [],
          freshness: 'fresh',
          invalidationKeys: ['src/lib/utils.ts'],
          createdAt: '',
          updatedAt: '',
        },
      ],
      [
        {
          id: 'view_2',
          repoId: 'repo_1',
          type: 'file_scope',
          key: 'src/lib/utils.ts',
          title: 'src/lib/utils.ts',
          summary: 'summary',
          claimIds: ['claim_2'],
          fileScope: ['src/lib/utils.ts'],
          freshness: 'fresh',
          createdAt: '',
          updatedAt: '',
        },
      ],
      [
        {
          id: 'bundle_2',
          requestId: 'req_2',
          repoIds: ['repo_1'],
          summary: 'summary',
          selectedViewIds: ['view_2'],
          selectedClaimIds: ['claim_2'],
          fileScope: ['src/lib/utils.ts'],
          symbolScope: [],
          commands: [],
          proofHandles: [{ repoId: 'repo_1', filePath: 'src/lib/utils.ts', fileHash: 'abc' }],
          freshness: 'fresh',
          createdAt: '',
        },
      ]
    );

    expect(impact.staleClaimIds).toEqual(['claim_2']);
    expect(impact.staleViewIds).toEqual(['view_2']);
    expect(impact.expiredBundleIds).toEqual(['bundle_2']);
  });
});
