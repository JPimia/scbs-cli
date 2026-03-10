export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'provisional' | 'partial' | 'unknown';

export type ClaimType = 'observed' | 'composed' | 'interpretive' | 'human-authored' | 'provisional';

export type TrustTier = 'source' | 'derived' | 'human' | 'provisional';

export type ViewType =
  | 'subsystem'
  | 'interface'
  | 'workflow'
  | 'decision'
  | 'file_scope'
  | 'command_workflow';

export type ReceiptType =
  | 'finding'
  | 'correction'
  | 'invariant'
  | 'edge_case'
  | 'workflow_note'
  | 'test_result';

export type ReceiptStatus = 'provisional' | 'validated' | 'rejected';

export interface ExternalRef {
  system: string;
  entity: string;
  id: string;
  version?: string;
}

export interface SourceAnchor {
  repoId: string;
  filePath: string;
  fileHash: string;
  startLine?: number;
  endLine?: number;
  symbolId?: string;
  excerptHash?: string;
}

export interface RepositoryRef {
  id: string;
  name: string;
  rootPath?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  provider?: string;
  projectKey?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  repoId: string;
  path: string;
  language?: string;
  kind?: string;
  hash: string;
  sizeBytes?: number;
  exists: boolean;
  versionStamp: string;
  lastSeenAt: string;
  metadata?: Record<string, unknown>;
}

export interface SymbolRecord {
  id: string;
  repoId: string;
  fileId: string;
  name: string;
  kind: string;
  exportName?: string;
  signature?: string;
  anchor: SourceAnchor;
  metadata?: Record<string, unknown>;
}

export interface DependencyEdge {
  id: string;
  repoId: string;
  fromType: 'file' | 'symbol' | 'claim' | 'view' | 'bundle';
  fromId: string;
  toType: 'file' | 'symbol' | 'claim' | 'view' | 'bundle';
  toId: string;
  edgeType: string;
  metadata?: Record<string, unknown>;
}

export interface FactRecord {
  id: string;
  repoId: string;
  type: string;
  subjectType: 'repo' | 'file' | 'symbol' | 'config' | 'script' | 'test';
  subjectId: string;
  value: Record<string, unknown>;
  anchors: SourceAnchor[];
  versionStamp: string;
  freshness: Extract<FreshnessState, 'fresh' | 'stale' | 'expired'>;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimRecord {
  id: string;
  repoId: string;
  text: string;
  type: ClaimType;
  confidence: number;
  trustTier: TrustTier;
  factIds: string[];
  anchors: SourceAnchor[];
  freshness: Exclude<FreshnessState, 'provisional'>;
  invalidationKeys: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ViewRecord {
  id: string;
  repoId: string;
  type: ViewType;
  key: string;
  title: string;
  summary: string;
  claimIds: string[];
  fileScope?: string[];
  symbolScope?: string[];
  freshness: Exclude<FreshnessState, 'provisional'>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BundleRequest {
  id: string;
  taskTitle: string;
  taskDescription?: string;
  repoIds: string[];
  fileScope?: string[];
  symbolScope?: string[];
  role?: string;
  parentBundleId?: string;
  externalRef?: ExternalRef;
  constraints?: {
    maxTokens?: number;
    includeProofHandles?: boolean;
    includeCommands?: boolean;
    includeReceipts?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface TaskBundle {
  id: string;
  requestId: string;
  repoIds: string[];
  summary: string;
  selectedViewIds: string[];
  selectedClaimIds: string[];
  fileScope: string[];
  symbolScope: string[];
  commands: string[];
  proofHandles: SourceAnchor[];
  freshness: Exclude<FreshnessState, 'provisional'>;
  cacheKey?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

export interface BundleCacheEntry {
  id: string;
  cacheKey: string;
  bundleId: string;
  freshness: Extract<FreshnessState, 'fresh' | 'stale' | 'expired' | 'partial'>;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface AgentReceipt {
  id: string;
  externalRef?: ExternalRef;
  repoIds: string[];
  bundleId?: string;
  fromRole?: string;
  fromRunId?: string;
  type: ReceiptType;
  summary: string;
  payload: Record<string, unknown>;
  status: ReceiptStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BundlePlanResult {
  bundle: TaskBundle;
  selectedViews: ViewRecord[];
  selectedClaims: ClaimRecord[];
  warnings: string[];
}

export interface ExtractionResult {
  repository: RepositoryRef;
  files: FileRecord[];
  symbols: SymbolRecord[];
  facts: FactRecord[];
  edges: DependencyEdge[];
  discoveredCommands: string[];
}
