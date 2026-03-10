import type { AgentReceipt, ReceiptType } from '../../protocol/src/index';

export interface ReceiptSubmission {
  repoIds: string[];
  bundleId?: string;
  fromRole?: string;
  fromRunId?: string;
  type: ReceiptType;
  summary: string;
  payload: Record<string, unknown>;
}

export function ingestReceipt(
  id: string,
  input: ReceiptSubmission,
  now = new Date()
): AgentReceipt {
  return {
    id,
    repoIds: input.repoIds,
    bundleId: input.bundleId,
    fromRole: input.fromRole,
    fromRunId: input.fromRunId,
    type: input.type,
    summary: input.summary,
    payload: input.payload,
    status: 'provisional',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
