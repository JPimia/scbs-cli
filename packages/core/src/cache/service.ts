import type { BundleCacheEntry, TaskBundle } from '../../../protocol/src/index';

import type { CoreStore } from '../storage/memory-store';
import { createId, nowIso } from '../utils';

export class BundleCacheService {
  constructor(private readonly store: CoreStore) {}

  put(bundle: TaskBundle, now = new Date()): BundleCacheEntry {
    const existing = this.store.bundleCache.find((entry) => entry.cacheKey === bundle.cacheKey);
    if (existing) {
      existing.bundleId = bundle.id;
      existing.freshness = bundle.freshness === 'unknown' ? 'partial' : bundle.freshness;
      existing.expiresAt = bundle.expiresAt;
      existing.updatedAt = nowIso(now);
      return existing;
    }

    const entry: BundleCacheEntry = {
      id: createId('bc'),
      cacheKey: bundle.cacheKey ?? createId('cache'),
      bundleId: bundle.id,
      freshness: bundle.freshness === 'unknown' ? 'partial' : bundle.freshness,
      hitCount: 0,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      expiresAt: bundle.expiresAt,
    };
    this.store.bundleCache.push(entry);
    return entry;
  }

  get(cacheKey: string, now = new Date()): TaskBundle | undefined {
    const entry = this.store.bundleCache.find((candidate) => candidate.cacheKey === cacheKey);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry.expiresAt, now)) {
      return undefined;
    }
    entry.hitCount += 1;
    return this.store.bundles.find((bundle) => bundle.id === entry.bundleId);
  }

  clear(cacheKey?: string): void {
    this.store.bundleCache = cacheKey
      ? this.store.bundleCache.filter((entry) => entry.cacheKey !== cacheKey)
      : [];
  }

  private isExpired(expiresAt: string | undefined, now: Date): boolean {
    if (!expiresAt) {
      return false;
    }

    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return false;
    }

    return expiresAtMs <= now.getTime();
  }
}
