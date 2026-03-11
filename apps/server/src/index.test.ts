import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { routeManifest } from './contract';
import { buildOpenApiDocument, buildOpenApiJson, buildOpenApiYaml } from './openapi';
import { createScbsHttpServer } from './server';
import type {
  BundlePlanInput,
  ClaimRecord,
  ReceiptSubmitInput,
  ServeReport,
  ServerScbsService,
  ViewRecord,
} from './types';

const claimFixtures: ClaimRecord[] = [
  {
    id: 'claim_repo-1_architecture',
    repoId: 'repo_local-default',
    statement: 'The standalone SCBS service uses a local JSON adapter for state.',
    factIds: ['fact_repo-1_storage', 'fact_repo-1_runtime'],
    freshness: 'fresh',
  },
  {
    id: 'claim_repo-1_routes',
    repoId: 'repo_local-default',
    statement: 'HTTP route definitions are centralized in the server surface.',
    factIds: ['fact_repo-1_http'],
    freshness: 'stale',
  },
];

const viewFixtures: ViewRecord[] = [
  {
    id: 'view_system-overview',
    repoId: 'repo_local-default',
    name: 'System Overview',
    claimIds: ['claim_repo-1_architecture'],
    freshness: 'fresh',
  },
  {
    id: 'view_route-map',
    repoId: 'repo_local-default',
    name: 'Route Map',
    claimIds: ['claim_repo-1_routes'],
    freshness: 'stale',
  },
];

function getFixtureById<T extends { id: string }>(fixtures: readonly T[], id: string): T {
  const match = fixtures.find((fixture) => fixture.id === id);
  if (match) {
    return match;
  }

  const firstFixture = fixtures[0];
  if (!firstFixture) {
    throw new Error(`Missing fixtures for ${id}.`);
  }

  return firstFixture;
}

class StubService implements ServerScbsService {
  public lastPlannedBundleInput: BundlePlanInput | undefined;

  public lastSubmittedReceiptInput: ReceiptSubmitInput | undefined;

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: '0.1.0' };
  }

  public async listClaims() {
    return claimFixtures;
  }

  public async showClaim(id: string) {
    return getFixtureById(claimFixtures, id);
  }

  public async listViews() {
    return viewFixtures;
  }

  public async showView(id: string) {
    return getFixtureById(viewFixtures, id);
  }

  public async rebuildView(id: string) {
    const view = await this.showView(id);
    return { ...view, freshness: 'fresh' as const };
  }

  public async planBundle(input: BundlePlanInput) {
    this.lastPlannedBundleInput = input;

    return {
      id: `bundle_${input.task.replace(/\s+/g, '-')}`,
      repoIds: input.repoIds ?? [],
      task: input.task,
      viewIds: ['view_system-overview'],
      freshness: 'fresh' as const,
      parentBundleId: input.parentBundleId,
      fileScope: input.fileScope,
      symbolScope: input.symbolScope,
    };
  }

  public async showBundle(id: string) {
    return {
      id,
      repoIds: ['repo_local-default'],
      task: 'bootstrap context',
      viewIds: ['view_system-overview'],
      freshness: 'fresh' as const,
    };
  }

  public async getBundleFreshness(id: string) {
    return { bundleId: id, freshness: 'fresh' as const };
  }

  public async expireBundle(id: string) {
    return {
      id,
      repoIds: ['repo_local-default'],
      task: 'bootstrap context',
      viewIds: ['view_system-overview'],
      freshness: 'expired' as const,
    };
  }

  public async listBundleCache() {
    return [{ key: 'bundle:bootstrap', bundleId: 'bundle_bootstrap', freshness: 'fresh' as const }];
  }

  public async clearBundleCache() {
    return { cleared: 1 };
  }

  public async getFreshnessImpacts() {
    return [
      { artifactType: 'bundle' as const, artifactId: 'bundle_bootstrap', state: 'stale' as const },
    ];
  }

  public async getFreshnessStatus() {
    return { overall: 'partial' as const, staleArtifacts: 1 };
  }

  public async recomputeFreshness() {
    return { updated: 2 };
  }

  public async submitReceipt(input: ReceiptSubmitInput) {
    this.lastSubmittedReceiptInput = input;

    return {
      id: 'receipt_1',
      bundleId: input.bundleId,
      agent: input.agent,
      summary: input.summary,
      status: 'pending' as const,
    };
  }

  public async listReceipts() {
    return [
      {
        id: 'receipt_1',
        bundleId: 'bundle_bootstrap',
        agent: 'builder',
        summary: 'Planned a bundle.',
        status: 'validated' as const,
      },
    ];
  }

  public async showReceipt(id: string) {
    return {
      id,
      bundleId: 'bundle_bootstrap',
      agent: 'builder',
      summary: 'Planned a bundle.',
      status: 'validated' as const,
    };
  }

  public async validateReceipt(id: string) {
    return {
      id,
      bundleId: 'bundle_bootstrap',
      agent: 'builder',
      summary: 'Planned a bundle.',
      status: 'validated' as const,
    };
  }

  public async rejectReceipt(id: string) {
    return {
      id,
      bundleId: 'bundle_bootstrap',
      agent: 'builder',
      summary: 'Planned a bundle.',
      status: 'rejected' as const,
    };
  }
}

