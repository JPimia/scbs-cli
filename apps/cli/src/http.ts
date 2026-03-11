import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ScbsService } from './service';
import type { ServeReport } from './types';

type RouteMatch =
  | {
      route: RouteDefinition;
      params: Record<string, string>;
    }
  | undefined;

interface RouteDefinition {
  method: 'GET' | 'POST';
  pattern: string;
  handler: (
    context: RequestContext
  ) => Promise<{ statusCode?: number; body: unknown } | { statusCode: number; body: unknown }>;
}

interface RequestContext {
  params: Record<string, string>;
  service: ScbsService;
  report: ServeReport;
  request: IncomingMessage;
}

const routeDefinitions: RouteDefinition[] = [
  {
    method: 'GET',
    pattern: '/health',
    handler: async ({ service }) => ({ body: await service.health() }),
  },
  {
    method: 'GET',
    pattern: '/api/v1',
    handler: async ({ report }) => ({ body: buildApiIndex(report) }),
  },
  {
    method: 'GET',
    pattern: '/api/v1/',
    handler: async ({ report }) => ({ body: buildApiIndex(report) }),
  },
  {
    method: 'POST',
    pattern: '/api/v1/bundles/plan',
    handler: async ({ request, service }) => {
      const body = await readJsonBody(request);
      const task = getRequiredString(body, 'task');
      const repoIds = getRequiredRepoIds(body);
      const parentBundleId = getOptionalString(body, 'parentBundleId') ?? undefined;
      const fileScope = getOptionalStringArray(body, 'fileScope');
      const symbolScope = getOptionalStringArray(body, 'symbolScope');
      return {
        statusCode: 201,
        body: await service.planBundle({ task, repoIds, parentBundleId, fileScope, symbolScope }),
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/bundles/:id',
    handler: async ({ params, service }) => ({
      body: await service.showBundle(getRequiredParam(params, 'id')),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/v1/bundles/:id/freshness',
    handler: async ({ params, service }) => ({
      body: await service.getBundleFreshness(getRequiredParam(params, 'id')),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/v1/freshness/impacts',
    handler: async ({ service }) => ({ body: await service.getFreshnessImpacts() }),
  },
  {
    method: 'GET',
    pattern: '/api/v1/freshness/status',
    handler: async ({ service }) => ({ body: await service.getFreshnessStatus() }),
  },
  {
    method: 'POST',
    pattern: '/api/v1/freshness/recompute',
    handler: async ({ service }) => ({ body: await service.recomputeFreshness() }),
  },
  {
    method: 'POST',
    pattern: '/api/v1/receipts',
    handler: async ({ request, service }) => {
      const body = await readJsonBody(request);
      const agent = getRequiredString(body, 'agent');
      const summary = getRequiredString(body, 'summary');
      const bundleId = getOptionalString(body, 'bundle');
      return {
        statusCode: 201,
        body: await service.submitReceipt({ bundleId, agent, summary }),
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/receipts',
    handler: async ({ service }) => ({ body: await service.listReceipts() }),
  },
  {
    method: 'GET',
    pattern: '/api/v1/receipts/:id',
    handler: async ({ params, service }) => ({
      body: await service.showReceipt(getRequiredParam(params, 'id')),
    }),
  },
];

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ScbsService,
  report: ServeReport
): Promise<void> {
  const method = normalizeMethod(request.method);
  const path = getRequestPath(request.url);
  try {
    const methodMatches = routeDefinitions
      .filter((route) => route.pattern === path || matchRoute(route.pattern, path))
      .map((route) => route.method);
    const routeMatch = routeDefinitions
      .filter((route) => route.method === method)
      .map((route) => {
        const params = matchRoute(route.pattern, path);
        return params ? { route, params } : undefined;
      })
      .find((candidate): candidate is NonNullable<RouteMatch> => candidate !== undefined);

    if (routeMatch) {
      const result = await routeMatch.route.handler({
        params: routeMatch.params,
        service,
        report,
        request,
      });
      writeJson(response, result.statusCode ?? 200, result.body);
      return;
    }

    if (methodMatches.length > 0) {
      response.setHeader('allow', [...new Set(methodMatches)].join(', '));
      writeJson(response, 405, {
        error: 'Method Not Allowed',
        message: `No route for ${method} ${path}`,
      });
      return;
    }

    writeJson(response, 404, {
      error: 'Not Found',
      message: `No route for ${method} ${path}`,
    });
  } catch (error) {
    writeHandledError(response, error, method, path);
  }
}

function buildApiIndex(report: ServeReport) {
  return {
    service: report.service,
    status: report.status,
    api: report.api,
    endpoints: {
      health: '/health',
      root: '/api/v1',
      planBundle: '/api/v1/bundles/plan',
      showBundle: '/api/v1/bundles/:id',
      bundleFreshness: '/api/v1/bundles/:id/freshness',
      freshnessImpacts: '/api/v1/freshness/impacts',
      freshnessStatus: '/api/v1/freshness/status',
      recomputeFreshness: '/api/v1/freshness/recompute',
      createReceipt: '/api/v1/receipts',
      listReceipts: '/api/v1/receipts',
      showReceipt: '/api/v1/receipts/:id',
    },
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (rawBody.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isPlainObject(parsed)) {
      throw new HttpError(400, 'Bad Request', 'JSON body must be an object.');
    }

    return parsed;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(400, 'Bad Request', 'Request body must be valid JSON.');
  }
}

function getRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'Bad Request', `Missing required field "${key}".`);
  }

  return value;
}

function getOptionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(
      400,
      'Bad Request',
      `Field "${key}" must be a non-empty string when provided.`
    );
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
    throw new HttpError(400, 'Bad Request', `Field "${key}" must be an array of strings.`);
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

function getRequiredParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new HttpError(400, 'Bad Request', `Missing route parameter "${key}".`);
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequestPath(url: string | undefined): string {
  if (!url) {
    return '/';
  }

  return new URL(url, 'http://127.0.0.1').pathname;
}

function normalizeMethod(
  method: string | undefined
): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' {
  switch ((method ?? 'GET').toUpperCase()) {
    case 'POST':
      return 'POST';
    case 'PUT':
      return 'PUT';
    case 'PATCH':
      return 'PATCH';
    case 'DELETE':
      return 'DELETE';
    case 'HEAD':
      return 'HEAD';
    default:
      return 'GET';
  }
}

function matchRoute(pattern: string, path: string): Record<string, string> | undefined {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(path);

  if (patternSegments.length !== pathSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];
    if (patternSegment === undefined || pathSegment === undefined) {
      return undefined;
    }

    if (patternSegment.startsWith(':')) {
      try {
        params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      } catch (error) {
        throw new HttpError(
          400,
          'Bad Request',
          'Route parameter contains invalid percent-encoding.'
        );
      }
      continue;
    }

    if (patternSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

function splitPath(path: string): string[] {
  if (path === '/') {
    return [];
  }

  return path.replace(/^\/+|\/+$/g, '').split('/');
}

function writeHandledError(
  response: ServerResponse,
  error: unknown,
  method: string,
  path: string
): void {
  if (error instanceof HttpError) {
    writeJson(response, error.statusCode, {
      error: error.code,
      message: error.message,
    });
    return;
  }

  if (error instanceof Error && error.message.endsWith('was not found.')) {
    writeJson(response, 404, {
      error: 'Not Found',
      message: error.message,
    });
    return;
  }

  const message = error instanceof Error ? error.message : `Unhandled error for ${method} ${path}`;
  writeJson(response, 500, {
    error: 'Internal Server Error',
    message,
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: 'Bad Request' | 'Method Not Allowed',
    message: string
  ) {
    super(message);
  }
}
