import { buildApiIndex, routeManifest } from '../../../apps/server/src/index';
import type {
  ApiSurface,
  DoctorReport,
  FreshnessEventRecord,
  FreshnessImpact,
  FreshnessJobKind,
  FreshnessJobRecord,
  FreshnessState,
  FreshnessWorkerReport,
  JobListReport,
  ReceiptRecord,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ServeReport,
  FactRecord as ServerFactRecord,
  RepoRecord as ServerRepoRecord,
  ServiceCapability,
  StorageSurface,
} from '../../../apps/server/src/index';
import type {
  ClaimRecord as ServerClaimRecord,
  ViewRecord as ServerViewRecord,
} from '../../../apps/server/src/types';
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
  DoctorReport,
  FreshnessEventRecord,
  RegisterRepoInput,
  FreshnessImpact,
  FreshnessJobKind,
  FreshnessJobRecord,
  FreshnessState,
  FreshnessWorkerReport,
  JobListReport,
  ReceiptRecord,
  ReceiptSubmitInput,
  RepoChangesInput,
  ServeReport,
  ServiceCapability,
  StorageSurface,
};
export type BundlePlanInput = BundleRequest;
export type BundleRecord = TaskBundle;
export interface ScbsRepoRecord extends ServerRepoRecord {}
export interface ScbsFactRecord extends ServerFactRecord {}
export interface ScbsClaimRecord extends ServerClaimRecord {}
export interface ScbsViewRecord extends ServerViewRecord {}

export interface BundlePlanPayload {
  id: string;
  taskTitle: string;
  taskDescription?: string;
  repoIds: string[];
  role?: string;
  parentBundleId?: string;
  externalRef?: ExternalRef;
  fileScope?: string[];
  symbolScope?: string[];
  constraints?: BundleRequest['constraints'];
  metadata?: Record<string, unknown>;
}

export interface ReceiptSubmitPayload {
  bundle?: string;
  agent: string;
  summary: string;
}

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

export interface ScbsOperation {
  operationId: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  tag: 'System' | 'Admin' | 'Bundles' | 'Freshness' | 'Receipts';
  successStatusCode: number;
}

