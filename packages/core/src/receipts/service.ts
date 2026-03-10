import type { AgentReceipt, SourceAnchor } from '../../../protocol/src/index';
import {
  claimsFromReceipts,
  ingestReceipt,
  rejectReceipt,
  validateReceipt,
} from '../../../receipts/src/index';

import type { CoreStore } from '../storage/memory-store';
import { createId } from '../utils';

export class ReceiptService {
  constructor(private readonly store: CoreStore) {}

  submit(input: Parameters<typeof ingestReceipt>[1]): AgentReceipt {
    const receipt = ingestReceipt(createId('rcpt'), input);
    this.store.receipts.push(receipt);
    return receipt;
  }

  list(): AgentReceipt[] {
    return [...this.store.receipts];
  }

  validate(id: string, anchors: SourceAnchor[]): AgentReceipt {
    const receipt = this.store.receipts.find((entry) => entry.id === id);
    if (!receipt) {
      throw new Error(`Receipt ${id} not found`);
    }
    const decision = validateReceipt(receipt, anchors);
    this.store.receipts = this.store.receipts.map((entry) =>
      entry.id === id ? decision.receipt : entry
    );
    if (decision.promotedClaim) {
      this.store.claims.push(decision.promotedClaim);
    }
    return decision.receipt;
  }

  reject(id: string, reason: string): AgentReceipt {
    const receipt = this.store.receipts.find((entry) => entry.id === id);
    if (!receipt) {
      throw new Error(`Receipt ${id} not found`);
    }
    const rejected = rejectReceipt(receipt, reason);
    this.store.receipts = this.store.receipts.map((entry) => (entry.id === id ? rejected : entry));
    return rejected;
  }

  promotedClaims() {
    return claimsFromReceipts(this.store.receipts);
  }
}
