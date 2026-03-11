import { describe, expect, it } from 'bun:test';

import {
  SCBS_API_ROOT,
  SCBS_API_VERSION,
  type ServeReport,
  createApiIndex,
  fromBundlePlanPayload,
  fromReceiptSubmitPayload,
  listServiceCapabilities,
  scbsOperations,
  toBundlePlanPayload,
  toReceiptSubmitPayload,
} from './index';

describe('sdk package surface', () => {
  const report: ServeReport = {
    service: 'scbs',
    status: 'ready',
    api: {
      kind: 'local-durable',
      baseUrl: 'http://127.0.0.1:4100',
      apiVersion: 'v1',
      mode: 'live',
      capabilities: [
        {
          name: 'bundle-plan',
          description: 'Plan local bundle requests against registered repositories.',
        },
      ],
    },
    storage: {
      adapter: 'local-json',
      configPath: '.scbs/config.json',
      statePath: '.scbs/state.json',
      stateExists: true,
    },
  };

  it('exposes the server route manifest as a public operation list', () => {
    expect(SCBS_API_VERSION).toBe('v1');
    expect(SCBS_API_ROOT).toBe('/api/v1');
    expect(scbsOperations.some((operation) => operation.operationId === 'planBundle')).toBeTrue();
    expect(
      scbsOperations.some((operation) => operation.path === '/api/v1/receipts/:id/reject')
    ).toBeTrue();
  });

  it('bridges the HTTP payload field names to server input types', () => {
    const planPayload = toBundlePlanPayload({
      task: 'Inspect cache staleness',
      repoId: 'repo_main',
      fileScope: ['packages/core/src/index.ts'],
    });
    const receiptPayload = toReceiptSubmitPayload({
      bundleId: 'bundle_1',
      agent: 'codex',
      summary: 'Reviewed plan',
    });

    expect(planPayload).toEqual({
      task: 'Inspect cache staleness',
      repo: 'repo_main',
      repoIds: undefined,
      parentBundleId: undefined,
      fileScope: ['packages/core/src/index.ts'],
      symbolScope: undefined,
    });
    expect(fromBundlePlanPayload(planPayload).repoId).toBe('repo_main');
    expect(receiptPayload).toEqual({
      bundle: 'bundle_1',
      agent: 'codex',
      summary: 'Reviewed plan',
    });
    expect(fromReceiptSubmitPayload(receiptPayload).bundleId).toBe('bundle_1');
  });

  it('creates the public API index from the server contract', () => {
    const index = createApiIndex(report);

    expect(index.api.baseUrl).toBe('http://127.0.0.1:4100');
    expect(index.endpoints.planBundle).toBe('/api/v1/bundles/plan');
    expect(listServiceCapabilities(report.api)[0]?.name).toBe('bundle-plan');
  });
});
