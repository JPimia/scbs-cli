import { rollupFreshness } from '../../../freshness/src/index';
import type {
  BundlePlanResult,
  BundleRequest,
  ClaimRecord,
  FactRecord,
  FreshnessState,
  TaskBundle,
  ViewRecord,
} from '../../../protocol/src/index';

import type { CoreStore } from '../storage/memory-store';
import { createId, nowIso, stableHash } from '../utils';

function scoreView(view: ViewRecord, request: BundleRequest): number {
  let score = 0;
  if (request.fileScope?.some((filePath) => view.fileScope?.includes(filePath))) {
    score += 10;
  }
  if (request.symbolScope?.some((symbol) => view.symbolScope?.includes(symbol))) {
    score += 10;
  }
  if (
    request.taskDescription &&
    view.summary.toLowerCase().includes(request.taskDescription.toLowerCase())
  ) {
    score += 2;
  }
  if (request.taskTitle && view.summary.toLowerCase().includes(request.taskTitle.toLowerCase())) {
    score += 1;
  }
  return score;
}

function matchesRequestScope(
  request: BundleRequest,
  claim: ClaimRecord,
  view?: ViewRecord
): boolean {
  const claimFilePath =
    typeof claim.metadata?.filePath === 'string' ? String(claim.metadata.filePath) : undefined;
  const claimSymbol =
    typeof claim.metadata?.symbolName === 'string' ? String(claim.metadata.symbolName) : undefined;
  const fileScope = [...(view?.fileScope ?? []), ...(claimFilePath ? [claimFilePath] : [])];
  const symbolScope = [...(view?.symbolScope ?? []), ...(claimSymbol ? [claimSymbol] : [])];
  if (request.fileScope?.some((filePath) => fileScope.includes(filePath))) {
    return true;
  }
  if (request.symbolScope?.some((symbol) => symbolScope.includes(symbol))) {
    return true;
  }
  return false;
}

function collectCommands(
  facts: FactRecord[],
  request: BundleRequest,
  selectedClaims: ClaimRecord[]
): string[] {
  if (!request.constraints?.includeCommands) {
    return [];
  }
  const claimPaths = new Set(
    selectedClaims
      .map((claim) => claim.metadata?.filePath)
      .filter((filePath): filePath is string => typeof filePath === 'string')
  );
  return [
    ...new Set(
      facts
        .filter((fact) => request.repoIds.includes(fact.repoId))
        .filter((fact) => fact.type === 'script_command')
        .filter(
          (fact) =>
            request.fileScope === undefined ||
            fact.anchors.some(
              (anchor) =>
                request.fileScope?.includes(anchor.filePath) || claimPaths.has(anchor.filePath)
            ) ||
            String(fact.value.path ?? '').endsWith('package.json')
        )
        .map((fact) => String(fact.value.command))
        .filter(Boolean)
    ),
  ];
}

export class BundlePlanner {
  constructor(private readonly store: CoreStore) {}

  plan(request: BundleRequest, now = new Date()): BundlePlanResult {
    const scopedViews = this.store.views
      .filter((view) => request.repoIds.includes(view.repoId))
      .map((view) => ({ view, score: scoreView(view, request) }))
      .sort(
        (left, right) => right.score - left.score || left.view.key.localeCompare(right.view.key)
      );
    const views = scopedViews
      .filter((entry) => entry.score > 0)
      .slice(0, 6)
      .map((entry) => entry.view);
    const fallbackViews =
      views.length > 0 ? views : scopedViews.slice(0, 3).map((entry) => entry.view);
    const selectedViews = fallbackViews;
    const viewClaimIds = new Set(selectedViews.flatMap((view) => view.claimIds));
    const directClaims = this.store.claims
      .filter((claim) => request.repoIds.includes(claim.repoId))
      .filter((claim) => matchesRequestScope(request, claim))
      .sort((left, right) => left.text.localeCompare(right.text));
    const claimIds = new Set([...viewClaimIds, ...directClaims.map((claim) => claim.id)]);
    const claims = this.store.claims
      .filter((claim) => claimIds.has(claim.id))
      .sort((left, right) => left.text.localeCompare(right.text));
    const fileScope = [
      ...new Set([
        ...(request.fileScope ?? []),
        ...selectedViews.flatMap((view) => view.fileScope ?? []),
        ...claims
          .map((claim) => claim.metadata?.filePath)
          .filter((filePath): filePath is string => typeof filePath === 'string'),
      ]),
    ];
    const proofHandles =
      request.constraints?.includeProofHandles === false
        ? []
        : claims.flatMap((claim) => claim.anchors).slice(0, 12);
    const commands = collectCommands(this.store.facts, request, claims);
    const includedReceipts = request.constraints?.includeReceipts
      ? this.store.receipts
          .filter((receipt) => receipt.status === 'validated')
          .filter((receipt) => receipt.repoIds.some((repoId) => request.repoIds.includes(repoId)))
          .map((receipt) => receipt.id)
      : [];
    const freshnessStates: FreshnessState[] = [
      ...selectedViews.map((view) => view.freshness),
      ...claims.map((claim) => claim.freshness),
      ...proofHandles.map(() => 'fresh' as const),
    ];
    const freshness = rollupFreshness(freshnessStates) as TaskBundle['freshness'];
    const warnings = [
      ...(selectedViews.length === 0 ? ['No matching views were selected'] : []),
      ...(claims.length === 0 ? ['No matching claims were selected'] : []),
      ...(freshness === 'fresh' ? [] : [`Bundle freshness is ${freshness}`]),
    ];
    const cacheKey = stableHash(
      JSON.stringify({
        taskTitle: request.taskTitle,
        taskDescription: request.taskDescription,
        repoIds: [...request.repoIds].sort(),
        fileScope: [...fileScope].sort(),
        symbolScope: [...(request.symbolScope ?? [])].sort(),
        role: request.role,
        constraints: request.constraints ?? {},
      })
    );
    const bundle: TaskBundle = {
      id: createId('bundle'),
      requestId: request.id,
      repoIds: request.repoIds,
      summary: `Bundle for ${request.taskTitle} across ${selectedViews.length} views and ${claims.length} claims`,
      selectedViewIds: selectedViews.map((view) => view.id),
      selectedClaimIds: claims.map((claim) => claim.id),
      fileScope,
      symbolScope: request.symbolScope ?? [],
      commands,
      proofHandles,
      freshness,
      cacheKey,
      metadata: {
        role: request.role ?? 'builder',
        parentBundleId: request.parentBundleId,
        externalRef: request.externalRef,
        includedReceiptIds: includedReceipts,
      },
      createdAt: nowIso(now),
      expiresAt: freshness === 'fresh' ? undefined : new Date(now.getTime() + 60_000).toISOString(),
    };

    this.store.bundles.push(bundle);

    return {
      bundle,
      selectedViews,
      selectedClaims: claims,
      warnings,
    };
  }
}
