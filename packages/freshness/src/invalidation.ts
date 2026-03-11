import type { ClaimRecord, FactRecord, TaskBundle, ViewRecord } from '../../protocol/src/index';

export interface ChangeImpact {
  changedPaths: string[];
  staleFactIds: string[];
  staleClaimIds: string[];
  staleViewIds: string[];
  expiredBundleIds: string[];
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function matchesChangedPath(candidate: string | undefined, changed: Set<string>): boolean {
  if (!candidate) {
    return false;
  }
  const normalized = normalizePath(candidate);
  for (const changedPath of changed) {
    if (
      normalized === changedPath ||
      normalized.startsWith(`${changedPath}/`) ||
      changedPath.startsWith(`${normalized}/`)
    ) {
      return true;
    }
  }
  return false;
}

export function determineChangeImpact(
  changedPaths: string[],
  facts: FactRecord[],
  claims: ClaimRecord[],
  views: ViewRecord[],
  bundles: TaskBundle[]
): ChangeImpact {
  const changed = new Set(changedPaths.map(normalizePath));
  const staleFacts = facts.filter((fact) =>
    fact.anchors.some((anchor) => matchesChangedPath(anchor.filePath, changed))
  );
  const staleFactIds = new Set(staleFacts.map((fact) => fact.id));
  const staleClaims = claims.filter(
    (claim) =>
      claim.anchors.some((anchor) => matchesChangedPath(anchor.filePath, changed)) ||
      claim.invalidationKeys.some((key) => matchesChangedPath(key, changed)) ||
      claim.factIds.some((factId) => staleFactIds.has(factId))
  );
  const staleClaimIds = new Set(staleClaims.map((claim) => claim.id));
  const staleViews = views.filter(
    (view) =>
      view.claimIds.some((claimId) => staleClaimIds.has(claimId)) ||
      (view.fileScope ?? []).some((filePath) => matchesChangedPath(filePath, changed))
  );
  const staleViewIds = new Set(staleViews.map((view) => view.id));
  const expiredBundles = bundles.filter(
    (bundle) =>
      bundle.selectedClaimIds.some((claimId) => staleClaimIds.has(claimId)) ||
      bundle.selectedViewIds.some((viewId) => staleViewIds.has(viewId)) ||
      bundle.fileScope.some((filePath) => matchesChangedPath(filePath, changed)) ||
      bundle.proofHandles.some((anchor) => matchesChangedPath(anchor.filePath, changed))
  );

  return {
    changedPaths,
    staleFactIds: [...staleFactIds],
    staleClaimIds: [...staleClaimIds],
    staleViewIds: [...staleViewIds],
    expiredBundleIds: expiredBundles.map((bundle) => bundle.id),
  };
}