export interface ApiIndex {
  service: string;
  status: string;
  api: ApiSurface;
  endpoints: {
    health: string;
    root: string;
    adminDiagnostics: string;
    listJobs: string;
    showJob: string;
    retryJob: string;
    runWorker: string;
    listRepos: string;
    registerRepo: string;
    showRepo: string;
    scanRepo: string;
    reportRepoChanges: string;
    listFacts: string;
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

export interface ScbsClientOptions {
  baseUrl: string;
  fetch?: ScbsFetch;
  headers?: Record<string, string>;
}

export interface ScbsClient {
  admin: {
    diagnostics(): Promise<DoctorReport>;
    jobs(): Promise<JobListReport>;
    showJob(id: string): Promise<FreshnessJobRecord>;
    retryJob(id: string): Promise<FreshnessJobRecord>;
    drainWorker(input?: {
      limit?: number;
      kinds?: FreshnessJobKind[];
      jobIds?: string[];
    }): Promise<FreshnessWorkerReport>;
  };
  repos: {
    list(): Promise<ScbsRepoRecord[]>;
    show(id: string): Promise<ScbsRepoRecord>;
    register(input: RegisterRepoInput): Promise<ScbsRepoRecord>;
    scan(id: string, input?: { queue?: boolean }): Promise<ScbsRepoRecord>;
    reportChanges(
      input: RepoChangesInput
    ): Promise<{ repoId: string; files: string[]; impacts: number }>;
  };
  facts: {
    list(): Promise<ScbsFactRecord[]>;
  };
  bundles: {
    plan(input: BundlePlanInput): Promise<BundleRecord>;
    show(id: string): Promise<BundleRecord>;
  };
  claims: {
    list(): Promise<ScbsClaimRecord[]>;
    show(id: string): Promise<ScbsClaimRecord>;
  };
  views: {
    list(): Promise<ScbsViewRecord[]>;
    show(id: string): Promise<ScbsViewRecord>;
    rebuild(id: string): Promise<ScbsViewRecord>;
  };
  integrations: {
    sisu: {
      createBundleRequest(job: SisuBundlePlanJob): Promise<SisuBundleSnapshot>;
      createReceipt(note: SisuReceiptNote): Promise<SisuReceiptSnapshot>;
    };
  };
}

export class ScbsHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body: unknown;

  constructor(response: Response, body: unknown, url: string) {
    const detail = getErrorDetail(body);
    super(
      `SCBS request failed with ${response.status}${detail ? `: ${detail}` : ` ${response.statusText}`}`
    );
    this.name = 'ScbsHttpError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = url;
    this.body = body;
  }
}

type ScbsFetch = (input: string, init?: RequestInit) => Promise<Response>;

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

export function createScbsClient(options: ScbsClientOptions): ScbsClient {
  const request = createRequester(options);

  return {
    admin: {
      diagnostics: () => request<DoctorReport>('GET', '/admin/diagnostics'),
      jobs: () => request<JobListReport>('GET', '/admin/jobs'),
      showJob: (id) => request<FreshnessJobRecord>('GET', '/admin/jobs/:id', { id }),
      retryJob: (id) => request<FreshnessJobRecord>('POST', '/admin/jobs/:id/retry', { id }),
      drainWorker: (input) =>
        request<FreshnessWorkerReport>('POST', '/admin/worker/drain', undefined, input),
    },
    repos: {
      list: () => request<ScbsRepoRecord[]>('GET', '/repos'),
      show: (id) => request<ScbsRepoRecord>('GET', '/repos/:id', { id }),
      register: (input) => request<ScbsRepoRecord>('POST', '/repos/register', undefined, input),
      scan: (id, input) => request<ScbsRepoRecord>('POST', '/repos/:id/scan', { id }, input),
      reportChanges: (input) =>
        request<{ repoId: string; files: string[]; impacts: number }>(
          'POST',
          '/repos/:id/changes',
          { id: input.id },
          { files: input.files }
        ),
    },
    facts: {
      list: () => request<ScbsFactRecord[]>('GET', '/facts'),
    },
    bundles: {
      plan: (input) =>
        request<BundleRecord>('POST', '/bundles/plan', undefined, toBundlePlanPayload(input)),
      show: (id) => request<BundleRecord>('GET', '/bundles/:id', { id }),
    },
    claims: {
      list: () => request<ScbsClaimRecord[]>('GET', '/claims'),
      show: (id) => request<ScbsClaimRecord>('GET', '/claims/:id', { id }),
    },
    views: {
      list: () => request<ScbsViewRecord[]>('GET', '/views'),
      show: (id) => request<ScbsViewRecord>('GET', '/views/:id', { id }),
      rebuild: (id) => request<ScbsViewRecord>('POST', '/views/:id/rebuild', { id }),
    },
    integrations: {
      sisu: {
        createBundleRequest: (job) =>
          request<SisuBundleSnapshot>('POST', '/integrations/sisu/bundle-request', undefined, job),
        createReceipt: (note) =>
          request<SisuReceiptSnapshot>('POST', '/integrations/sisu/receipt', undefined, note),
      },
    },
  };
}

export function toBundlePlanPayload(input: BundlePlanInput): BundlePlanPayload {
  return {
    id: input.id,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    repoIds: input.repoIds,
    role: input.role,
    parentBundleId: input.parentBundleId,
    externalRef: input.externalRef,
    fileScope: input.fileScope,
    symbolScope: input.symbolScope,
    constraints: input.constraints,
    metadata: input.metadata,
  };
}

export function fromBundlePlanPayload(payload: BundlePlanPayload): BundlePlanInput {
  return {
    id: payload.id,
    taskTitle: payload.taskTitle,
    taskDescription: payload.taskDescription,
    repoIds: payload.repoIds,
    role: payload.role,
    parentBundleId: payload.parentBundleId,
    externalRef: payload.externalRef,
    fileScope: payload.fileScope,
    symbolScope: payload.symbolScope,
    constraints: payload.constraints,
    metadata: payload.metadata,
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

function createRequester(options: ScbsClientOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('SCBS client requires a fetch implementation.');
  }

  const baseUrl = trimTrailingSlash(options.baseUrl);
  const baseHeaders = options.headers ?? {};

  return async <T>(
    method: 'GET' | 'POST',
    path: string,
    pathParams?: Record<string, string>,
    body?: unknown
  ): Promise<T> => {
    const url = `${baseUrl}${interpolatePath(`${SCBS_API_ROOT}${path}`, pathParams)}`;
    const headers: Record<string, string> = { ...baseHeaders };
    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetchImpl(url, init);
    const payload = await readJson(response);
    if (!response.ok) {
      throw new ScbsHttpError(response, payload, url);
    }
    return payload as T;
  };
}

function interpolatePath(path: string, pathParams?: Record<string, string>): string {
  if (!pathParams) {
    return path;
  }

  return path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    const value = pathParams[key];
    if (!value) {
      throw new Error(`Missing path parameter "${key}".`);
    }
    return encodeURIComponent(value);
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorDetail(body: unknown): string | undefined {
  if (typeof body === 'string' && body.length > 0) {
    return body;
  }
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error.length > 0) {
    return record.error;
  }
  return undefined;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
