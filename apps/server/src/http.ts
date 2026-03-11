import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  buildApiIndex,
  normalizeBundlePlanInput,
  normalizeReceiptSubmitInput,
  routeManifest,
} from './contract';
import type { RouteContract } from './contract';
import type { ServeReport, ServerScbsService } from './types';

type RouteMatch =
  | {
      route: RouteContract;
      params: Record<string, string>;
    }
  | undefined;

interface RequestContext {
  params: Record<string, string>;
  service: ServerScbsService;
  report: ServeReport;
  request: IncomingMessage;
}

type HandlerResult = { statusCode?: number; body: unknown };

type RouteHandler = (context: RequestContext) => Promise<HandlerResult>;

const routeHandlers = new Map<string, RouteHandler>([
  ['GET /health', async ({ service }) => ({ body: await service.health() })],
  ['GET /api/v1', async ({ report }) => ({ body: buildApiIndex(report) })],
  ['GET /api/v1/', async ({ report }) => ({ body: buildApiIndex(report) })],
  [
    'POST /api/v1/bundles/plan',
    async ({ request, service }) => ({
      statusCode: 201,
      body: await service.planBundle(
        await withBadRequest(async () => normalizeBundlePlanInput(await readJsonBody(request)))
      ),
    }),
  ],
  ['GET /api/v1/bundles/cache', async ({ service }) => ({ body: await service.listBundleCache() })],
  [
    'POST /api/v1/bundles/cache/clear',
    async ({ service }) => ({ body: await service.clearBundleCache() }),
  ],
  [
    'GET /api/v1/bundles/:id',
    async ({ params, service }) => ({
      body: await service.showBundle(getRequiredParam(params, 'id')),
    }),
  ],
  [
    'GET /api/v1/bundles/:id/freshness',
    async ({ params, service }) => ({
      body: await service.getBundleFreshness(getRequiredParam(params, 'id')),
    }),
  ],
  [
    'POST /api/v1/bundles/:id/expire',
    async ({ params, service }) => ({
      body: await service.expireBundle(getRequiredParam(params, 'id')),
    }),
  ],
  [
    'GET /api/v1/freshness/impacts',
    async ({ service }) => ({ body: await service.getFreshnessImpacts() }),
  ],
  [
    'GET /api/v1/freshness/status',
    async ({ service }) => ({ body: await service.getFreshnessStatus() }),
  ],
  [
    'POST /api/v1/freshness/recompute',
    async ({ service }) => ({ body: await service.recomputeFreshness() }),
  ],
  [
    'POST /api/v1/receipts',
    async ({ request, service }) => ({
      statusCode: 201,
      body: await service.submitReceipt(
        await withBadRequest(async () => normalizeReceiptSubmitInput(await readJsonBody(request)))
      ),
    }),
  ],
  ['GET /api/v1/receipts', async ({ service }) => ({ body: await service.listReceipts() })],
  [
    'GET /api/v1/receipts/:id',
    async ({ params, service }) => ({
      body: await service.showReceipt(getRequiredParam(params, 'id')),
    }),
  ],
  [
    'POST /api/v1/receipts/:id/validate',
    async ({ params, service }) => ({
      body: await service.validateReceipt(getRequiredParam(params, 'id')),
    }),
  ],
  [
    'POST /api/v1/receipts/:id/reject',
    async ({ params, service }) => ({
      body: await service.rejectReceipt(getRequiredParam(params, 'id')),
    }),
  ],
]);

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ServerScbsService,
  report: ServeReport
): Promise<void> {
  const method = normalizeMethod(request.method);
  const path = getRequestPath(request.url);

  try {
    const methodMatches = routeManifest
      .filter((route) => route.path === path || matchRoute(route.path, path))
      .map((route) => route.method);

    const routeMatch = routeManifest
      .filter((route) => route.method === method)
      .map((route) => {
        const params = matchRoute(route.path, path);
        return params ? { route, params } : undefined;
      })
      .find((candidate): candidate is NonNullable<RouteMatch> => candidate !== undefined);

    if (routeMatch) {
      const handler = routeHandlers.get(`${routeMatch.route.method} ${routeMatch.route.path}`);
      if (!handler) {
        throw new Error(
          `Missing route handler for ${routeMatch.route.method} ${routeMatch.route.path}`
        );
      }

      const result = await handler({
        params: routeMatch.params,
        service,
        report,
        request,
      });
      writeJson(response, result.statusCode ?? routeMatch.route.success.statusCode, result.body);
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

    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    throw new HttpError(400, 'Bad Request', message);
  }
}

async function withBadRequest<T>(callback: () => Promise<T> | T): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Request body is invalid.';
    throw new HttpError(400, 'Bad Request', message);
  }
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
      } catch {
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
