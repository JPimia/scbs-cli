import type {
  ApiSurface,
  BundleRecord,
  ClaimRecord,
  DoctorReport,
  FactRecord,
  FreshnessImpact,
  FreshnessState,
  InitReport,
  MigrationReport,
  ReceiptRecord,
  RepoRecord,
  ServeReport,
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
  init(configPath: string): Promise<InitReport>;
  serve(): Promise<ServeReport>;
  health(): Promise<{ status: 'ok'; service: string; version: string }>;
  doctor(): Promise<DoctorReport>;
  migrate(): Promise<MigrationReport>;
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

export const createApiCapabilities = (): ApiSurface['capabilities'] => [
  {
    name: 'bundle-plan',
    description:
      'Plan local bundle requests against registered repositories and materialized views.',
  },
  {
    name: 'receipt-ingest',
    description: 'Ingest and validate agent receipts against planned bundles.',
  },
  {
    name: 'freshness-check',
    description:
      'Inspect bundle freshness, impacts, and recomputation status from the local store.',
  },
  {
    name: 'view-rebuild',
    description:
      'Trigger local rebuilds for derived views when freshness or repo changes demand it.',
  },
  {
    name: 'repo-registration',
    description: 'Register and scan repositories that participate in the local SCBS surface.',
  },
  {
    name: 'repo-change-report',
    description: 'Report changed repository files to surface freshness impacts and rebuild work.',
  },
];
