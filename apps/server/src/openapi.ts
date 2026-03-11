import { routeManifest } from './contract';

const freshnessStateEnum = ['fresh', 'stale', 'expired', 'partial', 'unknown'] as const;

type JsonSchema = Record<string, unknown>;

function toOpenApiPath(path: string): string {
  return path.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function componentRef(name: string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

function responseContent(schemaName: string): Record<string, unknown> {
  return {
    'application/json': {
      schema: componentRef(schemaName),
    },
  };
}

function schemaNameFor(type: string): string {
  switch (type) {
    case 'health':
      return 'HealthResponse';
    case 'apiIndex':
      return 'ApiIndexResponse';
    case 'bundleRecord':
      return 'BundleRecord';
    case 'bundleFreshness':
      return 'BundleFreshnessResponse';
    case 'bundleCache':
      return 'BundleCacheEntryList';
    case 'clearBundleCacheResult':
      return 'ClearBundleCacheResult';
    case 'freshnessImpacts':
      return 'FreshnessImpactList';
    case 'freshnessStatus':
      return 'FreshnessStatusResponse';
    case 'recomputeFreshnessResult':
      return 'RecomputeFreshnessResult';
    case 'receiptRecord':
      return 'ReceiptRecord';
    case 'receiptList':
      return 'ReceiptRecordList';
    case 'bundlePlanInput':
      return 'BundlePlanInput';
    case 'receiptSubmitInput':
      return 'ReceiptSubmitInput';
    default:
      return 'Unknown';
  }
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routeManifest) {
    const openApiPath = toOpenApiPath(route.path);
    const existingPathItem = paths[openApiPath];
    const pathItem = existingPathItem ?? {};
    if (!existingPathItem) {
      paths[openApiPath] = pathItem;
    }
    const operation: Record<string, unknown> = {
      tags: [route.tag],
      operationId: route.operationId,
      summary: route.summary,
      responses: {
        [String(route.success.statusCode)]: {
          description: route.success.description,
          content: responseContent(schemaNameFor(route.success.schema.type)),
        },
      },
    };

    if (route.pathParams) {
      operation.parameters = route.pathParams.map((param) => ({
        name: param.name,
        in: 'path',
        required: true,
        description: param.description,
        schema: { type: 'string' },
      }));
    }

    if (route.requestBody) {
      operation.requestBody = {
        required: route.requestBody.required,
        description: route.requestBody.description,
        content: responseContent(schemaNameFor(route.requestBody.schema.type)),
      };
    }

    pathItem[route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'SCBS Server API',
      version: '0.1.0',
      description:
        'First-class server-owned HTTP contract for the Shared Context Build System versioned v1 API.',
    },
    servers: [{ url: 'http://127.0.0.1:8791' }],
    tags: [{ name: 'System' }, { name: 'Bundles' }, { name: 'Freshness' }, { name: 'Receipts' }],
    paths,
    components: {
      schemas: buildComponentSchemas(),
    },
  };
}

function buildComponentSchemas(): Record<string, JsonSchema> {
  return {
    FreshnessState: {
      type: 'string',
      enum: [...freshnessStateEnum],
    },
    ServiceCapability: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
    },
    ApiSurface: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'baseUrl', 'apiVersion', 'mode', 'capabilities'],
      properties: {
        kind: { const: 'local-durable' },
        baseUrl: { type: 'string' },
        apiVersion: { const: 'v1' },
        mode: { type: 'string', enum: ['dry-run', 'live'] },
        capabilities: {
          type: 'array',
          items: componentRef('ServiceCapability'),
        },
      },
    },
    HealthResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'service', 'version'],
      properties: {
        status: { const: 'ok' },
        service: { type: 'string' },
        version: { type: 'string' },
      },
    },
    ApiIndexResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['service', 'status', 'api', 'endpoints'],
      properties: {
        service: { type: 'string' },
        status: { type: 'string', enum: ['ready', 'listening'] },
        api: componentRef('ApiSurface'),
        endpoints: {
          type: 'object',
          additionalProperties: false,
          required: [
            'health',
            'root',
            'planBundle',
            'showBundle',
            'bundleFreshness',
            'expireBundle',
            'listBundleCache',
            'clearBundleCache',
            'freshnessImpacts',
            'freshnessStatus',
            'recomputeFreshness',
            'createReceipt',
            'listReceipts',
            'showReceipt',
            'validateReceipt',
            'rejectReceipt',
          ],
          properties: {
            health: { type: 'string' },
            root: { type: 'string' },
            planBundle: { type: 'string' },
            showBundle: { type: 'string' },
            bundleFreshness: { type: 'string' },
            expireBundle: { type: 'string' },
            listBundleCache: { type: 'string' },
            clearBundleCache: { type: 'string' },
            freshnessImpacts: { type: 'string' },
            freshnessStatus: { type: 'string' },
            recomputeFreshness: { type: 'string' },
            createReceipt: { type: 'string' },
            listReceipts: { type: 'string' },
            showReceipt: { type: 'string' },
            validateReceipt: { type: 'string' },
            rejectReceipt: { type: 'string' },
          },
        },
      },
    },
    BundlePlanInput: {
      type: 'object',
      additionalProperties: false,
      required: ['task'],
      properties: {
        task: { type: 'string' },
        repo: { type: 'string' },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
        },
        parentBundleId: { type: 'string' },
        fileScope: {
          type: 'array',
          items: { type: 'string' },
        },
        symbolScope: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      oneOf: [{ required: ['repo'] }, { required: ['repoIds'] }],
    },
    BundleRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'repoIds', 'task', 'viewIds', 'freshness'],
      properties: {
        id: { type: 'string' },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
        },
        task: { type: 'string' },
        viewIds: {
          type: 'array',
          items: { type: 'string' },
        },
        freshness: componentRef('FreshnessState'),
        parentBundleId: { type: 'string' },
        fileScope: {
          type: 'array',
          items: { type: 'string' },
        },
        symbolScope: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    BundleFreshnessResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['bundleId', 'freshness'],
      properties: {
        bundleId: { type: 'string' },
        freshness: componentRef('FreshnessState'),
      },
    },
    BundleCacheEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'bundleId', 'freshness'],
      properties: {
        key: { type: 'string' },
        bundleId: { type: 'string' },
        freshness: componentRef('FreshnessState'),
      },
    },
    BundleCacheEntryList: {
      type: 'array',
      items: componentRef('BundleCacheEntry'),
    },
    ClearBundleCacheResult: {
      type: 'object',
      additionalProperties: false,
      required: ['cleared'],
      properties: {
        cleared: { type: 'integer', minimum: 0 },
      },
    },
    FreshnessImpact: {
      type: 'object',
      additionalProperties: false,
      required: ['artifactType', 'artifactId', 'state'],
      properties: {
        artifactType: { type: 'string', enum: ['fact', 'claim', 'view', 'bundle'] },
        artifactId: { type: 'string' },
        state: componentRef('FreshnessState'),
      },
    },
    FreshnessImpactList: {
      type: 'array',
      items: componentRef('FreshnessImpact'),
    },
    FreshnessStatusResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'staleArtifacts'],
      properties: {
        overall: componentRef('FreshnessState'),
        staleArtifacts: { type: 'integer', minimum: 0 },
      },
    },
    RecomputeFreshnessResult: {
      type: 'object',
      additionalProperties: false,
      required: ['updated'],
      properties: {
        updated: { type: 'integer', minimum: 0 },
      },
    },
    ReceiptSubmitInput: {
      type: 'object',
      additionalProperties: false,
      required: ['agent', 'summary'],
      properties: {
        bundle: { type: 'string' },
        agent: { type: 'string' },
        summary: { type: 'string' },
      },
    },
    ReceiptRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'bundleId', 'agent', 'summary', 'status'],
      properties: {
        id: { type: 'string' },
        bundleId: { type: ['string', 'null'] },
        agent: { type: 'string' },
        summary: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'validated', 'rejected'] },
      },
    },
    ReceiptRecordList: {
      type: 'array',
      items: componentRef('ReceiptRecord'),
    },
  };
}

export function buildOpenApiJson(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

export function buildOpenApiYaml(): string {
  return `${toYaml(buildOpenApiDocument())}\n`;
}

function toYaml(value: unknown, indent = 0): string {
  const prefix = ' '.repeat(indent);

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    return value
      .map((entry) => {
        const rendered = toYaml(entry, indent + 2);
        if (isScalar(entry)) {
          return `${prefix}- ${rendered}`;
        }
        return `${prefix}- ${rendered.startsWith('\n') ? rendered.trimStart() : `\n${rendered}`}`;
      })
      .join('\n');
  }

  const objectValue = value as Record<string, unknown>;
  const entries = Object.entries(objectValue);
  if (entries.length === 0) {
    return '{}';
  }

  return entries
    .map(([key, entryValue]) => {
      if (isScalar(entryValue)) {
        return `${prefix}${key}: ${toYaml(entryValue, indent + 2)}`;
      }

      const rendered = toYaml(entryValue, indent + 2);
      return `${prefix}${key}:\n${rendered}`;
    })
    .join('\n');
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
