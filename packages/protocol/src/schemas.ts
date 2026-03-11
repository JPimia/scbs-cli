import type {
  AgentReceipt,
  BundleRequest,
  ClaimRecord,
  DependencyEdge,
  ExternalRef,
  FactRecord,
  FileRecord,
  RepositoryRef,
  SourceAnchor,
  SymbolRecord,
  TaskBundle,
  ViewRecord,
} from './types';

type Guard<T> = (value: unknown, path: string) => T;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, 'expected non-empty string');
  }
  return value;
}

function asOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asString(value, path);
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    fail(path, 'expected number');
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(path, 'expected boolean');
  }
  return value;
}

function asArray<T>(value: unknown, path: string, guard: Guard<T>): T[] {
  if (!Array.isArray(value)) {
    fail(path, 'expected array');
  }
  return value.map((entry, index) => guard(entry, `${path}[${index}]`));
}

function asOptionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asArray(value, path, asString);
}

const asMetadata = (value: unknown, path: string): Record<string, unknown> | undefined =>
  value === undefined ? undefined : asObject(value, path);

export function parseExternalRef(value: unknown, path = 'externalRef'): ExternalRef {
  const input = asObject(value, path);
  return {
    system: asString(input.system, `${path}.system`),
    entity: asString(input.entity, `${path}.entity`),
    id: asString(input.id, `${path}.id`),
    version: asOptionalString(input.version, `${path}.version`),
  };
}

export function parseSourceAnchor(value: unknown, path = 'sourceAnchor'): SourceAnchor {
  const input = asObject(value, path);
  const startLine =
    input.startLine === undefined ? undefined : asNumber(input.startLine, `${path}.startLine`);
  const endLine =
    input.endLine === undefined ? undefined : asNumber(input.endLine, `${path}.endLine`);
  return {
    repoId: asString(input.repoId, `${path}.repoId`),
    filePath: asString(input.filePath, `${path}.filePath`),
    fileHash: asString(input.fileHash, `${path}.fileHash`),
    startLine,
    endLine,
    symbolId: asOptionalString(input.symbolId, `${path}.symbolId`),
    excerptHash: asOptionalString(input.excerptHash, `${path}.excerptHash`),
  };
}

export function parseRepositoryRef(value: unknown, path = 'repository'): RepositoryRef {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    name: asString(input.name, `${path}.name`),
    rootPath: asOptionalString(input.rootPath, `${path}.rootPath`),
    remoteUrl: asOptionalString(input.remoteUrl, `${path}.remoteUrl`),
    defaultBranch: asOptionalString(input.defaultBranch, `${path}.defaultBranch`),
    provider: asOptionalString(input.provider, `${path}.provider`),
    projectKey: asOptionalString(input.projectKey, `${path}.projectKey`),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
    createdAt: asString(input.createdAt, `${path}.createdAt`),
    updatedAt: asString(input.updatedAt, `${path}.updatedAt`),
  };
}

export function parseFileRecord(value: unknown, path = 'file'): FileRecord {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    repoId: asString(input.repoId, `${path}.repoId`),
    path: asString(input.path, `${path}.path`),
    language: asOptionalString(input.language, `${path}.language`),
    kind: asOptionalString(input.kind, `${path}.kind`),
    hash: asString(input.hash, `${path}.hash`),
    sizeBytes:
      input.sizeBytes === undefined ? undefined : asNumber(input.sizeBytes, `${path}.sizeBytes`),
    exists: asBoolean(input.exists, `${path}.exists`),
    versionStamp: asString(input.versionStamp, `${path}.versionStamp`),
    lastSeenAt: asString(input.lastSeenAt, `${path}.lastSeenAt`),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
  };
}

export function parseFactRecord(value: unknown, path = 'fact'): FactRecord {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    repoId: asString(input.repoId, `${path}.repoId`),
    type: asString(input.type, `${path}.type`),
    subjectType: asString(input.subjectType, `${path}.subjectType`) as FactRecord['subjectType'],
    subjectId: asString(input.subjectId, `${path}.subjectId`),
    value: asObject(input.value, `${path}.value`),
    anchors: asArray(input.anchors, `${path}.anchors`, parseSourceAnchor),
    versionStamp: asString(input.versionStamp, `${path}.versionStamp`),
    freshness: asString(input.freshness, `${path}.freshness`) as FactRecord['freshness'],
    createdAt: asString(input.createdAt, `${path}.createdAt`),
    updatedAt: asString(input.updatedAt, `${path}.updatedAt`),
  };
}

export function parseSymbolRecord(value: unknown, path = 'symbol'): SymbolRecord {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    repoId: asString(input.repoId, `${path}.repoId`),
    fileId: asString(input.fileId, `${path}.fileId`),
    name: asString(input.name, `${path}.name`),
    kind: asString(input.kind, `${path}.kind`),
    exportName: asOptionalString(input.exportName, `${path}.exportName`),
    signature: asOptionalString(input.signature, `${path}.signature`),
    anchor: parseSourceAnchor(input.anchor, `${path}.anchor`),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
  };
}

export function parseDependencyEdge(value: unknown, path = 'edge'): DependencyEdge {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    repoId: asString(input.repoId, `${path}.repoId`),
    fromType: asString(input.fromType, `${path}.fromType`) as DependencyEdge['fromType'],
    fromId: asString(input.fromId, `${path}.fromId`),
    toType: asString(input.toType, `${path}.toType`) as DependencyEdge['toType'],
    toId: asString(input.toId, `${path}.toId`),
    edgeType: asString(input.edgeType, `${path}.edgeType`),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
  };
}

