import type { ClaimRecord, ViewRecord } from '../../../protocol/src/index';

import { rollupFreshness } from '../../../freshness/src/index';

import { deterministicId, nowIso } from '../utils';

export function deriveViews(repoId: string, claims: ClaimRecord[], now = new Date()): ViewRecord[] {
  const repoClaims = claims.filter((claim) => claim.repoId === repoId);
  const fileGroups = new Map<string, ClaimRecord[]>();
  const workflowGroups = new Map<string, ClaimRecord[]>();

  for (const claim of repoClaims) {
    const filePath =
      typeof claim.metadata?.filePath === 'string' ? claim.metadata.filePath : undefined;
    if (filePath) {
      fileGroups.set(filePath, [...(fileGroups.get(filePath) ?? []), claim]);
    }
    if (claim.metadata?.claimKind === 'script_command') {
      const workflowKey = String(claim.metadata.source ?? filePath ?? claim.id);
      workflowGroups.set(workflowKey, [...(workflowGroups.get(workflowKey) ?? []), claim]);
    }
  }

  const views: ViewRecord[] = [];

  for (const [filePath, fileClaims] of [...fileGroups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const exportedSymbols = fileClaims
      .filter((claim) => claim.metadata?.claimKind === 'symbol_export')
      .map((claim) => String(claim.metadata?.symbolName))
      .filter(Boolean)
      .sort();
    const commands = fileClaims
      .filter((claim) => claim.metadata?.claimKind === 'script_command')
      .map((claim) => String(claim.metadata?.scriptName))
      .filter(Boolean)
      .sort();
    const summaryParts = [`${filePath} contributes ${fileClaims.length} anchored claim(s)`];
    if (exportedSymbols.length > 0) {
      summaryParts.push(`exports ${exportedSymbols.join(', ')}`);
    }
    if (commands.length > 0) {
      summaryParts.push(`defines commands ${commands.join(', ')}`);
    }
    views.push({
      id: deterministicId('view', repoId, 'file_scope', filePath),
      repoId,
      type: 'file_scope',
      key: filePath,
      title: filePath,
      summary: summaryParts.join(' and '),
      claimIds: fileClaims.map((claim) => claim.id),
      fileScope: [filePath],
      symbolScope: exportedSymbols,
      freshness: rollupFreshness(
        fileClaims.map((claim) => claim.freshness)
      ) as ViewRecord['freshness'],
      metadata: {
        trustTier: fileClaims.some((claim) => claim.trustTier === 'source') ? 'source' : 'derived',
        anchorCount: fileClaims.flatMap((claim) => claim.anchors).length,
      },
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    });
  }

  for (const [workflowKey, workflowClaims] of [...workflowGroups.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const commandNames = workflowClaims
      .map((claim) => String(claim.metadata?.scriptName ?? claim.metadata?.source ?? claim.id))
      .sort();
    const fileScope = [
      ...new Set(
        workflowClaims
          .map((claim) => claim.metadata?.filePath)
          .filter((filePath): filePath is string => typeof filePath === 'string')
      ),
    ];
    views.push({
      id: deterministicId('view', repoId, 'command_workflow', workflowKey),
      repoId,
      type: 'command_workflow',
      key: workflowKey,
      title: `Workflow ${workflowKey}`,
      summary: `${workflowKey} exposes commands ${commandNames.join(', ')}`,
      claimIds: workflowClaims.map((claim) => claim.id),
      fileScope,
      symbolScope: undefined,
      freshness: rollupFreshness(
        workflowClaims.map((claim) => claim.freshness)
      ) as ViewRecord['freshness'],
      metadata: {
        trustTier: 'source',
      },
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    });
  }

  return views;
}
