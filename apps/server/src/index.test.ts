import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { routeManifest } from './contract';
import { buildOpenApiDocument, buildOpenApiJson, buildOpenApiYaml } from './openapi';
import { createScbsHttpServer } from './server';
import type { BundlePlanInput, ReceiptSubmitInput, ServeReport, ServerScbsService } from './types';

class StubService implements ServerScbsService {
  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: '0.1.0' };
  }

  public async planBundle(input: BundlePlanInput) {
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
    kind: 'local-durable',
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

    expect(routeManifest).toHaveLength(17);
    expect(operations).toHaveLength(routeManifest.length);
    expect(document.paths['/api/v1/bundles/{id}']?.get).toMatchObject({
      operationId: 'showBundle',
    });
    expect(document.paths['/api/v1/receipts/{id}/validate']?.post).toMatchObject({
      operationId: 'validateReceipt',
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
        planBundle: '/api/v1/bundles/plan',
      },
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
});
