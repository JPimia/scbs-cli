import type { TaskBundle, ViewRecord } from '../../protocol/src/index';
import {
  type BundleRecord,
  type FreshnessImpact,
  type ReceiptRecord,
  type ServeReport,
  createApiIndex,
  scbsOperations,
} from '../../sdk/src/index';

export interface EndpointViewModel {
  operationId: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  tag: string;
}

export interface ApiIndexViewModel {
  service: string;
  status: 'ready' | 'listening';
  apiVersion: string;
  capabilityNames: string[];
  endpoints: EndpointViewModel[];
}

export interface BundleRecordViewModel {
  id: string;
  task: string;
  repoCount: number;
  viewCount: number;
  freshness: BundleRecord['freshness'];
  scopeSummary: string;
  parentBundleId?: string;
}

export interface TaskBundleViewModel {
  id: string;
  summary: string;
  freshness: TaskBundle['freshness'];
  commandCount: number;
  proofHandleCount: number;
  scopeSummary: string;
}

export interface ProtocolViewModel {
  id: string;
  key: string;
  title: string;
  summary: string;
  freshness: ViewRecord['freshness'];
  claimCount: number;
  fileScopeCount: number;
  symbolScopeCount: number;
}

export interface FreshnessImpactViewModel {
  label: string;
  artifactId: string;
  state: FreshnessImpact['state'];
}

export interface ReceiptRecordViewModel {
  id: string;
  agent: string;
  summary: string;
  status: ReceiptRecord['status'];
  bundleLabel: string;
}

export function presentApiIndex(report: ServeReport): ApiIndexViewModel {
  const index = createApiIndex(report);
  return {
    service: index.service,
    status: report.status,
    apiVersion: index.api.apiVersion,
    capabilityNames: index.api.capabilities.map((capability) => capability.name),
    endpoints: scbsOperations.map((operation) => ({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      summary: operation.summary,
      tag: operation.tag,
    })),
  };
}

export function presentBundleRecord(bundle: BundleRecord): BundleRecordViewModel {
  return {
    id: bundle.id,
    task: bundle.task,
    repoCount: bundle.repoIds.length,
    viewCount: bundle.viewIds.length,
    freshness: bundle.freshness,
    scopeSummary: summarizeScope(bundle.fileScope, bundle.symbolScope),
    parentBundleId: bundle.parentBundleId,
  };
}

export function presentTaskBundle(bundle: TaskBundle): TaskBundleViewModel {
  return {
    id: bundle.id,
    summary: bundle.summary,
    freshness: bundle.freshness,
    commandCount: bundle.commands.length,
    proofHandleCount: bundle.proofHandles.length,
    scopeSummary: summarizeScope(bundle.fileScope, bundle.symbolScope),
  };
}

export function presentProtocolView(view: ViewRecord): ProtocolViewModel {
  return {
    id: view.id,
    key: view.key,
    title: view.title,
    summary: view.summary,
    freshness: view.freshness,
    claimCount: view.claimIds.length,
    fileScopeCount: view.fileScope?.length ?? 0,
    symbolScopeCount: view.symbolScope?.length ?? 0,
  };
}

export function presentFreshnessImpact(impact: FreshnessImpact): FreshnessImpactViewModel {
  return {
    label: `${impact.artifactType}:${impact.state}`,
    artifactId: impact.artifactId,
    state: impact.state,
  };
}

export function presentReceiptRecord(receipt: ReceiptRecord): ReceiptRecordViewModel {
  return {
    id: receipt.id,
    agent: receipt.agent,
    summary: receipt.summary,
    status: receipt.status,
    bundleLabel: receipt.bundleId ?? 'unscoped',
  };
}

function summarizeScope(fileScope?: string[], symbolScope?: string[]): string {
  const fileCount = fileScope?.length ?? 0;
  const symbolCount = symbolScope?.length ?? 0;
  return `${fileCount} files / ${symbolCount} symbols`;
}
