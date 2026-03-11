export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'partial' | 'unknown';

export interface ServiceCapability {
  name:
    | 'bundle-plan'
    | 'receipt-ingest'
    | 'freshness-check'
    | 'view-rebuild'
    | 'repo-registration'
    | 'repo-change-report';
  description: string;
}

export interface ApiSurface {
  kind: 'local-durable';
  baseUrl: string;
  apiVersion: 'v1';
  mode: 'dry-run' | 'live';
  capabilities: ServiceCapability[];
}

export interface StorageSurface {
  adapter: 'local-json' | 'postgres';
  driver?: 'local-json' | 'postgres';
  configPath: string;
  statePath: string;
  stateExists: boolean;
  databaseUrl?: string;
  migrationTable?: string;
}

export interface InitReport {
  mode: 'local-durable';
  configPath: string;
  statePath: string;
  created: boolean;
  configCreated: boolean;
  stateCreated: boolean;
  driver?: 'local-json' | 'postgres';
  databaseUrl?: string;
  migrationTable?: string;
}

export interface ServeReport {
  service: string;
  status: 'ready' | 'listening';
  api: ApiSurface;
  storage: StorageSurface;
}

export interface MigrationReport {
  adapter: 'local-json' | 'postgres';
  statePath: string;
  applied: string[];
  pending: number;
  baselineVersion: string;
  stateCreated: boolean;
  driver?: 'local-json' | 'postgres';
  databaseUrl?: string;
  migrationTable?: string;
  currentVersion?: string;
}

export interface RepoRecord {
  id: string;
  name: string;
  path: string;
  status: 'registered' | 'scanned';
  lastScannedAt: string | null;
}

export interface FactRecord {
  id: string;
  repoId: string;
  subject: string;
  freshness: FreshnessState;
}

export interface ClaimRecord {
  id: string;
  repoId: string;
  statement: string;
  factIds: string[];
  freshness: FreshnessState;
}

export interface ViewRecord {
  id: string;
  repoId: string;
  name: string;
  claimIds: string[];
  freshness: FreshnessState;
}

export interface BundleRecord {
  id: string;
  repoIds: string[];
  task: string;
  viewIds: string[];
  freshness: FreshnessState;
  parentBundleId?: string;
  fileScope?: string[];
  symbolScope?: string[];
  commands?: string[];
  proofHandles?: Array<{
    repoId: string;
    filePath: string;
    fileHash: string;
  }>;
  warnings?: string[];
}

export interface FreshnessImpact {
  artifactType: 'fact' | 'claim' | 'view' | 'bundle';
  artifactId: string;
  state: FreshnessState;
}

export interface ReceiptRecord {
  id: string;
  bundleId: string | null;
  agent: string;
  summary: string;
  status: 'pending' | 'validated' | 'rejected';
}

export interface DoctorReport {
  status: 'ok' | 'warn';
  summary: string;
  api: ApiSurface;
  storage: StorageSurface;
  checks: Array<{
    name: string;
    status: 'ok' | 'warn';
    detail: string;
  }>;
}

export interface JsonEnvelope<T> {
  ok: true;
  command: string;
  data: T;
}
