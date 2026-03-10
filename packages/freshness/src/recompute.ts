import type { TaskBundle } from '../../protocol/src/index';

import type { ChangeImpact } from './invalidation';

export interface RecomputePlan {
  recomputeFactIds: string[];
  recomputeClaimIds: string[];
  refreshViewIds: string[];
  expireBundleIds: string[];
}

export function planSelectiveRecompute(impact: ChangeImpact, bundles: TaskBundle[]): RecomputePlan {
  const impactedBundleIds = new Set(impact.expiredBundleIds);
  return {
    recomputeFactIds: impact.staleFactIds,
    recomputeClaimIds: impact.staleClaimIds,
    refreshViewIds: impact.staleViewIds,
    expireBundleIds: bundles
      .filter((bundle) => impactedBundleIds.has(bundle.id))
      .map((bundle) => bundle.id),
  };
}
