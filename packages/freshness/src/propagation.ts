import type { ClaimRecord, FreshnessState, TaskBundle, ViewRecord } from '../../protocol/src/index';

const ORDER: FreshnessState[] = ['fresh', 'partial', 'stale', 'expired', 'provisional', 'unknown'];

export function rollupFreshness(states: FreshnessState[]): FreshnessState {
  if (states.length === 0) {
    return 'unknown';
  }
  return states.reduce((worst, current) =>
    ORDER.indexOf(current) > ORDER.indexOf(worst) ? current : worst
  );
}

export function updateClaimFreshness(
  claims: ClaimRecord[],
  staleClaimIds: string[]
): ClaimRecord[] {
  const staleSet = new Set(staleClaimIds);
  return claims.map((claim) =>
    staleSet.has(claim.id)
      ? {
          ...claim,
          freshness: claim.freshness === 'expired' ? 'expired' : 'stale',
        }
      : claim
  );
}

export function updateViewFreshness(views: ViewRecord[], claims: ClaimRecord[]): ViewRecord[] {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  return views.map((view) => {
    const freshness = rollupFreshness(
      view.claimIds.map((claimId) => claimsById.get(claimId)?.freshness ?? 'unknown')
    ) as ViewRecord['freshness'];
    return { ...view, freshness };
  });
}

export function updateBundleFreshness(
  bundles: TaskBundle[],
  views: ViewRecord[],
  claims: ClaimRecord[]
): TaskBundle[] {
  const viewsById = new Map(views.map((view) => [view.id, view]));
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  return bundles.map((bundle) => {
    const freshness = rollupFreshness([
      ...bundle.selectedViewIds.map((viewId) => viewsById.get(viewId)?.freshness ?? 'unknown'),
      ...bundle.selectedClaimIds.map((claimId) => claimsById.get(claimId)?.freshness ?? 'unknown'),
    ]) as TaskBundle['freshness'];
    return {
      ...bundle,
      freshness: freshness === 'stale' ? 'expired' : freshness,
    };
  });
}
