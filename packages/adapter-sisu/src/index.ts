import type {
  BundlePlanInput,
  BundleRecord,
  ReceiptRecord,
  ReceiptSubmitInput,
} from '../../sdk/src/index';

export interface SisuBundlePlanJob {
  workspaceId: string;
  objective: string;
  repositoryIds: string[];
  parentContextId?: string;
  focusFiles?: string[];
  focusSymbols?: string[];
}

export interface SisuReceiptNote {
  workspaceId: string;
  agent: string;
  summary: string;
  bundleContextId?: string;
}

export interface SisuBundleSnapshot {
  workspaceId: string;
  bundleId: string;
  objective: string;
  repositoryIds: string[];
  viewIds: string[];
  freshness: BundleRecord['freshness'];
  parentContextId?: string;
  focusFiles?: string[];
  focusSymbols?: string[];
}

export interface SisuReceiptSnapshot {
  workspaceId: string;
  receiptId: string;
  agent: string;
  summary: string;
  status: ReceiptRecord['status'];
  bundleContextId?: string;
}

export function mapSisuBundlePlanJobToBundlePlanInput(job: SisuBundlePlanJob): BundlePlanInput {
  return {
    id: `req_sisu_${job.workspaceId}_${job.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    taskTitle: job.objective,
    repoIds: job.repositoryIds,
    parentBundleId: job.parentContextId,
    fileScope: job.focusFiles,
    symbolScope: job.focusSymbols,
  };
}

export function mapBundleRecordToSisuBundleSnapshot(
  bundle: BundleRecord,
  workspaceId: string
): SisuBundleSnapshot {
  return {
    workspaceId,
    bundleId: bundle.id,
    objective: bundle.summary,
    repositoryIds: bundle.repoIds,
    viewIds: bundle.selectedViewIds,
    freshness: bundle.freshness,
    parentContextId:
      typeof bundle.metadata?.parentBundleId === 'string'
        ? bundle.metadata.parentBundleId
        : undefined,
    focusFiles: bundle.fileScope,
    focusSymbols: bundle.symbolScope,
  };
}

export function mapSisuReceiptNoteToReceiptSubmitInput(note: SisuReceiptNote): ReceiptSubmitInput {
  return {
    bundleId: note.bundleContextId ?? null,
    agent: note.agent,
    summary: note.summary,
  };
}

export function mapReceiptRecordToSisuReceiptSnapshot(
  receipt: ReceiptRecord,
  workspaceId: string
): SisuReceiptSnapshot {
  return {
    workspaceId,
    receiptId: receipt.id,
    agent: receipt.agent,
    summary: receipt.summary,
    status: receipt.status,
    bundleContextId: receipt.bundleId ?? undefined,
  };
}
