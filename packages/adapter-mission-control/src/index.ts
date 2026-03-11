import type {
  BundlePlanInput,
  BundleRecord,
  ReceiptRecord,
  ReceiptSubmitInput,
} from '../../sdk/src/index';

export interface MissionControlTaskEnvelope {
  missionId: string;
  objective: string;
  repoIds: string[];
  bundleParentId?: string;
  fileTargets?: string[];
  symbolTargets?: string[];
}

export interface MissionControlReceiptEnvelope {
  missionId: string;
  reporter: string;
  notes: string;
  bundleRef?: string;
}

export interface MissionControlBundleStatus {
  missionId: string;
  bundleId: string;
  task: string;
  repoIds: string[];
  trackedViewIds: string[];
  freshness: BundleRecord['freshness'];
  bundleParentId?: string;
}

export interface MissionControlReceiptStatus {
  missionId: string;
  receiptId: string;
  reporter: string;
  notes: string;
  state: ReceiptRecord['status'];
  bundleRef?: string;
}

export function mapMissionControlTaskToBundlePlanInput(
  task: MissionControlTaskEnvelope
): BundlePlanInput {
  return {
    id: `req_mc_${task.missionId}_${task.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    taskTitle: task.objective,
    repoIds: task.repoIds,
    parentBundleId: task.bundleParentId,
    fileScope: task.fileTargets,
    symbolScope: task.symbolTargets,
  };
}

export function mapBundleRecordToMissionControlStatus(
  bundle: BundleRecord,
  missionId: string
): MissionControlBundleStatus {
  return {
    missionId,
    bundleId: bundle.id,
    task: bundle.summary,
    repoIds: bundle.repoIds,
    trackedViewIds: bundle.selectedViewIds,
    freshness: bundle.freshness,
    bundleParentId:
      typeof bundle.metadata?.parentBundleId === 'string'
        ? bundle.metadata.parentBundleId
        : undefined,
  };
}

export function mapMissionControlReceiptToReceiptSubmitInput(
  receipt: MissionControlReceiptEnvelope
): ReceiptSubmitInput {
  return {
    bundleId: receipt.bundleRef ?? null,
    agent: receipt.reporter,
    summary: receipt.notes,
  };
}

export function mapReceiptRecordToMissionControlStatus(
  receipt: ReceiptRecord,
  missionId: string
): MissionControlReceiptStatus {
  return {
    missionId,
    receiptId: receipt.id,
    reporter: receipt.agent,
    notes: receipt.summary,
    state: receipt.status,
    bundleRef: receipt.bundleId ?? undefined,
  };
}
