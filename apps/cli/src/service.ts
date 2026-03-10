import type {
  BundleRecord,
  ClaimRecord,
  DoctorReport,
  FactRecord,
  FreshnessImpact,
  FreshnessState,
  ReceiptRecord,
  RepoRecord,
  ViewRecord,
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
  repoId: string;
  task: string;
}

export interface ReceiptSubmitInput {
  bundleId: string | null;
  agent: string;
  summary: string;
}

export interface ScbsService {
  init(configPath: string): Promise<{ configPath: string; created: boolean }>;
  serve(): Promise<{ endpoint: string; mode: 'dry-run' }>;
  health(): Promise<{ status: 'ok'; service: string; version: string }>;
  doctor(): Promise<DoctorReport>;
  migrate(): Promise<{ applied: string[]; pending: number }>;
  registerRepo(input: RegisterRepoInput): Promise<RepoRecord>;
  listRepos(): Promise<RepoRecord[]>;
  showRepo(id: string): Promise<RepoRecord>;
  scanRepo(id: string): Promise<RepoRecord>;
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
  getFreshnessStatus(): Promise<{ overall: FreshnessState; staleArtifacts: number }>;
  submitReceipt(input: ReceiptSubmitInput): Promise<ReceiptRecord>;
  listReceipts(): Promise<ReceiptRecord[]>;
  showReceipt(id: string): Promise<ReceiptRecord>;
  validateReceipt(id: string): Promise<ReceiptRecord>;
  rejectReceipt(id: string): Promise<ReceiptRecord>;
}
