import type { ClaimRecord, FactRecord, TaskBundle, ViewRecord } from '../../protocol/src/index';

export interface RepoFileChange {
  filePath: string;
  repoId?: string;
}

export interface ChangeImpact {
  changedFiles: RepoFileChange[];
  changedPaths: string[];
  staleFactIds: string[];
  staleClaimIds: string[];
  staleViewIds: string[];
  expiredBundleIds: string[];
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function normalizeChange(change: string | RepoFileChange): RepoFileChange {
  if (typeof change === 'string') {
    return { filePath: normalizePath(change) };
  }
  return {
    ...change,
    filePath: normalizePath(change.filePath),
  };
}

function matchesChangedPath(
  candidate: string | undefined,
  repoId: string | undefined,
  changedFiles: RepoFileChange[]
): boolean {
  if (!candidate) {
    return false;
  }
  const normalized = normalizePath(candidate);
  for (const changed of changedFiles) {
    if (changed.repoId && repoId && changed.repoId !== repoId) {
      continue;
    }
    if (changed.repoId && !repoId) {
      continue;
    }
    const changedPath = changed.filePath;
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
  changedPaths: Array<string | RepoFileChange>,
  facts: FactRecord[],
  claims: ClaimRecord[],
  views: ViewRecord[],
  bundles: TaskBundle[]
): ChangeImpact {
  const changedFiles = changedPaths.map(normalizeChange);
  const staleFacts = facts.filter((fact) =>
    fact.anchors.some((anchor) => matchesChangedPath(anchor.filePath, anchor.repoId, changedFiles))
  );
  const staleFactIds = new Set(staleFacts.map((fact) => fact.id));
  const staleClaims = claims.filter(
    (claim) =>
      claim.anchors.some((anchor) =>
        matchesChangedPath(anchor.filePath, anchor.repoId, changedFiles)
      ) ||
      claim.invalidationKeys.some((key) => matchesChangedPath(key, claim.repoId, changedFiles)) ||
      claim.factIds.some((factId) => staleFactIds.has(factId))
  );
  const staleClaimIds = new Set(staleClaims.map((claim) => claim.id));
  const staleViews = views.filter(
    (view) =>
      view.claimIds.some((claimId) => staleClaimIds.has(claimId)) ||
      (view.fileScope ?? []).some((filePath) =>
        matchesChangedPath(filePath, view.repoId, changedFiles)
      )
  );
  const staleViewIds = new Set(staleViews.map((view) => view.id));
  const expiredBundles = bundles.filter(
    (bundle) =>
      bundle.selectedClaimIds.some((claimId) => staleClaimIds.has(claimId)) ||
      bundle.selectedViewIds.some((viewId) => staleViewIds.has(viewId)) ||
      bundle.fileScope.some((filePath) =>
        bundle.repoIds.some((repoId) => matchesChangedPath(filePath, repoId, changedFiles))
      ) ||
      bundle.proofHandles.some((anchor) =>
        matchesChangedPath(anchor.filePath, anchor.repoId, changedFiles)
      )
  );

  return {
    changedFiles,
    changedPaths: changedFiles.map((change) => change.filePath),
    staleFactIds: [...staleFactIds],
    staleClaimIds: [...staleClaimIds],
    staleViewIds: [...staleViewIds],
    expiredBundleIds: expiredBundles.map((bundle) => bundle.id),
  };
}
