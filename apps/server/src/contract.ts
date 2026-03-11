import type { MissionControlTaskEnvelope } from '../../../packages/adapter-mission-control/src/index';
import type { SisuBundlePlanJob, SisuReceiptNote } from '../../../packages/adapter-sisu/src/index';
import { parseBundleRequest } from '../../../packages/protocol/src/index';
import type {
  AccessTokenCreateInput,
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  WebhookCreateInput,
} from './types';

export type HttpMethod = 'GET' | 'POST';

export interface ContractRequestBody {
  description: string;
  required: boolean;
  schema:
    | { type: 'registerRepoInput' }
    | { type: 'queueControlInput' }
    | { type: 'workerDrainInput' }
    | { type: 'webhookCreateInput' }
    | { type: 'accessTokenCreateInput' }
    | { type: 'repoChangesInput' }
    | { type: 'bundlePlanInput' }
    | { type: 'receiptSubmitInput' }
    | { type: 'missionControlTaskEnvelope' }
    | { type: 'sisuBundlePlanJob' }
    | { type: 'sisuReceiptNote' };
}

export interface ContractResponse {
  statusCode: number;
  description: string;
  schema:
    | { type: 'health' }
    | { type: 'apiIndex' }
    | { type: 'doctorReport' }
    | { type: 'bundleList' }
    | { type: 'bundleReview' }
    | { type: 'repoRecord' }
    | { type: 'repoList' }
    | { type: 'factList' }
    | { type: 'repoChangesResult' }
    | { type: 'claimRecord' }
    | { type: 'claimList' }
    | { type: 'viewRecord' }
    | { type: 'viewList' }
    | { type: 'bundleRecord' }
    | { type: 'bundleFreshness' }
    | { type: 'bundleCache' }
    | { type: 'clearBundleCacheResult' }
    | { type: 'freshnessImpacts' }
    | { type: 'freshnessStatus' }
    | { type: 'recomputeFreshnessResult' }
    | { type: 'workerRunReport' }
    | { type: 'jobRecord' }
    | { type: 'jobList' }
    | { type: 'receiptReviewList' }
    | { type: 'receiptRecord' }
    | { type: 'receiptList' }
    | { type: 'outboxEvent' }
    | { type: 'outboxEventList' }
    | { type: 'webhookRecord' }
    | { type: 'webhookRecordList' }
    | { type: 'accessTokenRecordList' }
    | { type: 'accessTokenGrant' }
    | { type: 'auditRecordList' }
    | { type: 'missionControlBundleStatus' }
    | { type: 'sisuBundleSnapshot' }
    | { type: 'sisuReceiptSnapshot' };
}

export interface RouteContract {
  method: HttpMethod;
  path: string;
  operationId: string;
  summary: string;
  tag: 'System' | 'Admin' | 'Bundles' | 'Freshness' | 'Receipts';
  requestBody?: ContractRequestBody;
  pathParams?: Array<{ name: string; description: string }>;
  success: ContractResponse;
}

