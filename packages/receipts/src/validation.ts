import type { AgentReceipt, ClaimRecord, SourceAnchor } from '../../protocol/src/index';

export interface ReceiptClaimAdjustment {
  claimId: string;
  confidence: number;
  trustTier: ClaimRecord['trustTier'];
  freshness: ClaimRecord['freshness'];
  metadata: Record<string, unknown>;
}

export interface ValidationDecision {
  receipt: AgentReceipt;
  promotedClaims: ClaimRecord[];
  promotedClaim?: ClaimRecord;
}

function normalizedConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueAnchors(anchors: SourceAnchor[]): SourceAnchor[] {
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = [
      anchor.repoId,
      anchor.filePath,
      anchor.fileHash,
      anchor.startLine ?? '',
      anchor.endLine ?? '',
      anchor.symbolId ?? '',
      anchor.excerptHash ?? '',
    ].join(':');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function confidenceForReceiptType(receipt: AgentReceipt): number {
  switch (receipt.type) {
    case 'invariant':
    case 'test_result':
      return 0.92;
    case 'correction':
      return 0.88;
    case 'edge_case':
      return 0.84;
    default:
      return 0.82;
  }
}

function buildPromotedClaims(
  receipt: AgentReceipt,
  anchors: SourceAnchor[],
  invalidationKeys: string[],
  timestamp: string
): ClaimRecord[] {
  const baseRepoId = receipt.repoIds[0] ?? 'unknown';
  const baseConfidence = confidenceForReceiptType(receipt);
  const fileClaims = [...new Set(anchors.map((anchor) => anchor.filePath))]
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => {
      const fileAnchors = uniqueAnchors(anchors.filter((anchor) => anchor.filePath === filePath));
      const symbolIds = [...new Set(fileAnchors.map((anchor) => anchor.symbolId).filter(Boolean))];
      return {
        id: `claim_file_from_${receipt.id}_${filePath.replaceAll(/[^a-zA-Z0-9]+/g, '-')}`,
        repoId: baseRepoId,
        text: `${receipt.summary} is anchored in ${filePath}`,
        type: 'interpretive' as const,
        confidence: Math.max(0.75, baseConfidence - 0.04),
        trustTier: 'human' as const,
        factIds: [],
        anchors: fileAnchors,
        freshness: 'partial' as const,
        invalidationKeys: [filePath],
        metadata: {
          receiptId: receipt.id,
          receiptType: receipt.type,
          bundleId: receipt.bundleId,
          fromRole: receipt.fromRole,
          claimKind: 'receipt_file_observation',
          filePath,
          symbolIds,
          receiptRule: 'file-anchor',
        },
        createdAt: receipt.createdAt,
        updatedAt: timestamp,
      };
    });
  const symbolClaims = [...new Set(anchors.map((anchor) => anchor.symbolId).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right)))
    .map((symbolId) => {
      const symbolAnchors = uniqueAnchors(anchors.filter((anchor) => anchor.symbolId === symbolId));
      const filePath = symbolAnchors[0]?.filePath ?? invalidationKeys[0] ?? '.';
      return {
        id: `claim_symbol_from_${receipt.id}_${String(symbolId).replaceAll(/[^a-zA-Z0-9]+/g, '-')}`,
        repoId: baseRepoId,
        text: `${receipt.summary} is anchored to symbol ${String(symbolId)}`,
        type: 'interpretive' as const,
        confidence: Math.max(0.78, baseConfidence),
        trustTier: 'human' as const,
        factIds: [],
        anchors: symbolAnchors,
        freshness: 'partial' as const,
        invalidationKeys: [filePath],
        metadata: {
          receiptId: receipt.id,
          receiptType: receipt.type,
          bundleId: receipt.bundleId,
          fromRole: receipt.fromRole,
          claimKind: 'receipt_symbol_observation',
          filePath,
          symbolIds: [symbolId],
          receiptRule: 'symbol-anchor',
        },
        createdAt: receipt.createdAt,
        updatedAt: timestamp,
      };
    });

  return [
    {
      id: `claim_from_${receipt.id}`,
      repoId: baseRepoId,
      text: receipt.summary,
      type: 'human-authored',
      confidence: baseConfidence,
      trustTier: 'human',
      factIds: [],
      anchors: uniqueAnchors(anchors),
      freshness: 'partial',
      invalidationKeys,
      metadata: {
        receiptId: receipt.id,
        receiptType: receipt.type,
        bundleId: receipt.bundleId,
        fromRole: receipt.fromRole,
        claimKind: 'validated_receipt',
        filePath: invalidationKeys[0],
        receiptRule: 'summary',
      },
      createdAt: receipt.createdAt,
      updatedAt: timestamp,
    },
    ...fileClaims,
    ...symbolClaims,
  ];
}

