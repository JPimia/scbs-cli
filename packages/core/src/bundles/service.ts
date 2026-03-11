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

const MAX_SELECTED_VIEWS = 6;
const MAX_FALLBACK_VIEWS = 3;
const MAX_PROOF_HANDLES = 12;

interface InheritedBundleContext {
  bundleId: string;
  freshness: TaskBundle['freshness'];
  fileScope: string[];
  symbolScope: string[];
  selectedViewIds: string[];
  selectedClaimIds: string[];
  commands: string[];
  proofHandles: TaskBundle['proofHandles'];
}

function dedupeStable<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function anchorKey(anchor: TaskBundle['proofHandles'][number]): string {
  return stableHash(JSON.stringify(anchor));
}

function buildInheritedContext(
  store: CoreStore,
  request: BundleRequest
): InheritedBundleContext | undefined {
  if (!request.parentBundleId) {
    return undefined;
  }

  const parentBundle = store.bundles.find((bundle) => bundle.id === request.parentBundleId);
  if (!parentBundle) {
    throw new Error(`Parent bundle "${request.parentBundleId}" was not found.`);
  }

  return {
    bundleId: parentBundle.id,
    freshness: parentBundle.freshness,
    fileScope: [...parentBundle.fileScope],
    symbolScope: [...parentBundle.symbolScope],
    selectedViewIds: [...parentBundle.selectedViewIds],
    selectedClaimIds: [...parentBundle.selectedClaimIds],
    commands: [...parentBundle.commands],
    proofHandles: [...parentBundle.proofHandles],
  };
}

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

function collectInheritedViews(
  scopedViews: Array<{ view: ViewRecord; score: number }>,
  inherited: InheritedBundleContext | undefined,
  request: BundleRequest
): ViewRecord[] {
  if (!inherited) {
    return [];
  }

  const inheritedViewIds = new Set(inherited.selectedViewIds);
  return scopedViews
    .map((entry) => entry.view)
    .filter((view) => inheritedViewIds.has(view.id))
    .filter(
      (view) =>
        view.fileScope?.some((filePath) => request.fileScope?.includes(filePath)) ||
        view.symbolScope?.some((symbol) => request.symbolScope?.includes(symbol))
    );
}

function collectClaims(
  store: CoreStore,
  request: BundleRequest,
  selectedViews: ViewRecord[],
  inherited: InheritedBundleContext | undefined
): ClaimRecord[] {
  const viewClaimIds = new Set(selectedViews.flatMap((view) => view.claimIds));
  const directClaims = store.claims
    .filter((claim) => request.repoIds.includes(claim.repoId))
    .filter((claim) => matchesRequestScope(request, claim))
    .sort((left, right) => left.text.localeCompare(right.text));
  const directClaimIds = new Set(directClaims.map((claim) => claim.id));
  const inheritedClaimIds = new Set(inherited?.selectedClaimIds ?? []);
  const claimIds = new Set([
    ...viewClaimIds,
    ...directClaimIds,
    ...[...inheritedClaimIds].filter(
      (claimId) =>
        directClaimIds.has(claimId) || selectedViews.some((view) => view.claimIds.includes(claimId))
    ),
  ]);

  return store.claims
    .filter((claim) => claimIds.has(claim.id))
    .sort((left, right) => left.text.localeCompare(right.text));
}

function proofHandleMatchesScope(
  anchor: TaskBundle['proofHandles'][number],
  request: BundleRequest,
  fileScope: string[]
): boolean {
  return request.repoIds.includes(anchor.repoId) && fileScope.includes(anchor.filePath);
}

export class BundlePlanner {
  constructor(private readonly store: CoreStore) {}