const report: ServeReport = {
  service: 'scbs',
  status: 'listening',
  api: {
    kind: 'standalone',
    baseUrl: 'http://127.0.0.1:8791',
    apiVersion: 'v1',
    mode: 'live',
    capabilities: [
      {
        name: 'bundle-plan',
        description:
          'Plan local bundle requests against registered repositories and materialized views.',
      },
    ],
  },
  storage: {
    adapter: 'local-json',
    configPath: 'config/scbs.config.yaml',
    statePath: '.scbs/state.json',
    stateExists: true,
  },
};

const servers: Array<ReturnType<typeof createScbsHttpServer>> = [];
const fixturesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../openapi');

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    )
  );
});

describe('server contract', () => {
  it('keeps the route manifest aligned with the OpenAPI document and checked-in artifacts', async () => {
    const document = buildOpenApiDocument();
    const operations = Object.values(document.paths).flatMap((pathItem) => Object.keys(pathItem));

    expect(routeManifest).toHaveLength(24);
    expect(operations).toHaveLength(routeManifest.length);
    expect(document.paths['/api/v1/claims']?.get).toMatchObject({
      operationId: 'listClaims',
    });
    expect(document.paths['/api/v1/views/{id}/rebuild']?.post).toMatchObject({
      operationId: 'rebuildView',
    });
    expect(document.paths['/api/v1/bundles/{id}']?.get).toMatchObject({
      operationId: 'showBundle',
    });
    expect(document.paths['/api/v1/integrations/sisu/bundle-request']?.post).toMatchObject({
      operationId: 'createSisuBundleRequest',
    });
    expect(document.paths['/api/v1/receipts/{id}/validate']?.post).toMatchObject({
      operationId: 'validateReceipt',
    });
    expect(document.paths['/api/v1/integrations/sisu/receipt']?.post).toMatchObject({
      operationId: 'createSisuReceipt',
    });

    const jsonArtifact = await readFile(path.join(fixturesRoot, 'scbs-v1.openapi.json'), 'utf8');
    expect(JSON.parse(jsonArtifact)).toEqual(JSON.parse(buildOpenApiJson()));

    const yamlArtifact = await readFile(path.join(fixturesRoot, 'scbs-v1.openapi.yaml'), 'utf8');
    expect(yamlArtifact).toBe(buildOpenApiYaml());
  });

  it('serves the API index and method errors through the injected service boundary', async () => {
    const server = createScbsHttpServer(new StubService(), report);
    servers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const indexResponse = await fetch(`${baseUrl}/api/v1`);
    expect(indexResponse.status).toBe(200);
    await expect(indexResponse.json()).resolves.toMatchObject({
      service: 'scbs',
      endpoints: {
        listClaims: '/api/v1/claims',
        rebuildView: '/api/v1/views/:id/rebuild',
        planBundle: '/api/v1/bundles/plan',
        sisuBundleRequest: '/api/v1/integrations/sisu/bundle-request',
        sisuReceipt: '/api/v1/integrations/sisu/receipt',
      },
    });

    const claimsResponse = await fetch(`${baseUrl}/api/v1/claims`);
    expect(claimsResponse.status).toBe(200);
    await expect(claimsResponse.json()).resolves.toEqual(claimFixtures);

    const claimResponse = await fetch(`${baseUrl}/api/v1/claims/claim_repo-1_architecture`);
    expect(claimResponse.status).toBe(200);
    await expect(claimResponse.json()).resolves.toEqual(claimFixtures[0]);

    const viewsResponse = await fetch(`${baseUrl}/api/v1/views`);
    expect(viewsResponse.status).toBe(200);
    await expect(viewsResponse.json()).resolves.toEqual(viewFixtures);

    const viewResponse = await fetch(`${baseUrl}/api/v1/views/view_route-map`);
    expect(viewResponse.status).toBe(200);
    await expect(viewResponse.json()).resolves.toEqual(viewFixtures[1]);

    const rebuildViewResponse = await fetch(`${baseUrl}/api/v1/views/view_route-map/rebuild`, {
      method: 'POST',
    });
    expect(rebuildViewResponse.status).toBe(200);
    await expect(rebuildViewResponse.json()).resolves.toEqual({
      ...viewFixtures[1],
      freshness: 'fresh',
    });

    const planResponse = await fetch(`${baseUrl}/api/v1/bundles/plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task: 'bootstrap context',
        repoIds: ['repo_local-default'],
      }),
    });
    expect(planResponse.status).toBe(201);
    await expect(planResponse.json()).resolves.toMatchObject({
      id: 'bundle_bootstrap-context',
      repoIds: ['repo_local-default'],
    });

    const methodNotAllowed = await fetch(`${baseUrl}/api/v1/receipts/receipt_1/validate`);
    expect(methodNotAllowed.status).toBe(405);
    expect(methodNotAllowed.headers.get('allow')).toBe('POST');
    await expect(methodNotAllowed.json()).resolves.toMatchObject({
      error: 'Method Not Allowed',
    });
  });

  it('maps SISU integration endpoints through the existing bundle and receipt service calls', async () => {
    const service = new StubService();
    const server = createScbsHttpServer(service, report);
    servers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const bundleResponse = await fetch(`${baseUrl}/api/v1/integrations/sisu/bundle-request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: 'workspace_alpha',
        objective: 'Inspect cache invalidation',
        repositoryIds: ['repo_local-default'],
        parentContextId: 'bundle_parent',
        focusFiles: ['src/index.ts'],
        focusSymbols: ['planBundle'],
      }),
    });
    expect(bundleResponse.status).toBe(201);
    await expect(bundleResponse.json()).resolves.toMatchObject({
      workspaceId: 'workspace_alpha',
      bundleId: 'bundle_Inspect-cache-invalidation',
      objective: 'Inspect cache invalidation',
      repositoryIds: ['repo_local-default'],
      parentContextId: 'bundle_parent',
      focusFiles: ['src/index.ts'],
      focusSymbols: ['planBundle'],
    });
    expect(service.lastPlannedBundleInput).toEqual({
      task: 'Inspect cache invalidation',
      repoIds: ['repo_local-default'],
      parentBundleId: 'bundle_parent',
      fileScope: ['src/index.ts'],
      symbolScope: ['planBundle'],
    });

    const receiptResponse = await fetch(`${baseUrl}/api/v1/integrations/sisu/receipt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: 'workspace_alpha',
        agent: 'codex',
        summary: 'Validation pending',
        bundleContextId: 'bundle_Inspect-cache-invalidation',
      }),
    });
    expect(receiptResponse.status).toBe(201);
    await expect(receiptResponse.json()).resolves.toMatchObject({
      workspaceId: 'workspace_alpha',
      receiptId: 'receipt_1',
      agent: 'codex',
      summary: 'Validation pending',
      status: 'pending',
      bundleContextId: 'bundle_Inspect-cache-invalidation',
    });
    expect(service.lastSubmittedReceiptInput).toEqual({
      bundleId: 'bundle_Inspect-cache-invalidation',
      agent: 'codex',
      summary: 'Validation pending',
    });
  });

  it('returns bad request for invalid bundle and receipt payloads', async () => {
    const server = createScbsHttpServer(new StubService(), report);
    servers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address.');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const invalidBundle = await fetch(`${baseUrl}/api/v1/bundles/plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['repo_local-default'],
      }),
    });
    expect(invalidBundle.status).toBe(400);
    await expect(invalidBundle.json()).resolves.toMatchObject({
      error: 'Bad Request',
      message: 'Missing required field "task".',
    });

    const invalidReceipt = await fetch(`${baseUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        summary: 'Planned a bundle.',
      }),
    });
    expect(invalidReceipt.status).toBe(400);
    await expect(invalidReceipt.json()).resolves.toMatchObject({
      error: 'Bad Request',
      message: 'Missing required field "agent".',
    });

    const invalidSisuBundle = await fetch(`${baseUrl}/api/v1/integrations/sisu/bundle-request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: 'workspace_alpha',
        repositoryIds: ['repo_local-default'],
      }),
    });
    expect(invalidSisuBundle.status).toBe(400);
    await expect(invalidSisuBundle.json()).resolves.toMatchObject({
      error: 'Bad Request',
      message: 'Missing required field "objective".',
    });

    const invalidSisuReceipt = await fetch(`${baseUrl}/api/v1/integrations/sisu/receipt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: 'workspace_alpha',
        summary: 'Planned a bundle.',
      }),
    });
    expect(invalidSisuReceipt.status).toBe(400);
    await expect(invalidSisuReceipt.json()).resolves.toMatchObject({
      error: 'Bad Request',
      message: 'Missing required field "agent".',
    });
  });
});
