import { describe, expect, it } from 'bun:test';

import {
  mapBundleRecordToSisuBundleSnapshot,
  mapReceiptRecordToSisuReceiptSnapshot,
  mapSisuBundlePlanJobToBundlePlanInput,
  mapSisuReceiptNoteToReceiptSubmitInput,
} from './index';

describe('adapter-sisu package surface', () => {
  it('maps SISU planning inputs to the SCBS bundle planning contract', () => {
    expect(
      mapSisuBundlePlanJobToBundlePlanInput({
        workspaceId: 'workspace_alpha',
        objective: 'Inspect cache invalidation',
        repositoryIds: ['repo_1'],
        parentContextId: 'bundle_parent',
        focusFiles: ['src/index.ts'],
        focusSymbols: ['planBundle'],
      })
    ).toEqual({
      id: 'req_sisu_workspace_alpha_inspect-cache-invalidation',
      taskTitle: 'Inspect cache invalidation',
      repoIds: ['repo_1'],
      parentBundleId: 'bundle_parent',
      fileScope: ['src/index.ts'],
      symbolScope: ['planBundle'],
    });
  });

  it('maps bundle and receipt records back to explicit SISU snapshots', () => {
    expect(
      mapBundleRecordToSisuBundleSnapshot(
        {
          id: 'bundle_1',
          requestId: 'req_1',
          repoIds: ['repo_1'],
          summary: 'Bundle for Inspect cache invalidation',
          selectedViewIds: ['view_1'],
          selectedClaimIds: ['claim_1'],
          commands: [],
          proofHandles: [],
          freshness: 'fresh',
          fileScope: ['src/index.ts'],
          symbolScope: ['planBundle'],
          metadata: { parentBundleId: undefined },
          createdAt: '2026-03-11T00:00:00.000Z',
        },
        'workspace_alpha'
      )
    ).toEqual({
      workspaceId: 'workspace_alpha',
      bundleId: 'bundle_1',
      objective: 'Bundle for Inspect cache invalidation',
      repositoryIds: ['repo_1'],
      viewIds: ['view_1'],
      freshness: 'fresh',
      parentContextId: undefined,
      focusFiles: ['src/index.ts'],
      focusSymbols: ['planBundle'],
    });

    expect(
      mapSisuReceiptNoteToReceiptSubmitInput({
        workspaceId: 'workspace_alpha',
        agent: 'codex',
        summary: 'Validation pending',
        bundleContextId: 'bundle_1',
      })
    ).toEqual({
      bundleId: 'bundle_1',
      agent: 'codex',
      summary: 'Validation pending',
    });

    expect(
      mapReceiptRecordToSisuReceiptSnapshot(
        {
          id: 'receipt_1',
          bundleId: 'bundle_1',
          agent: 'codex',
          summary: 'Validation pending',
          status: 'validated',
        },
        'workspace_alpha'
      )
    ).toEqual({
      workspaceId: 'workspace_alpha',
      receiptId: 'receipt_1',
      agent: 'codex',
      summary: 'Validation pending',
      status: 'validated',
      bundleContextId: 'bundle_1',
    });
  });
});