export const routeManifest: RouteContract[] = [
  {
    method: 'GET',
    path: '/health',
    operationId: 'getHealth',
    summary: 'Return the SCBS service health report.',
    tag: 'System',
    success: {
      statusCode: 200,
      description: 'Health status for the running SCBS service.',
      schema: { type: 'health' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1',
    operationId: 'getApiIndex',
    summary: 'Return the SCBS API index for version v1.',
    tag: 'System',
    success: {
      statusCode: 200,
      description: 'Top-level API index and endpoint directory.',
      schema: { type: 'apiIndex' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/',
    operationId: 'getApiIndexTrailingSlash',
    summary: 'Return the SCBS API index for version v1 with a trailing slash.',
    tag: 'System',
    success: {
      statusCode: 200,
      description: 'Top-level API index and endpoint directory.',
      schema: { type: 'apiIndex' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/diagnostics',
    operationId: 'getAdminDiagnostics',
    summary: 'Return operator diagnostics for the running SCBS service.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Operator diagnostics report.',
      schema: { type: 'doctorReport' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/jobs',
    operationId: 'listJobs',
    summary: 'List background jobs, queue summary, and recent change events.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Background job report.',
      schema: { type: 'jobList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/bundles',
    operationId: 'listAdminBundles',
    summary: 'List bundles with review-oriented visibility fields.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Bundle visibility records.',
      schema: { type: 'bundleList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/bundles/:id/review',
    operationId: 'reviewBundle',
    summary: 'Fetch planner diagnostics and receipt history for a bundle.',
    tag: 'Admin',
    pathParams: [{ name: 'id', description: 'Bundle identifier.' }],
    success: {
      statusCode: 200,
      description: 'Bundle review record.',
      schema: { type: 'bundleReview' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/receipts/history',
    operationId: 'listReceiptHistory',
    summary: 'List review history for all receipts.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Receipt review history records.',
      schema: { type: 'receiptReviewList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/receipts/:id/history',
    operationId: 'showReceiptHistory',
    summary: 'List review history for a receipt.',
    tag: 'Admin',
    pathParams: [{ name: 'id', description: 'Receipt identifier.' }],
    success: {
      statusCode: 200,
      description: 'Receipt review history records.',
      schema: { type: 'receiptReviewList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/outbox',
    operationId: 'listOutboxEvents',
    summary: 'List lifecycle outbox events and delivery state.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Outbox events.',
      schema: { type: 'outboxEventList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/outbox/:id',
    operationId: 'showOutboxEvent',
    summary: 'Fetch a lifecycle outbox event by id.',
    tag: 'Admin',
    pathParams: [{ name: 'id', description: 'Outbox event identifier.' }],
    success: {
      statusCode: 200,
      description: 'Outbox event.',
      schema: { type: 'outboxEvent' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/webhooks',
    operationId: 'listWebhooks',
    summary: 'List webhook subscriptions.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Webhook subscriptions.',
      schema: { type: 'webhookRecordList' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/webhooks',
    operationId: 'createWebhook',
    summary: 'Create a webhook subscription.',
    tag: 'Admin',
    requestBody: {
      description: 'Webhook subscription payload.',
      required: true,
      schema: { type: 'webhookCreateInput' },
    },
    success: {
      statusCode: 201,
      description: 'Created webhook subscription.',
      schema: { type: 'webhookRecord' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/access-tokens',
    operationId: 'listAccessTokens',
    summary: 'List configured access tokens without secret material.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Access tokens.',
      schema: { type: 'accessTokenRecordList' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/access-tokens',
    operationId: 'createAccessToken',
    summary: 'Create a scoped access token.',
    tag: 'Admin',
    requestBody: {
      description: 'Access token creation payload.',
      required: true,
      schema: { type: 'accessTokenCreateInput' },
    },
    success: {
      statusCode: 201,
      description: 'Created access token grant.',
      schema: { type: 'accessTokenGrant' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/audit',
    operationId: 'listAuditRecords',
    summary: 'List audit records for admin and repository actions.',
    tag: 'Admin',
    success: {
      statusCode: 200,
      description: 'Audit records.',
      schema: { type: 'auditRecordList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/jobs/:id',
    operationId: 'showJob',
    summary: 'Fetch a background job by id.',
    tag: 'Admin',
    pathParams: [{ name: 'id', description: 'Background job identifier.' }],
    success: {
      statusCode: 200,
      description: 'Background job record.',
      schema: { type: 'jobRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/jobs/:id/retry',
    operationId: 'retryJob',
    summary: 'Retry a failed or pending background job immediately.',
    tag: 'Admin',
    pathParams: [{ name: 'id', description: 'Background job identifier.' }],
    success: {
      statusCode: 200,
      description: 'Updated background job record.',
      schema: { type: 'jobRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/worker/drain',
    operationId: 'runWorker',
    summary: 'Drain queued background jobs once with optional filters.',
    tag: 'Admin',
    requestBody: {
      description: 'Optional worker drain controls.',
      required: false,
      schema: { type: 'workerDrainInput' },
    },
    success: {
      statusCode: 200,
      description: 'Background worker run report.',
      schema: { type: 'workerRunReport' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/repos',
    operationId: 'listRepos',
    summary: 'List repositories registered with the SCBS service.',
    tag: 'System',
    success: {
      statusCode: 200,
      description: 'Repository records.',
      schema: { type: 'repoList' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/repos/register',
    operationId: 'registerRepo',
    summary: 'Register a repository with the SCBS service.',
    tag: 'System',
    requestBody: {
      description: 'Repository registration payload.',
      required: true,
      schema: { type: 'registerRepoInput' },
    },
    success: {
      statusCode: 201,
      description: 'Registered repository record.',
      schema: { type: 'repoRecord' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/repos/:id',
    operationId: 'showRepo',
    summary: 'Fetch a repository by id.',
    tag: 'System',
    pathParams: [{ name: 'id', description: 'Repository identifier.' }],
    success: {
      statusCode: 200,
      description: 'Repository record.',
      schema: { type: 'repoRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/repos/:id/scan',
    operationId: 'scanRepo',
    summary: 'Scan a registered repository.',
    tag: 'System',
    pathParams: [{ name: 'id', description: 'Repository identifier.' }],
    requestBody: {
      description: 'Optional repository scan controls.',
      required: false,
      schema: { type: 'queueControlInput' },
    },
    success: {
      statusCode: 200,
      description: 'Scanned repository record.',
      schema: { type: 'repoRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/repos/:id/changes',
    operationId: 'reportRepoChanges',
    summary: 'Report changed files for a registered repository.',
    tag: 'System',
    pathParams: [{ name: 'id', description: 'Repository identifier.' }],
    requestBody: {
      description: 'Repository change payload.',
      required: true,
      schema: { type: 'repoChangesInput' },
    },
    success: {
      statusCode: 200,
      description: 'Repository change impact report.',
      schema: { type: 'repoChangesResult' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/facts',
    operationId: 'listFacts',
    summary: 'List facts from the live SCBS service.',
    tag: 'System',
    success: {
      statusCode: 200,
      description: 'Fact records.',
      schema: { type: 'factList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/claims',
    operationId: 'listClaims',
    summary: 'List claims from the live SCBS service.',
    tag: 'Bundles',
    success: {
      statusCode: 200,
      description: 'Claim records.',
      schema: { type: 'claimList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/claims/:id',
    operationId: 'showClaim',
    summary: 'Fetch a claim by id.',
    tag: 'Bundles',
    pathParams: [{ name: 'id', description: 'Claim identifier.' }],
    success: {
      statusCode: 200,
      description: 'Claim record.',
      schema: { type: 'claimRecord' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/views',
    operationId: 'listViews',
    summary: 'List views from the live SCBS service.',
    tag: 'Bundles',
    success: {
      statusCode: 200,
      description: 'View records.',
      schema: { type: 'viewList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/views/:id',
    operationId: 'showView',
    summary: 'Fetch a view by id.',
    tag: 'Bundles',
    pathParams: [{ name: 'id', description: 'View identifier.' }],
    success: {
      statusCode: 200,
      description: 'View record.',
      schema: { type: 'viewRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/views/:id/rebuild',
    operationId: 'rebuildView',
    summary: 'Rebuild a view by id.',
    tag: 'Bundles',
    pathParams: [{ name: 'id', description: 'View identifier.' }],
    success: {
      statusCode: 200,
      description: 'Rebuilt view record.',
      schema: { type: 'viewRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/bundles/plan',
    operationId: 'planBundle',
    summary: 'Plan a task bundle against one or more repositories.',
    tag: 'Bundles',
    requestBody: {
      description: 'Bundle planning input.',
      required: true,
      schema: { type: 'bundlePlanInput' },
    },
    success: {
      statusCode: 201,
      description: 'Planned bundle record.',
      schema: { type: 'bundleRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/integrations/mission-control/repo-sync',
    operationId: 'createMissionControlRepoSync',
    summary: 'Plan a bundle from a Mission Control repo-sync payload.',
    tag: 'Bundles',
    requestBody: {
      description: 'Mission Control repo-sync request.',
      required: true,
      schema: { type: 'missionControlTaskEnvelope' },
    },
    success: {
      statusCode: 201,
      description: 'Planned Mission Control bundle status.',
      schema: { type: 'missionControlBundleStatus' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/integrations/sisu/bundle-request',
    operationId: 'createSisuBundleRequest',
    summary: 'Plan a bundle from a SISU integration request payload.',
    tag: 'Bundles',
    requestBody: {
      description: 'SISU bundle planning request.',
      required: true,
      schema: { type: 'sisuBundlePlanJob' },
    },
    success: {
      statusCode: 201,
      description: 'Planned SISU bundle snapshot.',
      schema: { type: 'sisuBundleSnapshot' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/bundles/cache',
    operationId: 'listBundleCache',
    summary: 'List cached task bundles and their freshness.',
    tag: 'Bundles',
    success: {
      statusCode: 200,
      description: 'Cached bundle entries.',
      schema: { type: 'bundleCache' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/bundles/cache/clear',
    operationId: 'clearBundleCache',
    summary: 'Clear the bundle cache.',
    tag: 'Bundles',
    success: {
      statusCode: 200,
      description: 'Number of cleared cache entries.',
      schema: { type: 'clearBundleCacheResult' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/bundles/:id',
    operationId: 'showBundle',
    summary: 'Fetch a planned bundle by id.',
    tag: 'Bundles',
    pathParams: [{ name: 'id', description: 'Bundle identifier.' }],
    success: {
      statusCode: 200,
      description: 'Bundle record.',
      schema: { type: 'bundleRecord' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/bundles/:id/freshness',
    operationId: 'getBundleFreshness',
    summary: 'Fetch the freshness state for a bundle.',
    tag: 'Freshness',
    pathParams: [{ name: 'id', description: 'Bundle identifier.' }],
    success: {
      statusCode: 200,
      description: 'Bundle freshness report.',
      schema: { type: 'bundleFreshness' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/bundles/:id/expire',
    operationId: 'expireBundle',
    summary: 'Expire a bundle immediately.',
    tag: 'Bundles',
    pathParams: [{ name: 'id', description: 'Bundle identifier.' }],
    success: {
      statusCode: 200,
      description: 'Expired bundle record.',
      schema: { type: 'bundleRecord' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/freshness/impacts',
    operationId: 'getFreshnessImpacts',
    summary: 'List freshness impacts across artifacts.',
    tag: 'Freshness',
    success: {
      statusCode: 200,
      description: 'Freshness impact records.',
      schema: { type: 'freshnessImpacts' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/freshness/status',
    operationId: 'getFreshnessStatus',
    summary: 'Return overall freshness status.',
    tag: 'Freshness',
    success: {
      statusCode: 200,
      description: 'Current system freshness status.',
      schema: { type: 'freshnessStatus' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/freshness/recompute',
    operationId: 'recomputeFreshness',
    summary: 'Recompute freshness for tracked artifacts.',
    tag: 'Freshness',
    success: {
      statusCode: 200,
      description: 'Recompute result.',
      schema: { type: 'recomputeFreshnessResult' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/receipts',
    operationId: 'createReceipt',
    summary: 'Submit a receipt for review.',
    tag: 'Receipts',
    requestBody: {
      description: 'Receipt submission payload.',
      required: true,
      schema: { type: 'receiptSubmitInput' },
    },
    success: {
      statusCode: 201,
      description: 'Created receipt record.',
      schema: { type: 'receiptRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/integrations/sisu/receipt',
    operationId: 'createSisuReceipt',
    summary: 'Submit a receipt from a SISU integration payload.',
    tag: 'Receipts',
    requestBody: {
      description: 'SISU receipt submission payload.',
      required: true,
      schema: { type: 'sisuReceiptNote' },
    },
    success: {
      statusCode: 201,
      description: 'Created SISU receipt snapshot.',
      schema: { type: 'sisuReceiptSnapshot' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/receipts',
    operationId: 'listReceipts',
    summary: 'List submitted receipts.',
    tag: 'Receipts',
    success: {
      statusCode: 200,
      description: 'Receipt records.',
      schema: { type: 'receiptList' },
    },
  },
  {
    method: 'GET',
    path: '/api/v1/receipts/:id',
    operationId: 'showReceipt',
    summary: 'Fetch a receipt by id.',
    tag: 'Receipts',
    pathParams: [{ name: 'id', description: 'Receipt identifier.' }],
    success: {
      statusCode: 200,
      description: 'Receipt record.',
      schema: { type: 'receiptRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/receipts/:id/validate',
    operationId: 'validateReceipt',
    summary: 'Validate a receipt.',
    tag: 'Receipts',
    pathParams: [{ name: 'id', description: 'Receipt identifier.' }],
    requestBody: {
      description: 'Optional receipt validation controls.',
      required: false,
      schema: { type: 'queueControlInput' },
    },
    success: {
      statusCode: 200,
      description: 'Validated receipt record.',
      schema: { type: 'receiptRecord' },
    },
  },
  {
    method: 'POST',
    path: '/api/v1/receipts/:id/reject',
    operationId: 'rejectReceipt',
    summary: 'Reject a receipt.',
    tag: 'Receipts',
    pathParams: [{ name: 'id', description: 'Receipt identifier.' }],
    success: {
      statusCode: 200,
      description: 'Rejected receipt record.',
      schema: { type: 'receiptRecord' },
    },
  },
];

export function buildApiIndex(report: { service: string; status: string; api: unknown }) {
  return {
    service: report.service,
    status: report.status,
    api: report.api,
    endpoints: {
      health: '/health',
      root: '/api/v1',
      adminDiagnostics: '/api/v1/admin/diagnostics',
      listJobs: '/api/v1/admin/jobs',
      listAdminBundles: '/api/v1/admin/bundles',
      reviewBundle: '/api/v1/admin/bundles/:id/review',
      listReceiptHistory: '/api/v1/admin/receipts/history',
      showReceiptHistory: '/api/v1/admin/receipts/:id/history',
      listOutboxEvents: '/api/v1/admin/outbox',
      showOutboxEvent: '/api/v1/admin/outbox/:id',
      listWebhooks: '/api/v1/admin/webhooks',
      createWebhook: '/api/v1/admin/webhooks',
      listAccessTokens: '/api/v1/admin/access-tokens',
      createAccessToken: '/api/v1/admin/access-tokens',
      listAuditRecords: '/api/v1/admin/audit',
      showJob: '/api/v1/admin/jobs/:id',
      retryJob: '/api/v1/admin/jobs/:id/retry',
      runWorker: '/api/v1/admin/worker/drain',
      listRepos: '/api/v1/repos',
      registerRepo: '/api/v1/repos/register',
      showRepo: '/api/v1/repos/:id',
      scanRepo: '/api/v1/repos/:id/scan',
      reportRepoChanges: '/api/v1/repos/:id/changes',
      listFacts: '/api/v1/facts',
      listClaims: '/api/v1/claims',
      showClaim: '/api/v1/claims/:id',
      listViews: '/api/v1/views',
      showView: '/api/v1/views/:id',
      rebuildView: '/api/v1/views/:id/rebuild',
      planBundle: '/api/v1/bundles/plan',
      missionControlRepoSync: '/api/v1/integrations/mission-control/repo-sync',
      sisuBundleRequest: '/api/v1/integrations/sisu/bundle-request',
      showBundle: '/api/v1/bundles/:id',
      bundleFreshness: '/api/v1/bundles/:id/freshness',
      expireBundle: '/api/v1/bundles/:id/expire',
      listBundleCache: '/api/v1/bundles/cache',
      clearBundleCache: '/api/v1/bundles/cache/clear',
      freshnessImpacts: '/api/v1/freshness/impacts',
      freshnessStatus: '/api/v1/freshness/status',
      recomputeFreshness: '/api/v1/freshness/recompute',
      createReceipt: '/api/v1/receipts',
      sisuReceipt: '/api/v1/integrations/sisu/receipt',
      listReceipts: '/api/v1/receipts',
      showReceipt: '/api/v1/receipts/:id',
      validateReceipt: '/api/v1/receipts/:id/validate',
      rejectReceipt: '/api/v1/receipts/:id/reject',
    },
  };
}

export function normalizeRegisterRepoInput(body: Record<string, unknown>): RegisterRepoInput {
  return {
    name: getRequiredString(body, 'name'),
    path: getRequiredString(body, 'path'),
  };
}

export function normalizeQueueControlInput(body: Record<string, unknown>): { queue?: boolean } {
  return {
    queue: getOptionalBoolean(body, 'queue') ?? undefined,
  };
}

export function normalizeWorkerDrainInput(body: Record<string, unknown>): {
  limit?: number;
  kinds?: Array<'freshness_recompute' | 'repo_scan' | 'receipt_validation' | 'webhook_delivery'>;
  jobIds?: string[];
} {
  return {
    limit: getOptionalNumber(body, 'limit') ?? undefined,
    kinds: getOptionalStringArray(body, 'kinds') as
      | Array<'freshness_recompute' | 'repo_scan' | 'receipt_validation' | 'webhook_delivery'>
      | undefined,
    jobIds: getOptionalStringArray(body, 'jobIds'),
  };
}

export function normalizeWebhookCreateInput(body: Record<string, unknown>): WebhookCreateInput {
  return {
    label: getRequiredString(body, 'label'),
    url: getRequiredString(body, 'url'),
    events: getRequiredStringArray(body, 'events') as WebhookCreateInput['events'],
  };
}

export function normalizeAccessTokenCreateInput(
  body: Record<string, unknown>
): AccessTokenCreateInput {
  return {
    label: getRequiredString(body, 'label'),
    scopes: getRequiredStringArray(body, 'scopes') as AccessTokenCreateInput['scopes'],
  };
}

export function normalizeRepoChangesInput(
  params: Record<string, string>,
  body: Record<string, unknown>
): RepoChangesInput {
  return {
    id: getRequiredString(params, 'id'),
    files: getRequiredStringArray(body, 'files'),
  };
}

export function normalizeBundlePlanInput(body: Record<string, unknown>): BundlePlanInput {
  const taskTitle =
    typeof body.taskTitle === 'string' && body.taskTitle.length > 0
      ? body.taskTitle
      : getRequiredString(body, 'task');
  return parseBundleRequest(
    {
      ...body,
      id:
        typeof body.id === 'string' && body.id.length > 0
          ? body.id
          : `req_http_${taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      taskTitle,
      taskDescription: getOptionalString(body, 'taskDescription') ?? undefined,
      repoIds: getRequiredRepoIds(body),
      role: getOptionalString(body, 'role') ?? undefined,
      parentBundleId: getOptionalString(body, 'parentBundleId') ?? undefined,
      fileScope: getOptionalStringArray(body, 'fileScope'),
      symbolScope: getOptionalStringArray(body, 'symbolScope'),
      externalRef: getOptionalObject(body, 'externalRef'),
      constraints: getOptionalObject(body, 'constraints'),
      metadata: getOptionalObject(body, 'metadata'),
    },
    'bundleRequest'
  );
}

export function normalizeReceiptSubmitInput(body: Record<string, unknown>): ReceiptSubmitInput {
  return {
    bundleId: getOptionalString(body, 'bundle'),
    agent: getRequiredString(body, 'agent'),
    summary: getRequiredString(body, 'summary'),
  };
}

export function normalizeMissionControlTaskEnvelope(
  body: Record<string, unknown>
): MissionControlTaskEnvelope {
  return {
    missionId: getRequiredString(body, 'missionId'),
    objective: getRequiredString(body, 'objective'),
    repoIds: getRequiredStringArray(body, 'repoIds'),
    bundleParentId: getOptionalString(body, 'bundleParentId') ?? undefined,
    fileTargets: getOptionalStringArray(body, 'fileTargets'),
    symbolTargets: getOptionalStringArray(body, 'symbolTargets'),
  };
}

export function normalizeSisuBundlePlanJob(body: Record<string, unknown>): SisuBundlePlanJob {
  return {
    workspaceId: getRequiredString(body, 'workspaceId'),
    objective: getRequiredString(body, 'objective'),
    repositoryIds: getRequiredStringArray(body, 'repositoryIds'),
    parentContextId: getOptionalString(body, 'parentContextId') ?? undefined,
    focusFiles: getOptionalStringArray(body, 'focusFiles'),
    focusSymbols: getOptionalStringArray(body, 'focusSymbols'),
  };
}

export function normalizeSisuReceiptNote(body: Record<string, unknown>): SisuReceiptNote {
  return {
    workspaceId: getRequiredString(body, 'workspaceId'),
    agent: getRequiredString(body, 'agent'),
    summary: getRequiredString(body, 'summary'),
    bundleContextId: getOptionalString(body, 'bundleContextId') ?? undefined,
  };
}

function getRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required field "${key}".`);
  }

  return value;
}

function getRequiredStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = getOptionalStringArray(body, key);
  if (!value) {
    throw new Error(`Missing required field "${key}".`);
  }

  return value;
}

function getOptionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Field "${key}" must be a non-empty string when provided.`);
  }

  return value;
}

function getOptionalBoolean(body: Record<string, unknown>, key: string): boolean | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Field "${key}" must be a boolean when provided.`);
  }

  return value;
}

function getOptionalNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Field "${key}" must be a finite number when provided.`);
  }

  return value;
}

function getOptionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(`Field "${key}" must be an array of strings.`);
  }

  return value;
}

function getOptionalObject(
  body: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Field "${key}" must be an object.`);
  }

  return value as Record<string, unknown>;
}

function getRequiredRepoIds(body: Record<string, unknown>): string[] {
  const repoIds = getOptionalStringArray(body, 'repoIds');
  if (repoIds && repoIds.length > 0) {
    return repoIds;
  }

  return [getRequiredString(body, 'repo')];
}
