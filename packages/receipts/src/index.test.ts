import { describe, expect, it } from 'bun:test';

import { ingestReceipt, rejectReceipt, validateReceipt } from './index';

describe('receipts', () => {
  it('keeps receipts provisional until validated', () => {
    const receipt = ingestReceipt('rcpt_1', {
      repoIds: ['repo_1'],
      type: 'finding',
      summary: 'Need to rerun tests',
      payload: { command: 'bun test' },
    });

    const decision = validateReceipt(receipt, [
      { repoId: 'repo_1', filePath: 'package.json', fileHash: 'abc' },
    ]);

    expect(receipt.status).toBe('provisional');
    expect(decision.receipt.status).toBe('validated');
    expect(decision.promotedClaim?.metadata?.receiptId).toBe('rcpt_1');
  });

  it('records rejection reason', () => {
    const receipt = ingestReceipt('rcpt_2', {
      repoIds: ['repo_1'],
      type: 'correction',
      summary: 'Old summary was wrong',
      payload: {},
    });

    const rejected = rejectReceipt(receipt, 'No supporting evidence');
    expect(rejected.status).toBe('rejected');
    expect(rejected.payload.rejectionReason).toBe('No supporting evidence');
  });
});
