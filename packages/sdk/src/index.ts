import { buildApiIndex, routeManifest } from '../../../apps/server/src/index';
import type {
  ApiSurface,
  BundlePlanInput,
  BundleRecord,
  FreshnessImpact,
  FreshnessState,
  ReceiptRecord,
  ReceiptSubmitInput,
  ServeReport,
  ServiceCapability,
  StorageSurface,
} from '../../../apps/server/src/index';
import {
  parseAgentReceipt,
  parseBundleRequest,
  parseClaimRecord,
  parseRepositoryRef,
  parseSourceAnchor,
  parseTaskBundle,
  parseViewRecord,
} from '../../protocol/src/index';
import type {
  AgentReceipt,
  BundlePlanResult,
  BundleRequest,
  ClaimRecord,
  ExternalRef,
  SourceAnchor,
  TaskBundle,
  ViewRecord,
} from '../../protocol/src/index';

export {
  parseAgentReceipt,
  parseBundleRequest,
  parseClaimRecord,
  parseRepositoryRef,
  parseSourceAnchor,
  parseTaskBundle,
  parseViewRecord,
};
export type {
  AgentReceipt,
  BundlePlanResult,
  BundleRequest,
  ClaimRecord,
  ExternalRef,
  SourceAnchor,
  TaskBundle,
  ViewRecord,
};
export type {
  ApiSurface,
  BundlePlanInput,
  BundleRecord,
  FreshnessImpact,
  FreshnessState,
  ReceiptRecord,
  ReceiptSubmitInput,
  ServeReport,
  ServiceCapability,
  StorageSurface,
};

export interface BundlePlanPayload {
  task: string;
  repo?: string;
  repoIds?: string[];
  parentBundleId?: string;
  fileScope?: string[];
  symbolScope?: string[];
}

export interface ReceiptSubmitPayload {
  bundle?: string;
  agent: string;
  summary: string;
}

export interface ScbsOperation {
  operationId: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  tag: 'System' | 'Bundles' | 'Freshness' | 'Receipts';
  successStatusCode: number;
}

export interface ApiIndex {
  service: string;
  status: string;
  api: ApiSurface;
  endpoints: {
    health: string;
    root: string;
    planBundle: string;
    showBundle: string;
    bundleFreshness: string;
    expireBundle: string;
    listBundleCache: string;
    clearBundleCache: string;
    freshnessImpacts: string;
    freshnessStatus: string;
    recomputeFreshness: string;
    createReceipt: string;
    listReceipts: string;
    showReceipt: string;
    validateReceipt: string;
    rejectReceipt: string;
  };
}

export const SCBS_API_VERSION = 'v1';
export const SCBS_API_ROOT = '/api/v1';

export const scbsOperations: ScbsOperation[] = routeManifest.map((route) => ({
  operationId: route.operationId,
  method: route.method,
  path: route.path,
  summary: route.summary,
  tag: route.tag,
  successStatusCode: route.success.statusCode,
}));

export function createApiIndex(report: ServeReport): ApiIndex {
  return buildApiIndex(report) as ApiIndex;
}

export function toBundlePlanPayload(input: BundlePlanInput): BundlePlanPayload {
  return {
    task: input.task,
    repo: input.repoId,
    repoIds: input.repoIds,
    parentBundleId: input.parentBundleId,
    fileScope: input.fileScope,
    symbolScope: input.symbolScope,
  };
}

export function fromBundlePlanPayload(payload: BundlePlanPayload): BundlePlanInput {
  return {
    task: payload.task,
    repoId: payload.repo,
    repoIds: payload.repoIds,
    parentBundleId: payload.parentBundleId,
    fileScope: payload.fileScope,
    symbolScope: payload.symbolScope,
  };
}

export function toReceiptSubmitPayload(input: ReceiptSubmitInput): ReceiptSubmitPayload {
  return {
    bundle: input.bundleId ?? undefined,
    agent: input.agent,
    summary: input.summary,
  };
}

export function fromReceiptSubmitPayload(payload: ReceiptSubmitPayload): ReceiptSubmitInput {
  return {
    bundleId: payload.bundle ?? null,
    agent: payload.agent,
    summary: payload.summary,
  };
}

export function listServiceCapabilities(api: ApiSurface): ServiceCapability[] {
  return [...api.capabilities];
}

export function createStorageReport(storage: StorageSurface): StorageSurface {
  return { ...storage };
}
