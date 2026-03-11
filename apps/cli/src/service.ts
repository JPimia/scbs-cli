import type { BundleRequest } from '../../../packages/protocol/src/index';
import type {
  ApiSurface,
  BundleRecord,
  ClaimRecord,
  DoctorReport,
  FactRecord,
  FreshnessImpact,
  FreshnessJobKind,
  FreshnessJobRecord,
  FreshnessState,
  FreshnessWorkerReport,
  InitReport,
  JobListReport,
  MigrationReport,
  ReceiptRecord,
  RepoRecord,
  ServeReport,
  ViewRecord,
  WorkerLoopReport,
} from './types';

export interface RegisterRepoInput {
  name: string;
  path: string;
}

export interface RepoChangesInput {
  id: string;
  files: string[];
}

export interface BundlePlanInput {
  id?: string;
  taskTitle?: string;
  taskDescription?: string;
  repoIds?: string[];
  repoId?: string;
  task: string;
  role?: BundleRequest['role'];
  parentBundleId?: string;
  externalRef?: BundleRequest['externalRef'];
  fileScope?: string[];
  symbolScope?: string[];
  constraints?: BundleRequest['constraints'];
  metadata?: BundleRequest['metadata'];
}

export interface ReceiptSubmitInput {
  bundleId: string | null;
  agent: string;
  summary: string;
}

export interface ScbsService {
  init(configPath: string): Promise<InitReport>;
  serve(): Promise<ServeReport>;
  health(): Promise<{ status: 'ok'; service: string; version: string }>;
  doctor(): Promise<DoctorReport>;
  listJobs(): Promise<JobListReport>;
  showJob(id: string): Promise<FreshnessJobRecord>;
  retryJob(id: string): Promise<FreshnessJobRecord>;
  migrate(): Promise<MigrationReport>;
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
  recomputeFreshness(): Promise<{ updated: number }>;
  runFreshnessWorker(options?: {
    limit?: number;
    kinds?: FreshnessJobKind[];
    jobIds?: string[];
  }): Promise<FreshnessWorkerReport>;
  runWorkerLoop(options?: {
    pollIntervalMs?: number;
    maxIdleCycles?: number;
    limit?: number;
    kinds?: FreshnessJobKind[];
  }): Promise<WorkerLoopReport>;
  getFreshnessStatus(): Promise<{ overall: FreshnessState; staleArtifacts: number }>;
  submitReceipt(input: ReceiptSubmitInput): Promise<ReceiptRecord>;
  listReceipts(): Promise<ReceiptRecord[]>;
  showReceipt(id: string): Promise<ReceiptRecord>;
  validateReceipt(id: string, options?: { queue?: boolean }): Promise<ReceiptRecord>;
  rejectReceipt(id: string): Promise<ReceiptRecord>;
}

export const createApiCapabilities = (): ApiSurface['capabilities'] => [
  {
    name: 'bundle-plan',
    description: 'Plan bundle requests against registered repositories and materialized views.',
  },
  {
    name: 'receipt-ingest',
    description: 'Ingest and validate agent receipts against planned bundles.',
  },
  {
    name: 'freshness-check',
    description: 'Inspect bundle freshness, impacts, and recomputation status from service state.',
  },
  {
    name: 'view-rebuild',
    description: 'Trigger rebuilds for derived views when freshness or repo changes demand it.',
  },
  {
    name: 'repo-registration',
    description: 'Register and scan repositories that participate in the standalone SCBS service.',
  },
  {
    name: 'repo-change-report',
    description: 'Report changed repository files to surface freshness impacts and rebuild work.',
  },
];
