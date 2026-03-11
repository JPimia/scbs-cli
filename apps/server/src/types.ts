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

export interface StorageSurface {
  adapter: 'local-json';
  configPath: string;
  statePath: string;
  stateExists: boolean;
}

export interface ServeReport {
  service: string;
  status: 'ready' | 'listening';
  api: ApiSurface;
  storage: StorageSurface;
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

export interface ReceiptRecord {
  id: string;
  bundleId: string | null;
  agent: string;
  summary: string;
  status: 'pending' | 'validated' | 'rejected';
}

export interface BundlePlanInput {
  repoIds?: string[];
  repoId?: string;
  task: string;
  parentBundleId?: string;
  fileScope?: string[];
  symbolScope?: string[];
}

export interface ReceiptSubmitInput {
  bundleId: string | null;
  agent: string;
  summary: string;
}

export interface ServerScbsService {
  health(): Promise<{ status: 'ok'; service: string; version: string }>;
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
  submitReceipt(input: ReceiptSubmitInput): Promise<ReceiptRecord>;
  listReceipts(): Promise<ReceiptRecord[]>;
  showReceipt(id: string): Promise<ReceiptRecord>;
  validateReceipt(id: string): Promise<ReceiptRecord>;
  rejectReceipt(id: string): Promise<ReceiptRecord>;
}
