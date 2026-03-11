import type { TaskBundle } from '../../../packages/protocol/src/index';

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
  kind: 'standalone';
  baseUrl: string;
  apiVersion: 'v1';
  mode: 'dry-run' | 'live';
  capabilities: ServiceCapability[];
}

export type StorageAdapter = 'local-json' | 'postgres';

export interface StorageSurface {
  adapter: StorageAdapter;
  configPath: string;
  statePath?: string;
  stateExists: boolean;
  databaseUrlConfigured?: boolean;
}

export interface InitReport {
  mode: StorageAdapter;
  configPath: string;
  statePath?: string;
  created: boolean;
  configCreated: boolean;
  stateCreated: boolean;
}

export interface ServeReport {
  service: string;
  status: 'ready' | 'listening';
  api: ApiSurface;
  storage: StorageSurface;
}

export interface MigrationReport {
  adapter: StorageAdapter;
  statePath?: string;
  applied: string[];
  pending: number;
  baselineVersion: string;
  stateCreated: boolean;
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

export type BundleRecord = TaskBundle;

export interface FreshnessImpact {
  artifactType: 'fact' | 'claim' | 'view' | 'bundle';
  artifactId: string;
  state: FreshnessState;
}

export interface FreshnessEventRecord {
  id: string;
  repoId: string;
  files: string[];
  createdAt: string;
}

export interface FreshnessJobRecord {
  id: string;
  kind: 'freshness_recompute' | 'repo_scan' | 'receipt_validation';
  repoId: string;
  eventId?: string;
  targetId: string;
  files: string[];
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export interface FreshnessWorkerReport {
  processed: number;
  remaining: number;
  jobIds: string[];
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
  diagnostics: {
    artifacts: {
      repos: number;
      facts: number;
      claims: number;
      views: number;
      bundles: number;
      cachedBundles: number;
      receipts: number;
    };
    freshness: {
      overall: FreshnessState;
      staleArtifacts: number;
      pendingJobs: number;
      completedJobs: number;
      recentEvents: number;
    };
    receipts: {
      pending: number;
      validated: number;
      rejected: number;
    };
    hotspots: {
      staleBundleIds: string[];
      pendingReceiptIds: string[];
      pendingJobIds: string[];
    };
  };
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