export function parseClaimRecord(value: unknown, path = 'claim'): ClaimRecord {
  const input = asObject(value, path);
  const confidence = asNumber(input.confidence, `${path}.confidence`);
  if (confidence < 0 || confidence > 1) {
    fail(`${path}.confidence`, 'expected value between 0 and 1');
  }
  return {
    id: asString(input.id, `${path}.id`),
    repoId: asString(input.repoId, `${path}.repoId`),
    text: asString(input.text, `${path}.text`),
    type: asString(input.type, `${path}.type`) as ClaimRecord['type'],
    confidence,
    trustTier: asString(input.trustTier, `${path}.trustTier`) as ClaimRecord['trustTier'],
    factIds: asArray(input.factIds, `${path}.factIds`, asString),
    anchors: asArray(input.anchors, `${path}.anchors`, parseSourceAnchor),
    freshness: asString(input.freshness, `${path}.freshness`) as ClaimRecord['freshness'],
    invalidationKeys: asArray(input.invalidationKeys, `${path}.invalidationKeys`, asString),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
    createdAt: asString(input.createdAt, `${path}.createdAt`),
    updatedAt: asString(input.updatedAt, `${path}.updatedAt`),
  };
}

export function parseViewRecord(value: unknown, path = 'view'): ViewRecord {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    repoId: asString(input.repoId, `${path}.repoId`),
    type: asString(input.type, `${path}.type`) as ViewRecord['type'],
    key: asString(input.key, `${path}.key`),
    title: asString(input.title, `${path}.title`),
    summary: asString(input.summary, `${path}.summary`),
    claimIds: asArray(input.claimIds, `${path}.claimIds`, asString),
    fileScope: asOptionalStringArray(input.fileScope, `${path}.fileScope`),
    symbolScope: asOptionalStringArray(input.symbolScope, `${path}.symbolScope`),
    freshness: asString(input.freshness, `${path}.freshness`) as ViewRecord['freshness'],
    metadata: asMetadata(input.metadata, `${path}.metadata`),
    createdAt: asString(input.createdAt, `${path}.createdAt`),
    updatedAt: asString(input.updatedAt, `${path}.updatedAt`),
  };
}

export function parseBundleRequest(value: unknown, path = 'bundleRequest'): BundleRequest {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    taskTitle: asString(input.taskTitle, `${path}.taskTitle`),
    taskDescription: asOptionalString(input.taskDescription, `${path}.taskDescription`),
    repoIds: asArray(input.repoIds, `${path}.repoIds`, asString),
    fileScope: asOptionalStringArray(input.fileScope, `${path}.fileScope`),
    symbolScope: asOptionalStringArray(input.symbolScope, `${path}.symbolScope`),
    role: asOptionalString(input.role, `${path}.role`),
    parentBundleId: asOptionalString(input.parentBundleId, `${path}.parentBundleId`),
    externalRef:
      input.externalRef === undefined
        ? undefined
        : parseExternalRef(input.externalRef, `${path}.externalRef`),
    constraints:
      input.constraints === undefined
        ? undefined
        : (asObject(input.constraints, `${path}.constraints`) as BundleRequest['constraints']),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
  };
}

export function parseTaskBundle(value: unknown, path = 'taskBundle'): TaskBundle {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    requestId: asString(input.requestId, `${path}.requestId`),
    repoIds: asArray(input.repoIds, `${path}.repoIds`, asString),
    summary: asString(input.summary, `${path}.summary`),
    selectedViewIds: asArray(input.selectedViewIds, `${path}.selectedViewIds`, asString),
    selectedClaimIds: asArray(input.selectedClaimIds, `${path}.selectedClaimIds`, asString),
    fileScope: asArray(input.fileScope, `${path}.fileScope`, asString),
    symbolScope: asArray(input.symbolScope, `${path}.symbolScope`, asString),
    commands: asArray(input.commands, `${path}.commands`, asString),
    proofHandles: asArray(input.proofHandles, `${path}.proofHandles`, parseSourceAnchor),
    freshness: asString(input.freshness, `${path}.freshness`) as TaskBundle['freshness'],
    cacheKey: asOptionalString(input.cacheKey, `${path}.cacheKey`),
    metadata: asMetadata(input.metadata, `${path}.metadata`),
    createdAt: asString(input.createdAt, `${path}.createdAt`),
    expiresAt: asOptionalString(input.expiresAt, `${path}.expiresAt`),
  };
}

export function parseAgentReceipt(value: unknown, path = 'agentReceipt'): AgentReceipt {
  const input = asObject(value, path);
  return {
    id: asString(input.id, `${path}.id`),
    externalRef:
      input.externalRef === undefined
        ? undefined
        : parseExternalRef(input.externalRef, `${path}.externalRef`),
    repoIds: asArray(input.repoIds, `${path}.repoIds`, asString),
    bundleId: asOptionalString(input.bundleId, `${path}.bundleId`),
    fromRole: asOptionalString(input.fromRole, `${path}.fromRole`),
    fromRunId: asOptionalString(input.fromRunId, `${path}.fromRunId`),
    type: asString(input.type, `${path}.type`) as AgentReceipt['type'],
    summary: asString(input.summary, `${path}.summary`),
    payload: asObject(input.payload, `${path}.payload`),
    status: asString(input.status, `${path}.status`) as AgentReceipt['status'],
    createdAt: asString(input.createdAt, `${path}.createdAt`),
    updatedAt: asString(input.updatedAt, `${path}.updatedAt`),
  };
}
