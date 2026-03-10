import type { AgentReceipt, ClaimRecord, SourceAnchor } from '../../protocol/src/index';

export interface ValidationDecision {
  receipt: AgentReceipt;
  promotedClaim?: ClaimRecord;
}

export function validateReceipt(
  receipt: AgentReceipt,
  anchors: SourceAnchor[],
  now = new Date()
): ValidationDecision {
  if (anchors.length === 0) {
    throw new Error('Validated receipts require at least one source anchor');
  }

  const validatedReceipt: AgentReceipt = {
    ...receipt,
    status: 'validated',
    updatedAt: now.toISOString(),
  };

  const promotedClaim: ClaimRecord = {
    id: `claim_from_${receipt.id}`,
    repoId: receipt.repoIds[0] ?? 'unknown',
    text: receipt.summary,
    type: 'provisional',
    confidence: 0.7,
    trustTier: 'provisional',
    factIds: [],
    anchors,
    freshness: 'partial',
    invalidationKeys: anchors.map((anchor) => anchor.filePath),
    metadata: {
      receiptId: receipt.id,
      receiptType: receipt.type,
    },
    createdAt: receipt.createdAt,
    updatedAt: now.toISOString(),
  };

  return {
    receipt: validatedReceipt,
    promotedClaim,
  };
}

export function rejectReceipt(
  receipt: AgentReceipt,
  reason: string,
  now = new Date()
): AgentReceipt {
  return {
    ...receipt,
    status: 'rejected',
    payload: {
      ...receipt.payload,
      rejectionReason: reason,
    },
    updatedAt: now.toISOString(),
  };
}
