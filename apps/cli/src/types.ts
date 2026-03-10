export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'partial' | 'unknown';

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
  status: 'ok';
  checks: Array<{
    name: string;
    status: 'ok';
    detail: string;
  }>;
}

export interface JsonEnvelope<T> {
  ok: true;
  command: string;
  data: T;
}
