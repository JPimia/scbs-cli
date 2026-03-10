import type { ClaimRecord, ViewRecord } from '../../../protocol/src/index';

import { rollupFreshness } from '../../../freshness/src/index';

import { createId, nowIso } from '../utils';

export function deriveViews(repoId: string, claims: ClaimRecord[], now = new Date()): ViewRecord[] {
  return claims.map((claim) => ({
    id: createId('view'),
    repoId,
    type: claim.metadata?.filePath ? 'file_scope' : 'workflow',
    key: String(claim.metadata?.filePath ?? claim.id),
    title: String(claim.metadata?.filePath ?? 'Repository workflow'),
    summary: claim.text,
    claimIds: [claim.id],
    fileScope: claim.metadata?.filePath ? [String(claim.metadata.filePath)] : undefined,
    symbolScope: undefined,
    freshness: rollupFreshness([claim.freshness]) as ViewRecord['freshness'],
    metadata: {
      trustTier: claim.trustTier,
    },
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  }));
}
