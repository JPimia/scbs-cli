import type { ClaimRecord, FactRecord, TaskBundle, ViewRecord } from '../../protocol/src/index';

export interface ChangeImpact {
  changedPaths: string[];
  staleFactIds: string[];
  staleClaimIds: string[];
  staleViewIds: string[];
  expiredBundleIds: string[];
}

export function determineChangeImpact(
  changedPaths: string[],
  facts: FactRecord[],
  claims: ClaimRecord[],
  views: ViewRecord[],
  bundles: TaskBundle[]
): ChangeImpact {
  const changed = new Set(changedPaths);
  const staleFacts = facts.filter((fact) =>
    fact.anchors.some((anchor) => changed.has(anchor.filePath))
  );
  const staleFactIds = new Set(staleFacts.map((fact) => fact.id));
  const staleClaims = claims.filter(
    (claim) =>
      claim.anchors.some((anchor) => changed.has(anchor.filePath)) ||
      claim.factIds.some((factId) => staleFactIds.has(factId))
  );
  const staleClaimIds = new Set(staleClaims.map((claim) => claim.id));
  const staleViews = views.filter((view) =>
    view.claimIds.some((claimId) => staleClaimIds.has(claimId))
  );
  const staleViewIds = new Set(staleViews.map((view) => view.id));
  const expiredBundles = bundles.filter(
    (bundle) =>
      bundle.selectedClaimIds.some((claimId) => staleClaimIds.has(claimId)) ||
      bundle.selectedViewIds.some((viewId) => staleViewIds.has(viewId))
  );

  return {
    changedPaths,
    staleFactIds: [...staleFactIds],
    staleClaimIds: [...staleClaimIds],
    staleViewIds: [...staleViewIds],
    expiredBundleIds: expiredBundles.map((bundle) => bundle.id),
  };
}
