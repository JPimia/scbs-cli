import { describe, expect, it } from 'bun:test';

import {
  SCBS_API_ROOT,
  SCBS_API_VERSION,
  ScbsHttpError,
  type ServeReport,
  createApiIndex,
  createScbsClient,
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
      kind: 'standalone',
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
      id: 'req_cache-staleness',
      taskTitle: 'Inspect cache staleness',
      repoIds: ['repo_main'],
      fileScope: ['packages/core/src/index.ts'],
    });
    const receiptPayload = toReceiptSubmitPayload({
      bundleId: 'bundle_1',
      agent: 'codex',
      summary: 'Reviewed plan',
    });

    expect(planPayload).toEqual({
      id: 'req_cache-staleness',
      taskTitle: 'Inspect cache staleness',
      taskDescription: undefined,
      repoIds: ['repo_main'],
      role: undefined,
      parentBundleId: undefined,
      externalRef: undefined,
      fileScope: ['packages/core/src/index.ts'],
      symbolScope: undefined,
      constraints: undefined,
      metadata: undefined,
    });
    expect(fromBundlePlanPayload(planPayload).taskTitle).toBe('Inspect cache staleness');
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
    expect(index.endpoints.listRepos).toBe('/api/v1/repos');
    expect(index.endpoints.planBundle).toBe('/api/v1/bundles/plan');
    expect(listServiceCapabilities(report.api)[0]?.name).toBe('bundle-plan');
  });

  it('exports a client surface for claims, views, and SISU integrations', () => {
    const client = createScbsClient({
      baseUrl: 'http://127.0.0.1:4100',
      fetch: async () => new Response('[]', { status: 200 }),
    });

    expect(typeof client.repos.list).toBe('function');
    expect(typeof client.repos.register).toBe('function');
    expect(typeof client.facts.list).toBe('function');
    expect(typeof client.bundles.plan).toBe('function');
    expect(typeof client.bundles.show).toBe('function');
    expect(typeof client.claims.list).toBe('function');
    expect(typeof client.claims.show).toBe('function');
    expect(typeof client.views.list).toBe('function');
    expect(typeof client.views.show).toBe('function');
    expect(typeof client.views.rebuild).toBe('function');
    expect(typeof client.integrations.sisu.createBundleRequest).toBe('function');
    expect(typeof client.integrations.sisu.createReceipt).toBe('function');
  });

  it('calls repo and fact endpoints with the expected methods and paths', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      [
        {
          id: 'repo_1',
          name: 'repo_1',
          path: '/tmp/repo_1',
          status: 'registered',
          lastScannedAt: null,
        },
      ],
      {
        id: 'repo_1',
        name: 'repo_1',
        path: '/tmp/repo_1',
        status: 'registered',
        lastScannedAt: null,
      },
      {
        id: 'repo_2',
        name: 'repo_2',
        path: '/tmp/repo_2',
        status: 'registered',
        lastScannedAt: null,
      },
      {
        id: 'repo_2',
        name: 'repo_2',
        path: '/tmp/repo_2',
        status: 'scanned',
        lastScannedAt: '2026-03-11T00:00:00.000Z',
      },
      {
        repoId: 'repo_2',
        files: ['src/index.ts'],
        impacts: 2,
      },
      [
        {
          id: 'fact_1',
          repoId: 'repo_1',
          subject: 'storage adapter',
          freshness: 'fresh',
        },
      ],
    ];

    const client = createScbsClient({
      baseUrl: 'http://127.0.0.1:4100/',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const payload = responses.shift();
        if (payload === undefined) {
          throw new Error('Unexpected fetch call.');
        }
        return new Response(JSON.stringify(payload), {
          status: calls.length === 3 ? 201 : 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect((await client.repos.list())[0]?.id).toBe('repo_1');
    expect((await client.repos.show('repo_1')).path).toBe('/tmp/repo_1');
    expect((await client.repos.register({ name: 'repo_2', path: '/tmp/repo_2' })).id).toBe(
      'repo_2'
    );
    expect((await client.repos.scan('repo_2')).status).toBe('scanned');
    expect(
      (await client.repos.reportChanges({ id: 'repo_2', files: ['src/index.ts'] })).impacts
    ).toBe(2);
    expect((await client.facts.list())[0]?.id).toBe('fact_1');

    expect(calls[0]?.url).toBe('http://127.0.0.1:4100/api/v1/repos');
    expect(calls[1]?.url).toBe('http://127.0.0.1:4100/api/v1/repos/repo_1');
    expect(calls[2]?.url).toBe('http://127.0.0.1:4100/api/v1/repos/register');
    expect(calls[2]?.init?.method).toBe('POST');
    expect(calls[3]?.url).toBe('http://127.0.0.1:4100/api/v1/repos/repo_2/scan');
    expect(calls[4]?.url).toBe('http://127.0.0.1:4100/api/v1/repos/repo_2/changes');
    expect(calls[4]?.init?.body).toBe(JSON.stringify({ files: ['src/index.ts'] }));
    expect(calls[5]?.url).toBe('http://127.0.0.1:4100/api/v1/facts');
  });

  it('posts full bundle requests and parses full task bundles', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      {
        id: 'bundle_1',
        requestId: 'req_1',
        repoIds: ['repo_1'],
        summary: 'Bundle for Inspect cache invalidation',
        selectedViewIds: ['view_1'],
        selectedClaimIds: ['claim_1'],
        fileScope: ['src/index.ts'],
        symbolScope: ['planBundle'],
        commands: ['bun test'],
        proofHandles: [],
        freshness: 'fresh',
        cacheKey: 'bundle:req_1',
        metadata: { taskTitle: 'Inspect cache invalidation' },
        createdAt: '2026-03-11T00:00:00.000Z',
      },
      {
        id: 'bundle_1',
        requestId: 'req_1',
        repoIds: ['repo_1'],
        summary: 'Bundle for Inspect cache invalidation',
        selectedViewIds: ['view_1'],
        selectedClaimIds: ['claim_1'],
        fileScope: ['src/index.ts'],
        symbolScope: ['planBundle'],
        commands: ['bun test'],
        proofHandles: [],
        freshness: 'fresh',
        cacheKey: 'bundle:req_1',
        metadata: { taskTitle: 'Inspect cache invalidation' },
        createdAt: '2026-03-11T00:00:00.000Z',
      },
    ];

    const client = createScbsClient({
      baseUrl: 'http://127.0.0.1:4100',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const payload = responses.shift();
        if (!payload) {
          throw new Error('Unexpected fetch call.');
        }
        return new Response(JSON.stringify(payload), {
          status: calls.length === 1 ? 201 : 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const planned = await client.bundles.plan({
      id: 'req_1',
      taskTitle: 'Inspect cache invalidation',
      repoIds: ['repo_1'],
      fileScope: ['src/index.ts'],
      symbolScope: ['planBundle'],
    });
    expect(planned.selectedViewIds).toEqual(['view_1']);

    const shown = await client.bundles.show('bundle_1');
    expect(shown.requestId).toBe('req_1');

    expect(calls[0]?.url).toBe('http://127.0.0.1:4100/api/v1/bundles/plan');
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        id: 'req_1',
        taskTitle: 'Inspect cache invalidation',
        taskDescription: undefined,
        repoIds: ['repo_1'],
        role: undefined,
        parentBundleId: undefined,
        externalRef: undefined,
        fileScope: ['src/index.ts'],
        symbolScope: ['planBundle'],
        constraints: undefined,
        metadata: undefined,
      })
    );
    expect(calls[1]?.url).toBe('http://127.0.0.1:4100/api/v1/bundles/bundle_1');
  });

  it('calls claim and view endpoints with the expected methods and paths', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      [
        {
          id: 'claim_1',
          repoId: 'repo_1',
          statement: 'Freshness drift exists',
          factIds: ['fact_1'],
          freshness: 'fresh',
        },
      ],
      {
        id: 'claim/2',
        repoId: 'repo_1',
        statement: 'Freshness drift exists',
        factIds: ['fact_2'],
        freshness: 'stale',
      },
      [
        {
          id: 'view_1',
          repoId: 'repo_1',
          name: 'Repo summary',
          claimIds: ['claim_1'],
          freshness: 'fresh',
        },
      ],
      {
        id: 'view/2',
        repoId: 'repo_1',
        name: 'Claim index',
        claimIds: ['claim_2'],
        freshness: 'partial',
      },
      {
        id: 'view_3',
        repoId: 'repo_1',
        name: 'Rebuilt view',
        claimIds: ['claim_3'],
        freshness: 'fresh',
      },
    ];

    const client = createScbsClient({
      baseUrl: 'http://127.0.0.1:4100/',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const payload = responses.shift();
        if (payload === undefined) {
          throw new Error('Unexpected fetch call.');
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const listedClaims = await client.claims.list();
    expect(listedClaims).toEqual([
      {
        id: 'claim_1',
        repoId: 'repo_1',
        statement: 'Freshness drift exists',
        factIds: ['fact_1'],
        freshness: 'fresh',
      },
    ]);

    const shownClaim = await client.claims.show('claim/2');
    expect(shownClaim).toMatchObject({
      id: 'claim/2',
      freshness: 'stale',
    });

    const listedViews = await client.views.list();
    expect(listedViews.length).toBe(1);

    const shownView = await client.views.show('view/2');
    expect(shownView).toMatchObject({
      id: 'view/2',
      name: 'Claim index',
    });

    const rebuiltView = await client.views.rebuild('view_3');
    expect(rebuiltView).toMatchObject({
      id: 'view_3',
      name: 'Rebuilt view',
    });

    expect(calls.length).toBe(5);
    expect(calls[0]?.url).toBe('http://127.0.0.1:4100/api/v1/claims');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[1]?.url).toBe('http://127.0.0.1:4100/api/v1/claims/claim%2F2');
    expect(calls[1]?.init?.method).toBe('GET');
    expect(calls[2]?.url).toBe('http://127.0.0.1:4100/api/v1/views');
    expect(calls[2]?.init?.method).toBe('GET');
    expect(calls[3]?.url).toBe('http://127.0.0.1:4100/api/v1/views/view%2F2');
    expect(calls[3]?.init?.method).toBe('GET');
    expect(calls[4]?.url).toBe('http://127.0.0.1:4100/api/v1/views/view_3/rebuild');
    expect(calls[4]?.init?.method).toBe('POST');
  });

  it('posts SISU integration payloads and parses snapshots', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      {
        workspaceId: 'workspace_alpha',
        bundleId: 'bundle_1',
        objective: 'Inspect cache invalidation',
        repositoryIds: ['repo_1'],
        viewIds: ['view_1'],
        freshness: 'fresh',
        parentContextId: 'bundle_parent',
        focusFiles: ['src/index.ts'],
        focusSymbols: ['planBundle'],
      },
      {
        workspaceId: 'workspace_alpha',
        receiptId: 'receipt_1',
        agent: 'codex',
        summary: 'Validation pending',
        status: 'pending',
        bundleContextId: 'bundle_1',
      },
    ];

    const client = createScbsClient({
      baseUrl: 'http://127.0.0.1:4100',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const payload = responses.shift();
        if (payload === undefined) {
          throw new Error('Unexpected fetch call.');
        }
        return new Response(JSON.stringify(payload), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const bundleSnapshot = await client.integrations.sisu.createBundleRequest({
      workspaceId: 'workspace_alpha',
      objective: 'Inspect cache invalidation',
      repositoryIds: ['repo_1'],
      parentContextId: 'bundle_parent',
      focusFiles: ['src/index.ts'],
      focusSymbols: ['planBundle'],
    });
    expect(bundleSnapshot).toMatchObject({
      bundleId: 'bundle_1',
      repositoryIds: ['repo_1'],
      focusSymbols: ['planBundle'],
    });

    const receiptSnapshot = await client.integrations.sisu.createReceipt({
      workspaceId: 'workspace_alpha',
      agent: 'codex',
      summary: 'Validation pending',
      bundleContextId: 'bundle_1',
    });
    expect(receiptSnapshot).toMatchObject({
      receiptId: 'receipt_1',
      status: 'pending',
    });

    expect(calls.length).toBe(2);
    expect(calls[0]?.url).toBe('http://127.0.0.1:4100/api/v1/integrations/sisu/bundle-request');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: 'workspace_alpha',
        objective: 'Inspect cache invalidation',
        repositoryIds: ['repo_1'],
        parentContextId: 'bundle_parent',
        focusFiles: ['src/index.ts'],
        focusSymbols: ['planBundle'],
      })
    );
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(calls[1]?.url).toBe('http://127.0.0.1:4100/api/v1/integrations/sisu/receipt');
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: 'workspace_alpha',
        agent: 'codex',
        summary: 'Validation pending',
        bundleContextId: 'bundle_1',
      })
    );
  });

  it('throws a typed HTTP error for non-2xx responses', async () => {
    const client = createScbsClient({
      baseUrl: 'http://127.0.0.1:4100',
      fetch: async () =>
        new Response(JSON.stringify({ error: 'Not Found', message: 'Missing claim.' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/json' },
        }),
    });

    try {
      await client.claims.show('missing');
      throw new Error('Expected request to fail.');
    } catch (error) {
      expect(error instanceof ScbsHttpError).toBeTrue();
      expect(error).toMatchObject({
        status: 404,
        statusText: 'Not Found',
        body: {
          error: 'Not Found',
          message: 'Missing claim.',
        },
      });
    }
  });
});
