import type { AgentReceipt, ClaimRecord } from '../../protocol/src/index';

export function filterActiveReceipts(receipts: AgentReceipt[]): AgentReceipt[] {
  return receipts.filter((receipt) => receipt.status !== 'rejected');
}

export function claimsFromReceipts(receipts: AgentReceipt[]): ClaimRecord[] {
  return receipts
    .filter((receipt) => receipt.status === 'validated')
    .map((receipt) => ({
      id: `claim_${receipt.id}`,
      repoId: receipt.repoIds[0] ?? 'unknown',
      text: receipt.summary,
      type: 'provisional',
      confidence: 0.6,
      trustTier: 'provisional',
      factIds: [],
      anchors: [],
      freshness: 'partial',
      invalidationKeys: [],
      metadata: { receiptId: receipt.id },
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
    }));
}