export function validateReceipt(
  receipt: AgentReceipt,
  anchors: SourceAnchor[],
  now = new Date()
): ValidationDecision {
  if (anchors.length === 0) {
    throw new Error('Validated receipts require at least one source anchor');
  }
  const mismatchedAnchor = anchors.find((anchor) => !receipt.repoIds.includes(anchor.repoId));
  if (mismatchedAnchor) {
    throw new Error(`Anchor repo ${mismatchedAnchor.repoId} is not part of receipt scope`);
  }
  const invalidationKeys = [...new Set(anchors.map((anchor) => anchor.filePath))];
  const promotedClaims = buildPromotedClaims(receipt, anchors, invalidationKeys, now.toISOString());

  const validatedReceipt: AgentReceipt = {
    ...receipt,
    payload: {
      ...receipt.payload,
      validation: {
        anchors,
        invalidationKeys,
        promotedClaims,
      },
    },
    status: 'validated',
    updatedAt: now.toISOString(),
  };

  return {
    receipt: validatedReceipt,
    promotedClaims,
    promotedClaim: promotedClaims[0],
  };
}

export function adjustClaimFromValidatedReceipt(
  claim: ClaimRecord,
  receipt: AgentReceipt
): ReceiptClaimAdjustment | undefined {
  if (receipt.status !== 'validated') {
    return undefined;
  }
  if (claim.metadata?.receiptId === receipt.id) {
    return undefined;
  }

  const validation = (receipt.payload.validation ?? {}) as {
    anchors?: SourceAnchor[];
    invalidationKeys?: string[];
  };
  const anchors = Array.isArray(validation.anchors) ? validation.anchors : [];
  const invalidationKeys = Array.isArray(validation.invalidationKeys)
    ? validation.invalidationKeys
    : [];
  const overlaps = claim.anchors.some((anchor) =>
    anchors.some(
      (receiptAnchor) =>
        receiptAnchor.repoId === anchor.repoId &&
        (receiptAnchor.symbolId !== undefined &&
        anchor.symbolId !== undefined &&
        receiptAnchor.symbolId === anchor.symbolId
          ? true
          : receiptAnchor.filePath === anchor.filePath)
    )
  );
  const invalidationOverlap = claim.invalidationKeys.some((key) => invalidationKeys.includes(key));
  if (!overlaps && !invalidationOverlap) {
    return undefined;
  }

  const receiptMeta = {
    receiptId: receipt.id,
    receiptType: receipt.type,
    validatedAt: receipt.updatedAt,
    overlap: overlaps ? 'anchor' : 'invalidation',
  };
  if (receipt.type === 'correction') {
    return {
      claimId: claim.id,
      confidence: normalizedConfidence(Math.max(0.1, claim.confidence - 0.2)),
      trustTier: claim.trustTier,
      freshness: claim.freshness === 'fresh' ? 'partial' : claim.freshness,
      metadata: {
        ...(claim.metadata ?? {}),
        receiptCorrections: [
          ...(((claim.metadata?.receiptCorrections as unknown[]) ?? []) as unknown[]),
          receiptMeta,
        ],
      },
    };
  }

  return {
    claimId: claim.id,
    confidence: normalizedConfidence(Math.min(1, claim.confidence + 0.08)),
    trustTier: claim.trustTier === 'provisional' ? 'derived' : claim.trustTier,
    freshness: claim.freshness,
    metadata: {
      ...(claim.metadata ?? {}),
      receiptSupport: [
        ...(((claim.metadata?.receiptSupport as unknown[]) ?? []) as unknown[]),
        receiptMeta,
      ],
    },
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
