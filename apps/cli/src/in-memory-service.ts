import type {
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';
import { createApiCapabilities } from './service';
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

export interface SeedState {
  repos: RepoRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  views: ViewRecord[];
  bundles: BundleRecord[];
  receipts: ReceiptRecord[];
  bundleCache: Array<{ key: string; bundleId: string; freshness: FreshnessState }>;
}

const now = () => new Date().toISOString();
const defaultEndpoint = 'http://127.0.0.1:8791';

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const dedupe = (values: string[] | undefined): string[] => [...new Set(values ?? [])];

const hasOverlap = (left: string[] | undefined, right: string[] | undefined): boolean => {
  const rightSet = new Set(right ?? []);
  return dedupe(left).some((value) => rightSet.has(value));
};

const intersect = (left: string[] | undefined, right: string[] | undefined): string[] => {
  const rightSet = new Set(right ?? []);
  return dedupe(left).filter((value) => rightSet.has(value));
};

const rollupFreshness = (states: FreshnessState[]): FreshnessState => {
  if (states.includes('expired')) {
    return 'expired';
  }

  if (states.includes('stale')) {
    return 'stale';
  }

  if (states.includes('partial')) {
    return 'partial';
  }

  if (states.includes('unknown')) {
    return 'unknown';
  }

  return 'fresh';
};

export const createSeedState = (): SeedState => {
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
        fileScope: ['.'],
        symbolScope: [],
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

const createInMemoryApi = (): ApiSurface => ({
  kind: 'local-durable',
  baseUrl: defaultEndpoint,
  apiVersion: 'v1',
  mode: 'live',
  capabilities: createApiCapabilities(),
});

export class InMemoryScbsService implements ScbsService {
  private readonly state: SeedState;

  public constructor(seedState?: SeedState) {
    this.state = seedState ?? createSeedState();
  }

  public async init(configPath: string): Promise<InitReport> {
    return {
      mode: 'local-durable',
      configPath,
      statePath: '.scbs/state.json',
      created: false,
      configCreated: false,
      stateCreated: false,
    };
  }

  public async serve(): Promise<ServeReport> {
    return {
      service: 'scbs',
      status: 'listening',
      api: createInMemoryApi(),
      storage: {
        adapter: 'local-json',
        configPath: 'config/scbs.config.yaml',
        statePath: '.scbs/state.json',
        stateExists: false,
      },
    };
  }

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: '0.1.0' };
  }

  public async doctor(): Promise<DoctorReport> {
    return {
      status: 'ok',
      summary:
        'SCBS is running in in-memory bootstrap mode; no durable local state has been created.',
      api: createInMemoryApi(),
      storage: {
        adapter: 'local-json',
        configPath: 'config/scbs.config.yaml',
        statePath: '.scbs/state.json',
        stateExists: false,
      },
      checks: [
        {
          name: 'config',
          status: 'warn',
          detail: 'No durable config file is managed by the in-memory adapter.',
        },
        {
          name: 'storage',
          status: 'ok',
          detail: 'In-memory adapter active for CLI bootstrap mode.',
        },
        {
          name: 'api',
          status: 'ok',
          detail: `HTTP API surface is served at ${defaultEndpoint} with version v1.`,
        },
      ],
    };
  }

  public async migrate(): Promise<MigrationReport> {
    return {
      adapter: 'local-json',
      statePath: '.scbs/state.json',
      applied: [],
      pending: 0,
      baselineVersion: '0.1.0',
      stateCreated: false,
    };
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
    const repoIds = dedupe(input.repoIds ?? (input.repoId ? [input.repoId] : []));
    if (repoIds.length === 0) {
      throw new Error('At least one repository is required.');
    }
    for (const repoId of repoIds) {
      requireById(this.state.repos, repoId, 'Repository');
    }
    const parentBundle =
      input.parentBundleId === undefined
        ? undefined
        : requireById(this.state.bundles, input.parentBundleId, 'Parent bundle');
    const requestedFileScope = dedupe(input.fileScope);
    const requestedSymbolScope = dedupe(input.symbolScope);
    const parentFileScope = dedupe(parentBundle?.fileScope);
    const parentSymbolScope = dedupe(parentBundle?.symbolScope);
    const shouldInheritUnscopedParent =
      parentBundle !== undefined && parentFileScope.length === 0 && parentSymbolScope.length === 0;
    const shouldInheritScopedParent =
      parentBundle !== undefined &&
      !shouldInheritUnscopedParent &&
      (requestedFileScope.length === 0 && requestedSymbolScope.length === 0
        ? parentFileScope.length > 0 || parentSymbolScope.length > 0
        : hasOverlap(parentFileScope, requestedFileScope) ||
          hasOverlap(parentSymbolScope, requestedSymbolScope));
    const inheritsParentContext = shouldInheritUnscopedParent || shouldInheritScopedParent;
    const inheritedViewIds =
      inheritsParentContext && parentBundle
        ? parentBundle.viewIds.filter((viewId) =>
            repoIds.includes(requireById(this.state.views, viewId, 'View').repoId)
          )
        : [];
    const inheritedFileScope =
      shouldInheritUnscopedParent || requestedFileScope.length === 0
        ? parentFileScope
        : intersect(parentFileScope, requestedFileScope);
    const inheritedSymbolScope =
      shouldInheritUnscopedParent || requestedSymbolScope.length === 0
        ? parentSymbolScope
        : intersect(parentSymbolScope, requestedSymbolScope);
    const bundleFreshness = rollupFreshness([
      ...this.state.views
        .filter((view) => repoIds.includes(view.repoId))
        .map((view) => view.freshness),
      ...(inheritsParentContext ? [parentBundle?.freshness ?? 'fresh'] : []),
    ]);
    const bundle: BundleRecord = {
      id: `bundle_${slugify(input.task)}`,
      repoIds,
      task: input.task,
      viewIds: [
        ...new Set([
          ...inheritedViewIds,
          ...this.state.views
            .filter((view) => repoIds.includes(view.repoId))
            .map((view) => view.id),
        ]),
      ],
      freshness: bundleFreshness,
      parentBundleId: parentBundle?.id,
      fileScope: dedupe([...requestedFileScope, ...inheritedFileScope]),
      symbolScope: dedupe([...requestedSymbolScope, ...inheritedSymbolScope]),
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
