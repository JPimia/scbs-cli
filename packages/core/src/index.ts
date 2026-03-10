import type { BundleRequest, RepositoryRef } from '../../protocol/src/index';

import { BundlePlanner } from './bundles/service';
import { BundleCacheService } from './cache/service';
import { deriveClaims } from './claims/service';
import { FreshnessService } from './freshness/service';
import { ReceiptService } from './receipts/service';
import { RepositoryService } from './repos/service';
import { createMemoryStore } from './storage/memory-store';
import { deriveViews } from './views/service';

export function createCoreServices() {
  const store = createMemoryStore();
  return {
    store,
    repositories: new RepositoryService(store),
    bundles: new BundlePlanner(store),
    freshness: new FreshnessService(store),
    receipts: new ReceiptService(store),
    cache: new BundleCacheService(store),
    derive(repoId: string) {
      store.claims = deriveClaims(repoId, store.facts);
      store.views = deriveViews(repoId, store.claims);
      return {
        claims: store.claims,
        views: store.views,
      };
    },
  };
}

export async function registerAndScanRepository(
  input: Parameters<RepositoryService['register']>[0]
): Promise<{
  repository: RepositoryRef;
  services: ReturnType<typeof createCoreServices>;
}> {
  const services = createCoreServices();
  const repository = services.repositories.register(input);
  await services.repositories.scan(repository.id);
  services.derive(repository.id);
  return { repository, services };
}

export function planBundle(
  services: ReturnType<typeof createCoreServices>,
  request: BundleRequest
) {
  const result = services.bundles.plan(request);
  services.cache.put(result.bundle);
  return result;
}

export * from './storage/memory-store';