  plan(request: BundleRequest, now = new Date()): BundlePlanResult {
    const inherited = buildInheritedContext(this.store, request);
    const mergedRequest: BundleRequest = {
      ...request,
      fileScope: dedupeStable([...(request.fileScope ?? []), ...(inherited?.fileScope ?? [])]),
      symbolScope: dedupeStable([
        ...(request.symbolScope ?? []),
        ...(inherited?.symbolScope ?? []),
      ]),
    };

    const scopedViews = this.store.views
      .filter((view) => mergedRequest.repoIds.includes(view.repoId))
      .map((view) => ({ view, score: scoreView(view, mergedRequest) }))
      .sort(
        (left, right) => right.score - left.score || left.view.key.localeCompare(right.view.key)
      );
    const matchedViews = scopedViews
      .filter((entry) => entry.score > 0)
      .slice(0, MAX_SELECTED_VIEWS)
      .map((entry) => entry.view);
    const fallbackViews =
      matchedViews.length > 0
        ? matchedViews
        : scopedViews.slice(0, MAX_FALLBACK_VIEWS).map((entry) => entry.view);
    const selectedViews = dedupeStable([
      ...collectInheritedViews(scopedViews, inherited, mergedRequest),
      ...fallbackViews,
    ]).slice(0, MAX_SELECTED_VIEWS);
    const claims = collectClaims(this.store, mergedRequest, selectedViews, inherited);
    const fileScope = dedupeStable([
      ...(mergedRequest.fileScope ?? []),
      ...selectedViews.flatMap((view) => view.fileScope ?? []),
      ...claims
        .map((claim) => claim.metadata?.filePath)
        .filter((filePath): filePath is string => typeof filePath === 'string'),
    ]);
    const symbolScope = dedupeStable([
      ...(mergedRequest.symbolScope ?? []),
      ...selectedViews.flatMap((view) => view.symbolScope ?? []),
      ...claims
        .map((claim) => claim.metadata?.symbolName)
        .filter((symbolName): symbolName is string => typeof symbolName === 'string'),
    ]);
    const derivedProofHandles =
      mergedRequest.constraints?.includeProofHandles === false
        ? []
        : claims.flatMap((claim) => claim.anchors);
    const inheritedProofHandles =
      mergedRequest.constraints?.includeProofHandles === false
        ? []
        : (inherited?.proofHandles ?? []).filter((anchor) =>
            proofHandleMatchesScope(anchor, mergedRequest, fileScope)
          );
    const proofHandlesByKey = new Map<string, TaskBundle['proofHandles'][number]>();
    for (const anchor of [...inheritedProofHandles, ...derivedProofHandles]) {
      proofHandlesByKey.set(anchorKey(anchor), anchor);
    }
    const proofHandles = [...proofHandlesByKey.values()].slice(0, MAX_PROOF_HANDLES);
    const derivedCommands = collectCommands(this.store.facts, mergedRequest, claims);
    const commands = dedupeStable([
      ...(inherited?.commands ?? []).filter((command) => derivedCommands.includes(command)),
      ...derivedCommands,
    ]);
    const includedReceipts = mergedRequest.constraints?.includeReceipts
      ? this.store.receipts
          .filter((receipt) => receipt.status === 'validated')
          .filter((receipt) =>
            receipt.repoIds.some((repoId) => mergedRequest.repoIds.includes(repoId))
          )
          .map((receipt) => receipt.id)
      : [];
    const freshnessStates: FreshnessState[] = [
      ...selectedViews.map((view) => view.freshness),
      ...claims.map((claim) => claim.freshness),
      ...proofHandles.map(() => 'fresh' as const),
      ...(inherited ? [inherited.freshness] : []),
    ];
    const freshness = rollupFreshness(freshnessStates) as TaskBundle['freshness'];
    const warnings = [
      ...(selectedViews.length === 0 ? ['No matching views were selected'] : []),
      ...(claims.length === 0 ? ['No matching claims were selected'] : []),
      ...(inherited && inherited.freshness !== 'fresh'
        ? [`Inherited parent bundle context is ${inherited.freshness}`]
        : []),
      ...(freshness === 'fresh' ? [] : [`Bundle freshness is ${freshness}`]),
    ];
    const cacheKey = stableHash(
      JSON.stringify({
        taskTitle: mergedRequest.taskTitle,
        taskDescription: mergedRequest.taskDescription,
        repoIds: [...mergedRequest.repoIds].sort(),
        fileScope: [...fileScope].sort(),
        symbolScope: [...symbolScope].sort(),
        role: mergedRequest.role,
        constraints: mergedRequest.constraints ?? {},
        inheritedContext:
          inherited === undefined
            ? null
            : {
                bundleId: inherited.bundleId,
                freshness: inherited.freshness,
                fileScope: [...inherited.fileScope],
                symbolScope: [...inherited.symbolScope],
                selectedViewIds: [...inherited.selectedViewIds],
                selectedClaimIds: [...inherited.selectedClaimIds],
                commands: [...inherited.commands],
                proofHandles: inherited.proofHandles.map((anchor) => anchorKey(anchor)),
              },
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
      symbolScope,
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
