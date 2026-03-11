import type { AgentReceipt, SourceAnchor } from '../../../protocol/src/index';
import {
  adjustClaimFromValidatedReceipt,
  claimsFromReceipts,
  ingestReceipt,
  rejectReceipt,
  validateReceipt,
} from '../../../receipts/src/index';

import type { CoreStore } from '../storage/memory-store';
import { createId } from '../utils';
import { deriveViews } from '../views/service';

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
    if (decision.promotedClaims.length > 0) {
      const promotedIds = new Set(decision.promotedClaims.map((claim) => claim.id));
      this.store.claims = this.store.claims
        .map((claim) => {
          const adjustment = adjustClaimFromValidatedReceipt(claim, decision.receipt);
          if (!adjustment || promotedIds.has(claim.id)) {
            return claim;
          }
          return {
            ...claim,
            confidence: adjustment.confidence,
            trustTier: adjustment.trustTier,
            freshness: adjustment.freshness,
            metadata: adjustment.metadata,
            updatedAt: decision.receipt.updatedAt,
          };
        })
        .filter((claim) => !promotedIds.has(claim.id))
        .concat(decision.promotedClaims);
      const affectedRepoIds = new Set(decision.promotedClaims.map((claim) => claim.repoId));
      for (const repoId of affectedRepoIds) {
        const hasGraphInputs =
          this.store.files.length > 0 ||
          this.store.symbols.length > 0 ||
          this.store.edges.length > 0;
        const repoViews = hasGraphInputs
          ? deriveViews(
              repoId,
              this.store.files,
              this.store.symbols,
              this.store.claims,
              this.store.edges
            )
          : deriveViews(repoId, this.store.claims);
        this.store.views = this.store.views
          .filter((view) => view.repoId !== repoId)
          .concat(repoViews);
      }
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
