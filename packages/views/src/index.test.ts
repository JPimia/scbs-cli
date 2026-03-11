import { describe, expect, it } from 'bun:test';

import {
  presentApiIndex,
  presentBundleRecord,
  presentFreshnessImpact,
  presentProtocolView,
  presentReceiptRecord,
  presentTaskBundle,
} from './index';

describe('views package surface', () => {
  it('presents the API index with endpoint metadata', () => {
    const view = presentApiIndex({
      service: 'scbs',
      status: 'listening',
      api: {
        kind: 'standalone',
        baseUrl: 'http://127.0.0.1:4200',
        apiVersion: 'v1',
        mode: 'live',
        capabilities: [
          {
            name: 'receipt-ingest',
            description: 'Submit receipts for validation.',
          },
        ],
      },
      storage: {
        adapter: 'local-json',
        configPath: '.scbs/config.json',
        statePath: '.scbs/state.json',
        stateExists: true,
      },
    });

    expect(view.apiVersion).toBe('v1');
    expect(view.capabilityNames).toEqual(['receipt-ingest']);
    expect(view.endpoints.some((endpoint) => endpoint.operationId === 'createReceipt')).toBeTrue();
  });

  it('presents bundle, receipt, and protocol view records using contract vocabulary', () => {
    expect(
      presentBundleRecord({
        id: 'bundle_1',
        requestId: 'req_1',
        repoIds: ['repo_1', 'repo_2'],
        summary: 'Bundle for Inspect bundle',
        selectedViewIds: ['view_1', 'view_2'],
        selectedClaimIds: ['claim_1'],
        commands: [],
        proofHandles: [],
        freshness: 'stale',
        metadata: { task: 'Inspect bundle', parentBundleId: undefined },
        fileScope: ['src/index.ts'],
        symbolScope: ['BundlePlanner'],
        createdAt: '2026-03-11T00:00:00.000Z',
      })
    ).toEqual({
      id: 'bundle_1',
      task: 'Inspect bundle',
      repoCount: 2,
      viewCount: 2,
      freshness: 'stale',
      scopeSummary: '1 files / 1 symbols',
      parentBundleId: undefined,
    });

    expect(
      presentTaskBundle({
        id: 'bundle_2',
        requestId: 'req_2',
        repoIds: ['repo_1'],
        summary: 'Summarized bundle',
        selectedViewIds: ['view_1'],
        selectedClaimIds: ['claim_1'],
        fileScope: ['src/index.ts', 'src/contract.ts'],
        symbolScope: ['buildApiIndex'],
        commands: ['bun test'],
        proofHandles: [],
        freshness: 'fresh',
        createdAt: '2026-03-11T00:00:00.000Z',
      })
    ).toMatchObject({
      id: 'bundle_2',
      commandCount: 1,
      proofHandleCount: 0,
      scopeSummary: '2 files / 1 symbols',
    });

    expect(
      presentProtocolView({
        id: 'view_1',
        repoId: 'repo_1',
        type: 'workflow',
        key: 'bundle-planning',
        title: 'Bundle planning',
        summary: 'How bundle planning works',
        claimIds: ['claim_1', 'claim_2'],
        fileScope: ['src/index.ts'],
        symbolScope: ['planBundle'],
        freshness: 'fresh',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T00:00:00.000Z',
      })
    ).toMatchObject({
      key: 'bundle-planning',
      claimCount: 2,
      fileScopeCount: 1,
      symbolScopeCount: 1,
    });

    expect(
      presentFreshnessImpact({
        artifactType: 'bundle',
        artifactId: 'bundle_1',
        state: 'expired',
      })
    ).toEqual({
      label: 'bundle:expired',
      artifactId: 'bundle_1',
      state: 'expired',
    });

    expect(
      presentReceiptRecord({
        id: 'receipt_1',
        bundleId: null,
        agent: 'codex',
        summary: 'No bundle context',
        status: 'pending',
      })
    ).toEqual({
      id: 'receipt_1',
      agent: 'codex',
      summary: 'No bundle context',
      status: 'pending',
      bundleLabel: 'unscoped',
    });
  });
});
