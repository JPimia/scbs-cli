import type {
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';
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

interface SeedState {
  repos: RepoRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  views: ViewRecord[];
  bundles: BundleRecord[];
  receipts: ReceiptRecord[];
  bundleCache: Array<{ key: string; bundleId: string; freshness: FreshnessState }>;
}

const now = () => new Date().toISOString();

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const createSeedState = (): SeedState => {
  const repoId = 'repo_local-default';
  const factId = 'fact_repo-layout';
  const claimId = 'claim_layout-backed';
  const viewId = 'view_system-overview';
  const bundleId = 'bundle_bootstrap';

  return {
    repos: [
      {
        id: repoId,
        name: 'local-default',
        path: '.',
        status: 'registered',
        lastScannedAt: null,
      },
    ],
    facts: [
      {
        id: factId,
        repoId,
        subject: 'Repository layout matches the SCBS MVP skeleton',
        freshness: 'fresh',
      },
    ],
    claims: [
      {
        id: claimId,
        repoId,
        statement: 'SCBS CLI should expose the full MVP command surface.',
        factIds: [factId],
        freshness: 'fresh',
      },
    ],
    views: [
      {
        id: viewId,
        repoId,
        name: 'system-overview',
        claimIds: [claimId],
        freshness: 'fresh',
      },
    ],
    bundles: [
      {
        id: bundleId,
        repoIds: [repoId],
        task: 'bootstrap repository context',
        viewIds: [viewId],
        freshness: 'fresh',
      },
    ],
    receipts: [
      {
        id: 'receipt_bootstrap',
        bundleId,
        agent: 'system',
        summary: 'Initial repository bootstrap recorded.',
        status: 'validated',
      },
    ],
    bundleCache: [
      {
        key: 'bundle:bootstrap',
        bundleId,
        freshness: 'fresh',
      },
    ],
  };
};

const requireById = <T extends { id: string }>(collection: T[], id: string, label: string): T => {
  const match = collection.find((entry) => entry.id === id);
  if (!match) {
    throw new Error(`${label} "${id}" was not found.`);
  }

  return match;
};

export class InMemoryScbsService implements ScbsService {
  private readonly state: SeedState;

  public constructor(seedState?: SeedState) {
    this.state = seedState ?? createSeedState();
  }

  public async init(configPath: string) {
    return { configPath, created: false };
  }

  public async serve() {
    return { endpoint: 'http://0.0.0.0:8791', mode: 'dry-run' as const };
  }

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: '0.1.0' };
  }

  public async doctor(): Promise<DoctorReport> {
    return {
      status: 'ok',
      checks: [
        {
          name: 'config',
          status: 'ok',
          detail: 'Default config path is readable.',
        },
        {
          name: 'storage',
          status: 'ok',
          detail: 'In-memory adapter active for CLI bootstrap mode.',
        },
      ],
    };
  }

  public async migrate() {
    return { applied: ['0001_init.sql'], pending: 9 };
  }

  public async registerRepo(input: RegisterRepoInput) {
    const id = `repo_${slugify(input.name || input.path)}`;
    const repo: RepoRecord = {
      id,
      name: input.name,
      path: input.path,
      status: 'registered',
      lastScannedAt: null,
    };

    this.state.repos.push(repo);
    return repo;
  }

  public async listRepos() {
    return [...this.state.repos];
  }

  public async showRepo(id: string) {
    return requireById(this.state.repos, id, 'Repository');
  }

  public async scanRepo(id: string) {
    const repo = requireById(this.state.repos, id, 'Repository');
    repo.status = 'scanned';
    repo.lastScannedAt = now();
    return repo;
  }

  public async reportRepoChanges(input: RepoChangesInput) {
    requireById(this.state.repos, input.id, 'Repository');
    return { repoId: input.id, files: input.files, impacts: input.files.length };
  }

  public async listFacts() {
    return [...this.state.facts];
  }

  public async listClaims() {
    return [...this.state.claims];
  }

  public async showClaim(id: string) {
    return requireById(this.state.claims, id, 'Claim');
  }

  public async listViews() {
    return [...this.state.views];
  }

  public async showView(id: string) {
    return requireById(this.state.views, id, 'View');
  }

  public async rebuildView(id: string) {
    const view = requireById(this.state.views, id, 'View');
    view.freshness = 'fresh';
    return view;
  }

  public async planBundle(input: BundlePlanInput) {
    requireById(this.state.repos, input.repoId, 'Repository');
    const bundle: BundleRecord = {
      id: `bundle_${slugify(input.task)}`,
      repoIds: [input.repoId],
      task: input.task,
      viewIds: this.state.views
        .filter((view) => view.repoId === input.repoId)
        .map((view) => view.id),
      freshness: 'fresh',
    };

    this.state.bundles.push(bundle);
    this.state.bundleCache.push({
      key: `bundle:${bundle.id}`,
      bundleId: bundle.id,
      freshness: bundle.freshness,
    });
    return bundle;
  }

  public async showBundle(id: string) {
    return requireById(this.state.bundles, id, 'Bundle');
  }

  public async getBundleFreshness(id: string) {
    const bundle = requireById(this.state.bundles, id, 'Bundle');
    return { bundleId: bundle.id, freshness: bundle.freshness };
  }

  public async expireBundle(id: string) {
    const bundle = requireById(this.state.bundles, id, 'Bundle');
    bundle.freshness = 'expired';
    return bundle;
  }

  public async listBundleCache() {
    return [...this.state.bundleCache];
  }

  public async clearBundleCache() {
    const cleared = this.state.bundleCache.length;
    this.state.bundleCache.length = 0;
    return { cleared };
  }

  public async getFreshnessImpacts(): Promise<FreshnessImpact[]> {
    return this.state.bundles.map((bundle) => ({
      artifactType: 'bundle',
      artifactId: bundle.id,
      state: bundle.freshness,
    }));
  }

  public async recomputeFreshness() {
    let updated = 0;
    for (const bundle of this.state.bundles) {
      if (bundle.freshness !== 'fresh') {
        bundle.freshness = 'fresh';
        updated += 1;
      }
    }

    return { updated };
  }

  public async getFreshnessStatus() {
    const staleArtifacts = this.state.bundles.filter(
      (bundle) => bundle.freshness !== 'fresh'
    ).length;
    return {
      overall: staleArtifacts > 0 ? ('partial' as const) : ('fresh' as const),
      staleArtifacts,
    };
  }

  public async submitReceipt(input: ReceiptSubmitInput) {
    const receipt: ReceiptRecord = {
      id: `receipt_${slugify(`${input.agent}-${input.summary}`)}`,
      bundleId: input.bundleId,
      agent: input.agent,
      summary: input.summary,
      status: 'pending',
    };

    this.state.receipts.push(receipt);
    return receipt;
  }

  public async listReceipts() {
    return [...this.state.receipts];
  }

  public async showReceipt(id: string) {
    return requireById(this.state.receipts, id, 'Receipt');
  }

  public async validateReceipt(id: string) {
    const receipt = requireById(this.state.receipts, id, 'Receipt');
    receipt.status = 'validated';
    return receipt;
  }

  public async rejectReceipt(id: string) {
    const receipt = requireById(this.state.receipts, id, 'Receipt');
    receipt.status = 'rejected';
    return receipt;
  }
}

export const createInMemoryScbsService = () => new InMemoryScbsService();
