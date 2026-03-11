import {
  type RepoFileChange,
  determineChangeImpact,
  planSelectiveRecompute,
  updateBundleFreshness,
  updateClaimFreshness,
  updateViewFreshness,
} from '../../../freshness/src/index';
import type { ClaimRecord, TaskBundle, ViewRecord } from '../../../protocol/src/index';

import type { CoreStore } from '../storage/memory-store';

export class FreshnessService {
  constructor(private readonly store: CoreStore) {}

  markChanged(changedPaths: Array<string | RepoFileChange>): {
    claims: ClaimRecord[];
    views: ViewRecord[];
    bundles: TaskBundle[];
    recompute: ReturnType<typeof planSelectiveRecompute>;
  } {
    const impact = determineChangeImpact(
      changedPaths,
      this.store.facts,
      this.store.claims,
      this.store.views,
      this.store.bundles
    );
    const claims = updateClaimFreshness(this.store.claims, impact.staleClaimIds);
    const views = updateViewFreshness(this.store.views, claims);
    const bundles = updateBundleFreshness(this.store.bundles, views, claims);
    const recompute = planSelectiveRecompute(impact, bundles);
    this.store.claims = claims;
    this.store.views = views;
    this.store.bundles = bundles;
    return { claims, views, bundles, recompute };
  }
}
