import type { BundlePlanInput, ReceiptSubmitInput } from './types';

export type HttpMethod = 'GET' | 'POST';

export interface ContractRequestBody {
  description: string;
  required: boolean;
  schema: { type: 'bundlePlanInput' } | { type: 'receiptSubmitInput' };
}

export interface ContractResponse {
  statusCode: number;
  description: string;
  schema:
    | { type: 'health' }
    | { type: 'apiIndex' }
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
    | { type: 'receiptRecord' }
    | { type: 'receiptList' };
}

export interface RouteContract {
  method: HttpMethod;
  path: string;
  operationId: string;
  summary: string;
  tag: 'System' | 'Bundles' | 'Freshness' | 'Receipts';
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
      listClaims: '/api/v1/claims',
      showClaim: '/api/v1/claims/:id',
      listViews: '/api/v1/views',
      showView: '/api/v1/views/:id',
      rebuildView: '/api/v1/views/:id/rebuild',
      planBundle: '/api/v1/bundles/plan',
      showBundle: '/api/v1/bundles/:id',
      bundleFreshness: '/api/v1/bundles/:id/freshness',
      expireBundle: '/api/v1/bundles/:id/expire',
      listBundleCache: '/api/v1/bundles/cache',
      clearBundleCache: '/api/v1/bundles/cache/clear',
      freshnessImpacts: '/api/v1/freshness/impacts',
      freshnessStatus: '/api/v1/freshness/status',
      recomputeFreshness: '/api/v1/freshness/recompute',
      createReceipt: '/api/v1/receipts',
      listReceipts: '/api/v1/receipts',
      showReceipt: '/api/v1/receipts/:id',
      validateReceipt: '/api/v1/receipts/:id/validate',
      rejectReceipt: '/api/v1/receipts/:id/reject',
    },
  };
}

export function normalizeBundlePlanInput(body: Record<string, unknown>): BundlePlanInput {
  return {
    task: getRequiredString(body, 'task'),
    repoIds: getRequiredRepoIds(body),
    parentBundleId: getOptionalString(body, 'parentBundleId') ?? undefined,
    fileScope: getOptionalStringArray(body, 'fileScope'),
    symbolScope: getOptionalStringArray(body, 'symbolScope'),
  };
}

export function normalizeReceiptSubmitInput(body: Record<string, unknown>): ReceiptSubmitInput {
  return {
    bundleId: getOptionalString(body, 'bundle'),
    agent: getRequiredString(body, 'agent'),
    summary: getRequiredString(body, 'summary'),
  };
}

function getRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
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

function getRequiredRepoIds(body: Record<string, unknown>): string[] {
  const repoIds = getOptionalStringArray(body, 'repoIds');
  if (repoIds && repoIds.length > 0) {
    return repoIds;
  }

  return [getRequiredString(body, 'repo')];
}
