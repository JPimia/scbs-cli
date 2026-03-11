import type { BundleRequest, TaskBundle } from '../../../packages/protocol/src/index';

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

export interface ServeReport {
  service: string;
  status: 'ready' | 'listening';
  api: ApiSurface;
  storage: StorageSurface;
}

export type BundleRecord = TaskBundle;

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

export interface FreshnessImpact {
  artifactType: 'fact' | 'claim' | 'view' | 'bundle';
  artifactId: string;
  state: FreshnessState;
}

export type FreshnessJobKind = 'freshness_recompute' | 'repo_scan' | 'receipt_validation';

export type FreshnessJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface FreshnessEventRecord {
  id: string;
  repoId: string;
  files: string[];
  createdAt: string;
}

export interface FreshnessJobRecord {
  id: string;
  kind: FreshnessJobKind;
  repoId: string;
  eventId?: string;
  targetId: string;
  files: string[];
  status: FreshnessJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface FreshnessWorkerReport {
  processed: number;
  remaining: number;
  jobIds: string[];
  failedJobIds: string[];
}

export interface JobSummary {
  pending: number;
  running: number;
  completed: number;
  failed: number;
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

export interface JobListReport {
  summary: JobSummary;
  jobs: FreshnessJobRecord[];
  recentEvents: FreshnessEventRecord[];
  pendingReceiptIds: string[];
}

export interface ReceiptRecord {
  id: string;
  bundleId: string | null;
  agent: string;
  summary: string;
  status: 'pending' | 'validated' | 'rejected';
}

export type BundlePlanInput = BundleRequest;

export interface ReceiptSubmitInput {
  bundleId: string | null;
  agent: string;
  summary: string;
}

export interface RegisterRepoInput {
  name: string;
  path: string;
}

export interface RepoChangesInput {
  id: string;
  files: string[];
}

export interface ServerScbsService {
  health(): Promise<{ status: 'ok'; service: string; version: string }>;
  doctor(): Promise<DoctorReport>;
  listJobs(): Promise<JobListReport>;
  showJob(id: string): Promise<FreshnessJobRecord>;
  retryJob(id: string): Promise<FreshnessJobRecord>;
  registerRepo(input: RegisterRepoInput): Promise<RepoRecord>;
  listRepos(): Promise<RepoRecord[]>;
  showRepo(id: string): Promise<RepoRecord>;
  scanRepo(id: string, options?: { queue?: boolean }): Promise<RepoRecord>;
  reportRepoChanges(
    input: RepoChangesInput
  ): Promise<{ repoId: string; files: string[]; impacts: number }>;
  listFacts(): Promise<FactRecord[]>;
  listClaims(): Promise<ClaimRecord[]>;
  showClaim(id: string): Promise<ClaimRecord>;
  listViews(): Promise<ViewRecord[]>;
  showView(id: string): Promise<ViewRecord>;
  rebuildView(id: string): Promise<ViewRecord>;
  planBundle(input: BundlePlanInput): Promise<BundleRecord>;
  showBundle(id: string): Promise<BundleRecord>;
  getBundleFreshness(id: string): Promise<{ bundleId: string; freshness: FreshnessState }>;
  expireBundle(id: string): Promise<BundleRecord>;
  listBundleCache(): Promise<Array<{ key: string; bundleId: string; freshness: FreshnessState }>>;
  clearBundleCache(): Promise<{ cleared: number }>;
  getFreshnessImpacts(): Promise<FreshnessImpact[]>;
  getFreshnessStatus(): Promise<{ overall: FreshnessState; staleArtifacts: number }>;
  recomputeFreshness(): Promise<{ updated: number }>;
  runFreshnessWorker(options?: {
    limit?: number;
    kinds?: FreshnessJobKind[];
    jobIds?: string[];
  }): Promise<FreshnessWorkerReport>;
  submitReceipt(input: ReceiptSubmitInput): Promise<ReceiptRecord>;
  listReceipts(): Promise<ReceiptRecord[]>;
  showReceipt(id: string): Promise<ReceiptRecord>;
  validateReceipt(id: string, options?: { queue?: boolean }): Promise<ReceiptRecord>;
  rejectReceipt(id: string): Promise<ReceiptRecord>;
}
