import { rollupFreshness } from '../../../freshness/src/index';
import type {
  BundlePlanResult,
  BundleRequest,
  ClaimRecord,
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

export class BundlePlanner {
  constructor(private readonly store: CoreStore) {}

  plan(request: BundleRequest, now = new Date()): BundlePlanResult {
    const views = this.store.views
      .filter((view) => request.repoIds.includes(view.repoId))
      .map((view) => ({ view, score: scoreView(view, request) }))
      .sort(
        (left, right) => right.score - left.score || left.view.key.localeCompare(right.view.key)
      )
      .slice(0, 5)
      .map((entry) => entry.view);

    const claimIds = new Set(views.flatMap((view) => view.claimIds));
    const claims = this.store.claims.filter((claim) => claimIds.has(claim.id));
    const fileScope = [
      ...new Set([...(request.fileScope ?? []), ...views.flatMap((view) => view.fileScope ?? [])]),
    ];
    const proofHandles = claims.flatMap((claim) => claim.anchors).slice(0, 10);
    const commands = this.store.facts
      .filter(
        (fact) => claimIds.has(fact.subjectId) || fileScope.includes(String(fact.value.path ?? ''))
      )
      .filter((fact) => fact.type === 'script_command')
      .map((fact) => String(fact.value.command));
    const freshness = rollupFreshness([
      ...views.map((view) => view.freshness),
      ...claims.map((claim) => claim.freshness),
    ]) as TaskBundle['freshness'];
    const warnings = freshness === 'fresh' ? [] : [`Bundle freshness is ${freshness}`];
    const cacheKey = stableHash(
      JSON.stringify({
        taskTitle: request.taskTitle,
        repoIds: request.repoIds,
        fileScope,
      })
    );
    const bundle: TaskBundle = {
      id: createId('bundle'),
      requestId: request.id,
      repoIds: request.repoIds,
      summary: `Bundle for ${request.taskTitle} across ${views.length} views`,
      selectedViewIds: views.map((view) => view.id),
      selectedClaimIds: claims.map((claim) => claim.id),
      fileScope,
      symbolScope: request.symbolScope ?? [],
      commands: [...new Set(commands)],
      proofHandles,
      freshness,
      cacheKey,
      metadata: {
        role: request.role ?? 'builder',
        parentBundleId: request.parentBundleId,
      },
      createdAt: nowIso(now),
      expiresAt: freshness === 'fresh' ? undefined : new Date(now.getTime() + 60_000).toISOString(),
    };

    this.store.bundles.push(bundle);

    return {
      bundle,
      selectedViews: views,
      selectedClaims: claims,
      warnings,
    };
  }
}
