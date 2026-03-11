import { execFileSync } from 'node:child_process';

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
    case 'repoRecord':
      return 'RepoRecord';
    case 'repoList':
      return 'RepoRecordList';
    case 'factList':
      return 'FactRecordList';
    case 'repoChangesResult':
      return 'RepoChangesResult';
    case 'claimRecord':
      return 'ClaimRecord';
    case 'claimList':
      return 'ClaimRecordList';
    case 'viewRecord':
      return 'ViewRecord';
    case 'viewList':
      return 'ViewRecordList';
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
    case 'missionControlBundleStatus':
      return 'MissionControlBundleStatus';
    case 'sisuBundleSnapshot':
      return 'SisuBundleSnapshot';
    case 'sisuReceiptSnapshot':
      return 'SisuReceiptSnapshot';
    case 'bundlePlanInput':
      return 'BundlePlanInput';
    case 'registerRepoInput':
      return 'RegisterRepoInput';
    case 'repoChangesInput':
      return 'RepoChangesInput';
    case 'receiptSubmitInput':
      return 'ReceiptSubmitInput';
    case 'missionControlTaskEnvelope':
      return 'MissionControlTaskEnvelope';
    case 'sisuBundlePlanJob':
      return 'SisuBundlePlanJob';
    case 'sisuReceiptNote':
      return 'SisuReceiptNote';
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
        kind: { const: 'standalone' },
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
            'listRepos',
            'registerRepo',
            'showRepo',
            'scanRepo',
            'reportRepoChanges',
            'listFacts',
            'listClaims',
            'showClaim',
            'listViews',
            'showView',
            'rebuildView',
            'planBundle',
            'missionControlRepoSync',
            'sisuBundleRequest',
            'showBundle',
            'bundleFreshness',
            'expireBundle',
            'listBundleCache',
            'clearBundleCache',
            'freshnessImpacts',
            'freshnessStatus',
            'recomputeFreshness',
            'createReceipt',
            'sisuReceipt',
            'listReceipts',
            'showReceipt',
            'validateReceipt',
            'rejectReceipt',
          ],
          properties: {
            health: { type: 'string' },
            root: { type: 'string' },
            listRepos: { type: 'string' },
            registerRepo: { type: 'string' },
            showRepo: { type: 'string' },
            scanRepo: { type: 'string' },
            reportRepoChanges: { type: 'string' },
            listFacts: { type: 'string' },
            listClaims: { type: 'string' },
            showClaim: { type: 'string' },
            listViews: { type: 'string' },
            showView: { type: 'string' },
            rebuildView: { type: 'string' },
            planBundle: { type: 'string' },
            missionControlRepoSync: { type: 'string' },
            sisuBundleRequest: { type: 'string' },
            showBundle: { type: 'string' },
            bundleFreshness: { type: 'string' },
            expireBundle: { type: 'string' },
            listBundleCache: { type: 'string' },
            clearBundleCache: { type: 'string' },
            freshnessImpacts: { type: 'string' },
            freshnessStatus: { type: 'string' },
            recomputeFreshness: { type: 'string' },
            createReceipt: { type: 'string' },
            sisuReceipt: { type: 'string' },
            listReceipts: { type: 'string' },
            showReceipt: { type: 'string' },
            validateReceipt: { type: 'string' },
            rejectReceipt: { type: 'string' },
          },
        },
      },
    },
    ClaimRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'repoId', 'statement', 'factIds', 'freshness'],
      properties: {
        id: { type: 'string' },
        repoId: { type: 'string' },
        statement: { type: 'string' },
        factIds: {
          type: 'array',
          items: { type: 'string' },
        },
        freshness: componentRef('FreshnessState'),
      },
    },
    ClaimRecordList: {
      type: 'array',
      items: componentRef('ClaimRecord'),
    },
    RepoRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'path', 'status', 'lastScannedAt'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        path: { type: 'string' },
        status: { type: 'string', enum: ['registered', 'scanned'] },
        lastScannedAt: { type: ['string', 'null'] },
      },
    },
    RepoRecordList: {
      type: 'array',
      items: componentRef('RepoRecord'),
    },
    FactRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'repoId', 'subject', 'freshness'],
      properties: {
        id: { type: 'string' },
        repoId: { type: 'string' },
        subject: { type: 'string' },
        freshness: componentRef('FreshnessState'),
      },
    },
    FactRecordList: {
      type: 'array',
      items: componentRef('FactRecord'),
    },
    RegisterRepoInput: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'path'],
      properties: {
        name: { type: 'string' },
        path: { type: 'string' },
      },
    },
    RepoChangesInput: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'files'],
      properties: {
        id: { type: 'string' },
        files: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    RepoChangesResult: {
      type: 'object',
      additionalProperties: false,
      required: ['repoId', 'files', 'impacts'],
      properties: {
        repoId: { type: 'string' },
        files: {
          type: 'array',
          items: { type: 'string' },
        },
        impacts: { type: 'integer', minimum: 0 },
      },
    },
    ViewRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'repoId', 'name', 'claimIds', 'freshness'],
      properties: {
        id: { type: 'string' },
        repoId: { type: 'string' },
        name: { type: 'string' },
        claimIds: {
          type: 'array',
          items: { type: 'string' },
        },
        freshness: componentRef('FreshnessState'),
      },
    },
    ViewRecordList: {
      type: 'array',
      items: componentRef('ViewRecord'),
    },
    BundlePlanInput: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'taskTitle', 'repoIds'],
      properties: {
        id: { type: 'string' },
        taskTitle: { type: 'string' },
        taskDescription: { type: 'string' },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
        },
        role: { type: 'string' },
        parentBundleId: { type: 'string' },
        externalRef: { type: 'object' },
        fileScope: {
          type: 'array',
          items: { type: 'string' },
        },
        symbolScope: {
          type: 'array',
          items: { type: 'string' },
        },
        constraints: { type: 'object' },
        metadata: { type: 'object' },
      },
    },
    MissionControlTaskEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['missionId', 'objective', 'repoIds'],
      properties: {
        missionId: { type: 'string' },
        objective: { type: 'string' },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
        },
        bundleParentId: { type: 'string' },
        fileTargets: {
          type: 'array',
          items: { type: 'string' },
        },
        symbolTargets: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    SisuBundlePlanJob: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'objective', 'repositoryIds'],
      properties: {
        workspaceId: { type: 'string' },
        objective: { type: 'string' },
        repositoryIds: {
          type: 'array',
          items: { type: 'string' },
        },
        parentContextId: { type: 'string' },
        focusFiles: {
          type: 'array',
          items: { type: 'string' },
        },
        focusSymbols: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    BundleRecord: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'requestId',
        'repoIds',
        'summary',
        'selectedViewIds',
        'selectedClaimIds',
        'fileScope',
        'symbolScope',
        'commands',
        'proofHandles',
        'freshness',
        'createdAt',
      ],
      properties: {
        id: { type: 'string' },
        requestId: { type: 'string' },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
        },
        summary: { type: 'string' },
        selectedViewIds: {
          type: 'array',
          items: { type: 'string' },
        },
        selectedClaimIds: {
          type: 'array',
          items: { type: 'string' },
        },
        commands: {
          type: 'array',
          items: { type: 'string' },
        },
        proofHandles: {
          type: 'array',
          items: { type: 'object' },
        },
        freshness: componentRef('FreshnessState'),
        cacheKey: { type: 'string' },
        metadata: { type: 'object' },
        createdAt: { type: 'string' },
        expiresAt: { type: 'string' },
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
    MissionControlBundleStatus: {
      type: 'object',
      additionalProperties: false,
      required: ['missionId', 'bundleId', 'task', 'repoIds', 'trackedViewIds', 'freshness'],
      properties: {
        missionId: { type: 'string' },
        bundleId: { type: 'string' },
        task: { type: 'string' },
        repoIds: {
          type: 'array',
          items: { type: 'string' },
        },
        trackedViewIds: {
          type: 'array',
          items: { type: 'string' },
        },
        freshness: componentRef('FreshnessState'),
        bundleParentId: { type: 'string' },
      },
    },
    SisuBundleSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'bundleId', 'objective', 'repositoryIds', 'viewIds', 'freshness'],
      properties: {
        workspaceId: { type: 'string' },
        bundleId: { type: 'string' },
        objective: { type: 'string' },
        repositoryIds: {
          type: 'array',
          items: { type: 'string' },
        },
        viewIds: {
          type: 'array',
          items: { type: 'string' },
        },
        freshness: componentRef('FreshnessState'),
        parentContextId: { type: 'string' },
        focusFiles: {
          type: 'array',
          items: { type: 'string' },
        },
        focusSymbols: {
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
    SisuReceiptNote: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'agent', 'summary'],
      properties: {
        workspaceId: { type: 'string' },
        agent: { type: 'string' },
        summary: { type: 'string' },
        bundleContextId: { type: 'string' },
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
    SisuReceiptSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'receiptId', 'agent', 'summary', 'status'],
      properties: {
        workspaceId: { type: 'string' },
        receiptId: { type: 'string' },
        agent: { type: 'string' },
        summary: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'validated', 'rejected'] },
        bundleContextId: { type: 'string' },
      },
    },
    ReceiptRecordList: {
      type: 'array',
      items: componentRef('ReceiptRecord'),
    },
  };
}

export function buildOpenApiJson(): string {
  const document = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

  try {
    return execFileSync(
      'bun',
      ['x', '@biomejs/biome', 'format', '--stdin-file-path=openapi/scbs-v1.openapi.json'],
      {
        input: document,
        encoding: 'utf8',
      }
    );
  } catch {
    return document;
  }
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
