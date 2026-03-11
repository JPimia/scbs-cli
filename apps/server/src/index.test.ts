import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { routeManifest } from './contract';
import { buildOpenApiDocument, buildOpenApiJson, buildOpenApiYaml } from './openapi';
import { createScbsHttpServer } from './server';
import type {
  AccessTokenGrant,
  AccessTokenRecord,
  AuditRecord,
  BundleListEntry,
  BundlePlanInput,
  BundleReviewRecord,
  ClaimRecord,
  DoctorReport,
  FactRecord,
  FreshnessJobRecord,
  OutboxEventRecord,
  ReceiptReviewRecord,
  ReceiptSubmitInput,
  RepoRecord,
  ServeReport,
  ServerScbsService,
  ViewRecord,
  WebhookRecord,
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

const repoFixtures: RepoRecord[] = [
  {
    id: 'repo_local-default',
    name: 'local-default',
    path: '/tmp/local-default',
    status: 'scanned',
    lastScannedAt: '2026-03-11T00:00:00.000Z',
  },
];

const factFixtures: FactRecord[] = [
  {
    id: 'fact_repo-1_storage',
    repoId: 'repo_local-default',
    subject: 'storage adapter',
    freshness: 'fresh',
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

  public lastRepoChangesInput:
    | {
        id: string;
        files: string[];
      }
    | undefined;

  public async listBundles(): Promise<BundleListEntry[]> {
    return [
      {
        id: 'bundle_bootstrap',
        taskTitle: 'bootstrap context',
        repoIds: ['repo_local-default'],
        freshness: 'fresh',
        receiptCount: 1,
        pendingReceiptCount: 0,
        hasPlannerDiagnostics: true,
        createdAt: '2026-03-11T00:00:00.000Z',
      },
    ];
  }

  public async reviewBundle(id: string): Promise<BundleReviewRecord> {
    return {
      bundle: await this.showBundle(id),
      receipts: await this.listReceipts(),
      receiptHistory: await this.listReceiptHistory(),
      plannerDiagnostics: { selectedViewIds: ['view_system-overview'] },
    };
  }

  public async listReceiptHistory(id?: string): Promise<ReceiptReviewRecord[]> {
    const history: ReceiptReviewRecord[] = [
      {
        id: 'receipt-review_1',
        receiptId: 'receipt_1',
        bundleId: 'bundle_bootstrap',
        action: 'validated',
        actor: 'system',
        note: 'Validated.',
        createdAt: '2026-03-11T00:00:00.000Z',
      },
    ];
    return id ? history.filter((entry) => entry.receiptId === id) : history;
  }

  public async listOutboxEvents(): Promise<OutboxEventRecord[]> {
    return [await this.showOutboxEvent('outbox_1')];
  }

  public async showOutboxEvent(id: string): Promise<OutboxEventRecord> {
    return {
      id,
      topic: 'bundle.planned',
      aggregateType: 'bundle',
      aggregateId: 'bundle_bootstrap',
      status: 'delivered',
      payload: { taskTitle: 'bootstrap context' },
      deliveries: [],
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async listWebhooks(): Promise<WebhookRecord[]> {
    return [];
  }

  public async createWebhook(): Promise<WebhookRecord> {
    return {
      id: 'webhook_1',
      label: 'ops',
      url: 'http://127.0.0.1:9999/hook',
      events: ['bundle.planned'],
      active: true,
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async listAccessTokens(): Promise<AccessTokenRecord[]> {
    return [];
  }

  public async createAccessToken(): Promise<AccessTokenGrant> {
    return {
      token: 'scbs_test',
      record: {
        id: 'token_1',
        label: 'test',
        scopes: ['admin:write', 'admin:read', 'repo:write', 'repo:read'],
        createdAt: '2026-03-11T00:00:00.000Z',
      },
    };
  }

  public async authorizeAccessToken(): Promise<AccessTokenRecord | null> {
    return {
      id: 'token_1',
      label: 'test',
      scopes: ['admin:write', 'admin:read', 'repo:write', 'repo:read'],
      createdAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async listAuditRecords(): Promise<AuditRecord[]> {
    return [];
  }

  public async recordAudit(): Promise<AuditRecord> {
    return {
      id: 'audit_1',
      actor: 'test',
      action: 'noop',
      scope: 'admin',
      resourceType: 'route',
      outcome: 'success',
      createdAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: '0.1.0' };
  }

  public async doctor(): Promise<DoctorReport> {
    return {
      status: 'ok',
      summary: 'SCBS diagnostics are healthy.',
      api: report.api,
      storage: report.storage,
      diagnostics: {
        artifacts: {
          repos: 1,
          facts: 1,
          claims: 2,
          views: 2,
          bundles: 1,
          cachedBundles: 1,
          receipts: 1,
        },
        freshness: {
          overall: 'partial',
          staleArtifacts: 1,
          pendingJobs: 1,
          completedJobs: 1,
          recentEvents: 1,
        },
        receipts: {
          pending: 1,
          validated: 1,
          rejected: 0,
        },
        hotspots: {
          staleBundleIds: ['bundle_bootstrap'],
          pendingReceiptIds: ['receipt_1'],
          pendingJobIds: ['job_1'],
        },
      },
      checks: [{ name: 'storage', status: 'ok', detail: 'Storage is ready.' }],
    };
  }

  public async listJobs() {
    return {
      summary: {
        pending: 1,
        running: 0,
        completed: 1,
        failed: 0,
      },
      jobs: [await this.showJob('job_1')],
      recentEvents: [
        {
          id: 'evt_1',
          repoId: 'repo_local-default',
          files: ['src/index.ts'],
          createdAt: '2026-03-11T00:00:00.000Z',
        },
      ],
      pendingReceiptIds: ['receipt_1'],
    };
  }

  public async showJob(id: string): Promise<FreshnessJobRecord> {
    return {
      id,
      kind: 'receipt_validation',
      repoId: 'repo_local-default',
      eventId: 'evt_1',
      targetId: 'receipt_1',
      files: [],
      status: 'pending',
      attempts: 1,
      maxAttempts: 3,
      availableAt: '2026-03-11T00:00:00.000Z',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async retryJob(id: string): Promise<FreshnessJobRecord> {
    return { ...(await this.showJob(id)), attempts: 0, lastError: undefined };
  }

  public async registerRepo(input: { name: string; path: string }) {
    return {
      id: `repo_${input.name}`,
      name: input.name,
      path: input.path,
      status: 'registered' as const,
      lastScannedAt: null,
    };
  }

  public async listRepos() {
    return repoFixtures;
  }

  public async showRepo(id: string) {
    return getFixtureById(repoFixtures, id);
  }

  public async scanRepo(id: string) {
    const repo = await this.showRepo(id);
    return { ...repo, status: 'scanned' as const };
  }

  public async reportRepoChanges(input: { id: string; files: string[] }) {
    this.lastRepoChangesInput = input;
    return { repoId: input.id, files: input.files, impacts: 1 };
  }

  public async listFacts() {
    return factFixtures;
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
      id: `bundle_${input.taskTitle.replace(/\s+/g, '-')}`,
      requestId: input.id,
      repoIds: input.repoIds,
      summary: `Bundle for ${input.taskTitle}`,
      selectedViewIds: ['view_system-overview'],
      selectedClaimIds: ['claim_repo-1_architecture'],
      commands: [],
      proofHandles: [],
      freshness: 'fresh' as const,
      fileScope: input.fileScope ?? [],
      symbolScope: input.symbolScope ?? [],
      cacheKey: `bundle:${input.id}`,
      metadata: {
        task: input.taskTitle,
        taskTitle: input.taskTitle,
        parentBundleId: input.parentBundleId,
      },
      createdAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async showBundle(id: string) {
    return {
      id,
      requestId: `req_${id}`,
      repoIds: ['repo_local-default'],
      summary: 'Bundle for bootstrap context',
      selectedViewIds: ['view_system-overview'],
      selectedClaimIds: ['claim_repo-1_architecture'],
      commands: [],
      proofHandles: [],
      freshness: 'fresh' as const,
      fileScope: [],
      symbolScope: [],
      metadata: { task: 'bootstrap context', taskTitle: 'bootstrap context' },
      createdAt: '2026-03-11T00:00:00.000Z',
    };
  }

  public async getBundleFreshness(id: string) {
    return { bundleId: id, freshness: 'fresh' as const };
  }

  public async expireBundle(id: string) {
    return {
      id,
      requestId: `req_${id}`,
      repoIds: ['repo_local-default'],
      summary: 'Bundle for bootstrap context',
      selectedViewIds: ['view_system-overview'],
      selectedClaimIds: ['claim_repo-1_architecture'],
      commands: [],
      proofHandles: [],
      freshness: 'expired' as const,
      fileScope: [],
      symbolScope: [],
      metadata: { task: 'bootstrap context', taskTitle: 'bootstrap context' },
      createdAt: '2026-03-11T00:00:00.000Z',
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

  public async runFreshnessWorker() {
    return { processed: 1, remaining: 0, jobIds: ['job_1'], failedJobIds: [] };
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

    expect(routeManifest).toHaveLength(47);
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
    expect(document.paths['/api/v1/integrations/mission-control/repo-sync']?.post).toMatchObject({
      operationId: 'createMissionControlRepoSync',
    });
    expect(document.paths['/api/v1/repos']?.get).toMatchObject({
      operationId: 'listRepos',
    });
    expect(document.paths['/api/v1/admin/bundles']?.get).toMatchObject({
      operationId: 'listAdminBundles',
    });
    expect(document.paths['/api/v1/admin/outbox/{id}']?.get).toMatchObject({
      operationId: 'showOutboxEvent',
    });
    expect(document.paths['/api/v1/facts']?.get).toMatchObject({
      operationId: 'listFacts',
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
        adminDiagnostics: '/api/v1/admin/diagnostics',
        listJobs: '/api/v1/admin/jobs',
        listAdminBundles: '/api/v1/admin/bundles',
        reviewBundle: '/api/v1/admin/bundles/:id/review',
        listOutboxEvents: '/api/v1/admin/outbox',
        listAccessTokens: '/api/v1/admin/access-tokens',
        runWorker: '/api/v1/admin/worker/drain',
        listRepos: '/api/v1/repos',
        registerRepo: '/api/v1/repos/register',
        showRepo: '/api/v1/repos/:id',
        scanRepo: '/api/v1/repos/:id/scan',
        reportRepoChanges: '/api/v1/repos/:id/changes',
        listFacts: '/api/v1/facts',
        listClaims: '/api/v1/claims',
        rebuildView: '/api/v1/views/:id/rebuild',
        planBundle: '/api/v1/bundles/plan',
        missionControlRepoSync: '/api/v1/integrations/mission-control/repo-sync',
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

    const reposResponse = await fetch(`${baseUrl}/api/v1/repos`);
    expect(reposResponse.status).toBe(200);
    await expect(reposResponse.json()).resolves.toEqual(repoFixtures);

    const factsResponse = await fetch(`${baseUrl}/api/v1/facts`);
    expect(factsResponse.status).toBe(200);
    await expect(factsResponse.json()).resolves.toEqual(factFixtures);

    const planResponse = await fetch(`${baseUrl}/api/v1/bundles/plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'req_bootstrap-context',
        taskTitle: 'bootstrap context',
        repoIds: ['repo_local-default'],
      }),
    });
    expect(planResponse.status).toBe(201);
    await expect(planResponse.json()).resolves.toMatchObject({
      id: 'bundle_bootstrap-context',
      requestId: 'req_bootstrap-context',
      repoIds: ['repo_local-default'],
    });

    const diagnosticsResponse = await fetch(`${baseUrl}/api/v1/admin/diagnostics`);
    expect(diagnosticsResponse.status).toBe(200);
    await expect(diagnosticsResponse.json()).resolves.toMatchObject({
      status: 'ok',
      diagnostics: {
        freshness: {
          pendingJobs: 1,
        },
      },
    });

    const jobsResponse = await fetch(`${baseUrl}/api/v1/admin/jobs`);
    expect(jobsResponse.status).toBe(200);
    await expect(jobsResponse.json()).resolves.toMatchObject({
      summary: {
        pending: 1,
      },
      jobs: [
        {
          id: 'job_1',
          kind: 'receipt_validation',
        },
      ],
    });

    const bundleReviewResponse = await fetch(
      `${baseUrl}/api/v1/admin/bundles/bundle_bootstrap/review`
    );
    expect(bundleReviewResponse.status).toBe(200);
    await expect(bundleReviewResponse.json()).resolves.toMatchObject({
      bundle: {
        id: 'bundle_bootstrap',
      },
      plannerDiagnostics: {
        selectedViewIds: ['view_system-overview'],
      },
    });

    const outboxResponse = await fetch(`${baseUrl}/api/v1/admin/outbox`);
    expect(outboxResponse.status).toBe(200);
    await expect(outboxResponse.json()).resolves.toMatchObject([
      {
        id: 'outbox_1',
        topic: 'bundle.planned',
      },
    ]);

    const drainResponse = await fetch(`${baseUrl}/api/v1/admin/worker/drain`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 1, kinds: ['receipt_validation'] }),
    });
    expect(drainResponse.status).toBe(200);
    await expect(drainResponse.json()).resolves.toMatchObject({
      processed: 1,
      remaining: 0,
      failedJobIds: [],
    });

    const methodNotAllowed = await fetch(`${baseUrl}/api/v1/receipts/receipt_1/validate`);
    expect(methodNotAllowed.status).toBe(405);
    expect(methodNotAllowed.headers.get('allow')).toBe('POST');
    await expect(methodNotAllowed.json()).resolves.toMatchObject({
      error: 'Method Not Allowed',
    });
  });

  it('maps integration bundle and receipt endpoints through the existing service calls', async () => {
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

    const missionControlResponse = await fetch(
      `${baseUrl}/api/v1/integrations/mission-control/repo-sync`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          missionId: 'mission_alpha',
          objective: 'Inspect cache invalidation',
          repoIds: ['repo_local-default'],
          bundleParentId: 'bundle_parent',
          fileTargets: ['src/index.ts'],
          symbolTargets: ['planBundle'],
        }),
      }
    );
    expect(missionControlResponse.status).toBe(201);
    await expect(missionControlResponse.json()).resolves.toMatchObject({
      missionId: 'mission_alpha',
      bundleId: 'bundle_Inspect-cache-invalidation',
      task: 'Bundle for Inspect cache invalidation',
      repoIds: ['repo_local-default'],
      trackedViewIds: ['view_system-overview'],
      freshness: 'fresh',
      bundleParentId: 'bundle_parent',
    });
    expect(service.lastPlannedBundleInput).toEqual({
      id: 'req_mc_mission_alpha_inspect-cache-invalidation',
      taskTitle: 'Inspect cache invalidation',
      repoIds: ['repo_local-default'],
      parentBundleId: 'bundle_parent',
      fileScope: ['src/index.ts'],
      symbolScope: ['planBundle'],
    });

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
      objective: 'Bundle for Inspect cache invalidation',
      repositoryIds: ['repo_local-default'],
      parentContextId: 'bundle_parent',
      focusFiles: ['src/index.ts'],
      focusSymbols: ['planBundle'],
    });
    expect(service.lastPlannedBundleInput).toEqual({
      id: 'req_sisu_workspace_alpha_inspect-cache-invalidation',
      taskTitle: 'Inspect cache invalidation',
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

    const registerRepoResponse = await fetch(`${baseUrl}/api/v1/repos/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'demo',
        path: '/tmp/demo',
      }),
    });
    expect(registerRepoResponse.status).toBe(201);
    await expect(registerRepoResponse.json()).resolves.toMatchObject({
      id: 'repo_demo',
      name: 'demo',
      path: '/tmp/demo',
    });

    const repoChangesResponse = await fetch(`${baseUrl}/api/v1/repos/repo_local-default/changes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        files: ['src/index.ts'],
      }),
    });
    expect(repoChangesResponse.status).toBe(200);
    await expect(repoChangesResponse.json()).resolves.toMatchObject({
      repoId: 'repo_local-default',
      files: ['src/index.ts'],
      impacts: 1,
    });
    expect(service.lastRepoChangesInput).toEqual({
      id: 'repo_local-default',
      files: ['src/index.ts'],
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

    const invalidMissionControl = await fetch(
      `${baseUrl}/api/v1/integrations/mission-control/repo-sync`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          missionId: 'mission_alpha',
          repoIds: ['repo_local-default'],
        }),
      }
    );
    expect(invalidMissionControl.status).toBe(400);
    await expect(invalidMissionControl.json()).resolves.toMatchObject({
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
