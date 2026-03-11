import type { AgentReceipt, ClaimRecord } from '../../protocol/src/index';

export function filterActiveReceipts(receipts: AgentReceipt[]): AgentReceipt[] {
  return receipts.filter((receipt) => receipt.status !== 'rejected');
}

export function claimsFromReceipts(receipts: AgentReceipt[]): ClaimRecord[] {
  return receipts
    .filter((receipt) => receipt.status === 'validated')
    .map((receipt) => {
      const validation = (receipt.payload.validation ?? {}) as {
        anchors?: ClaimRecord['anchors'];
        invalidationKeys?: string[];
      };
      return {
        id: `claim_${receipt.id}`,
        repoId: receipt.repoIds[0] ?? 'unknown',
        text: receipt.summary,
        type: 'provisional',
        confidence: 0.6,
        trustTier: 'provisional',
        factIds: [],
        anchors: Array.isArray(validation.anchors) ? validation.anchors : [],
        freshness: 'partial',
        invalidationKeys: Array.isArray(validation.invalidationKeys)
          ? validation.invalidationKeys
          : [],
        metadata: {
          receiptId: receipt.id,
          receiptType: receipt.type,
          claimKind: 'validated_receipt',
        },
        createdAt: receipt.createdAt,
        updatedAt: receipt.updatedAt,
      };
    });
}
