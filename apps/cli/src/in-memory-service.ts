import { deriveViews } from '../../../packages/core/src/views/service';
import type {
  AgentReceipt,
  DependencyEdge,
  FileRecord,
  ClaimRecord as ProtocolClaimRecord,
  ViewRecord as ProtocolViewRecord,
  SourceAnchor,
  SymbolRecord,
} from '../../../packages/protocol/src/index';
import { validateReceipt as validateStoredReceipt } from '../../../packages/receipts/src/validation';
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
  FreshnessEventRecord,
  FreshnessImpact,
  FreshnessJobRecord,
  FreshnessState,
  FreshnessWorkerReport,
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
  freshnessEvents: FreshnessEventRecord[];
  freshnessJobs: FreshnessJobRecord[];
}

type GraphSeedState = SeedState & {
  files?: FileRecord[];
  symbols?: SymbolRecord[];
  edges?: DependencyEdge[];
};

const now = () => new Date().toISOString();
const defaultEndpoint = 'http://127.0.0.1:8791';

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const dedupe = (values: string[] | undefined): string[] => [...new Set(values ?? [])];

const fileMatchesChange = (filePath: string | undefined, changedFiles: string[]): boolean => {
  if (!filePath) {
    return false;
  }

  return changedFiles.some(
    (changed) =>
      filePath === changed ||
      filePath.startsWith(`${changed}/`) ||
      changed.startsWith(`${filePath}/`)
  );
};

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

type DurableReceiptRecord = ReceiptRecord &
  Partial<
    Pick<AgentReceipt, 'repoIds' | 'type' | 'fromRole' | 'payload' | 'createdAt' | 'updatedAt'>
  >;

type DurableClaimRecord = ClaimRecord &
  Partial<
    Pick<
      ProtocolClaimRecord,
      | 'text'
      | 'type'
      | 'confidence'
      | 'trustTier'
      | 'anchors'
      | 'invalidationKeys'
      | 'metadata'
      | 'createdAt'
      | 'updatedAt'
    >
  >;

type DurableViewRecord = ViewRecord &
  Partial<
    Pick<
      ProtocolViewRecord,
      | 'type'
      | 'key'
      | 'title'
      | 'summary'
      | 'fileScope'
      | 'symbolScope'
      | 'metadata'
      | 'createdAt'
      | 'updatedAt'
    >
  >;

const toProtocolReceiptStatus = (status: ReceiptRecord['status']): AgentReceipt['status'] =>
  status === 'pending' ? 'provisional' : status;

const toDurableReceiptStatus = (status: AgentReceipt['status']): ReceiptRecord['status'] =>
  status === 'provisional' ? 'pending' : status;

const buildDefaultAnchor = (repoId: string, filePath: string): SourceAnchor => ({
  repoId,
  filePath,
  fileHash: `in-memory:${repoId}:${filePath}`,
});

const toProtocolClaim = (claim: DurableClaimRecord): ProtocolClaimRecord => {
  const metadata =
    claim.metadata && typeof claim.metadata === 'object'
      ? { ...claim.metadata }
      : ({} as Record<string, unknown>);
  const filePath =
    typeof metadata.filePath === 'string' && metadata.filePath.length > 0 ? metadata.filePath : '.';
  const anchors =
    Array.isArray(claim.anchors) && claim.anchors.length > 0
      ? claim.anchors
      : [buildDefaultAnchor(claim.repoId, filePath)];
  const invalidationKeys =
    Array.isArray(claim.invalidationKeys) && claim.invalidationKeys.length > 0
      ? claim.invalidationKeys
      : [filePath];

  return {
    id: claim.id,
    repoId: claim.repoId,
    text: claim.text ?? claim.statement,
    type: claim.type ?? 'provisional',
    confidence: claim.confidence ?? 0.6,
    trustTier: claim.trustTier ?? 'provisional',
    factIds: claim.factIds,
    anchors,
    freshness: claim.freshness,
    invalidationKeys,
    metadata: {
      ...metadata,
      filePath,
    },
    createdAt: claim.createdAt ?? now(),
    updatedAt: claim.updatedAt ?? now(),
  };
};

const toDurableClaim = (claim: ProtocolClaimRecord): DurableClaimRecord =>
  ({
    id: claim.id,
    repoId: claim.repoId,
    statement: claim.text,
    factIds: claim.factIds,
    freshness: claim.freshness,
    text: claim.text,
    type: claim.type,
    confidence: claim.confidence,
    trustTier: claim.trustTier,
    anchors: claim.anchors,
    invalidationKeys: claim.invalidationKeys,
    metadata: claim.metadata,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  }) as DurableClaimRecord;

const toDurableView = (view: ProtocolViewRecord): DurableViewRecord =>
  ({
    id: view.id,
    repoId: view.repoId,
    name: view.title,
    claimIds: view.claimIds,
    freshness: view.freshness,
    type: view.type,
    key: view.key,
    title: view.title,
    summary: view.summary,
    fileScope: view.fileScope,
    symbolScope: view.symbolScope,
    metadata: view.metadata,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }) as DurableViewRecord;

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
        requestId: `req_${bundleId}`,
        repoIds: [repoId],
        summary: 'Bundle for bootstrap repository context',
        selectedViewIds: [viewId],
        selectedClaimIds: [claimId],
        commands: [],
        proofHandles: [],
        freshness: 'fresh',
        fileScope: ['.'],
        symbolScope: [],
        metadata: {
          task: 'bootstrap repository context',
          taskTitle: 'bootstrap repository context',
        },
        createdAt: now(),
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
    freshnessEvents: [],
    freshnessJobs: [],
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
  kind: 'standalone',
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
      mode: 'local-json',
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
    const createdAt = now();
    const eventId = `evt_${slugify(`${input.id}-${createdAt}`)}`;
    const jobId = `job_${slugify(`${input.id}-${createdAt}`)}`;
    this.state.freshnessEvents.push({
      id: eventId,
      repoId: input.id,
      files: [...input.files],
      createdAt,
    });
    this.state.freshnessJobs.push({
      id: jobId,
      repoId: input.id,
      eventId,
      files: [...input.files],
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    });

    let impacts = 0;
    const impactedClaimIds = new Set<string>();
    for (const claim of this.state.claims) {
      const durableClaim = claim as ClaimRecord & Record<string, unknown>;
      const invalidationKeys = Array.isArray(durableClaim.invalidationKeys)
        ? durableClaim.invalidationKeys.filter(
            (value): value is string => typeof value === 'string'
          )
        : [];
      const metadata = durableClaim.metadata as Record<string, unknown> | undefined;
      const filePath = typeof metadata?.filePath === 'string' ? metadata.filePath : undefined;
      const claimImpacted =
        claim.repoId === input.id &&
        (fileMatchesChange(filePath, input.files) ||
          invalidationKeys.some((key) => fileMatchesChange(key, input.files)));
      if (!claimImpacted) {
        continue;
      }

      impactedClaimIds.add(claim.id);
      if (claim.freshness === 'fresh') {
        claim.freshness = 'stale';
      }
      impacts += 1;
    }

    const impactedViewIds = new Set<string>();
    for (const view of this.state.views) {
      const durableView = view as ViewRecord & Record<string, unknown>;
      const fileScope = Array.isArray(durableView.fileScope)
        ? durableView.fileScope.filter((value): value is string => typeof value === 'string')
        : [];
      const viewImpacted =
        view.repoId === input.id &&
        (view.claimIds.some((claimId) => impactedClaimIds.has(claimId)) ||
          fileScope.some((filePath) => fileMatchesChange(filePath, input.files)));
      if (!viewImpacted) {
        continue;
      }

      impactedViewIds.add(view.id);
      if (view.freshness === 'fresh') {
        view.freshness = 'stale';
      }
      impacts += 1;
    }

    for (const bundle of this.state.bundles) {
      const fileScope = Array.isArray(bundle.fileScope) ? bundle.fileScope : [];
      const bundleImpacted =
        bundle.repoIds.includes(input.id) &&
        (bundle.selectedViewIds.some((viewId) => impactedViewIds.has(viewId)) ||
          fileScope.some((filePath) => fileMatchesChange(filePath, input.files)));
      if (!bundleImpacted) {
        continue;
      }

      if (bundle.freshness !== 'expired') {
        bundle.freshness = 'expired';
      }
      impacts += 1;
    }

    return { repoId: input.id, files: input.files, impacts };
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
    const taskTitle = input.taskTitle ?? input.task;
    const requestId = input.id ?? `req_${slugify(taskTitle)}`;
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
        ? parentBundle.selectedViewIds.filter((viewId) =>
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
      id: `bundle_${slugify(taskTitle)}`,
      requestId,
      repoIds,
      summary: `Bundle for ${taskTitle} across ${repoIds.length} views`,
      selectedViewIds: [
        ...new Set([
          ...inheritedViewIds,
          ...this.state.views
            .filter((view) => repoIds.includes(view.repoId))
            .map((view) => view.id),
        ]),
      ],
      selectedClaimIds: [
        ...new Set(
          this.state.views
            .filter((view) => repoIds.includes(view.repoId))
            .flatMap((view) => view.claimIds)
        ),
      ],
      freshness: bundleFreshness,
      fileScope: dedupe([...requestedFileScope, ...inheritedFileScope]),
      symbolScope: dedupe([...requestedSymbolScope, ...inheritedSymbolScope]),
      commands: [],
      proofHandles: [],
      cacheKey: `bundle:${slugify(taskTitle)}`,
      metadata: {
        task: input.task,
        taskTitle,
        taskDescription: input.taskDescription,
        role: input.role ?? 'builder',
        parentBundleId: parentBundle?.id,
        externalRef: input.externalRef,
      },
      createdAt: now(),
      expiresAt: bundleFreshness === 'fresh' ? undefined : now(),
    };

    this.state.bundles.push(bundle);
    this.state.bundleCache.push({
      key: bundle.cacheKey ?? `bundle:${bundle.id}`,
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
    return [
      ...this.state.claims
        .filter((claim) => claim.freshness !== 'fresh')
        .map((claim) => ({
          artifactType: 'claim' as const,
          artifactId: claim.id,
          state: claim.freshness,
        })),
      ...this.state.views
        .filter((view) => view.freshness !== 'fresh')
        .map((view) => ({
          artifactType: 'view' as const,
          artifactId: view.id,
          state: view.freshness,
        })),
      ...this.state.bundles
        .filter((bundle) => bundle.freshness !== 'fresh')
        .map((bundle) => ({
          artifactType: 'bundle' as const,
          artifactId: bundle.id,
          state: bundle.freshness,
        })),
    ];
  }

  public async recomputeFreshness() {
    const report = await this.runFreshnessWorker();
    return { updated: report.processed };
  }

  public async runFreshnessWorker(options?: { limit?: number }): Promise<FreshnessWorkerReport> {
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const pendingJobs = this.state.freshnessJobs.filter((job) => job.status === 'pending');
    const selectedJobs = pendingJobs.slice(0, Math.max(0, limit));

    for (const job of selectedJobs) {
      for (const claim of this.state.claims) {
        if (claim.repoId === job.repoId && claim.freshness !== 'fresh') {
          claim.freshness = 'fresh';
        }
      }

      for (const view of this.state.views) {
        if (view.repoId === job.repoId && view.freshness !== 'fresh') {
          view.freshness = 'fresh';
        }
      }

      for (const bundle of this.state.bundles) {
        if (bundle.repoIds.includes(job.repoId) && bundle.freshness !== 'fresh') {
          bundle.freshness = 'fresh';
        }
      }

      job.status = 'completed';
      job.updatedAt = now();
    }

    return {
      processed: selectedJobs.length,
      remaining: this.state.freshnessJobs.filter((job) => job.status === 'pending').length,
      jobIds: selectedJobs.map((job) => job.id),
    };
  }

  public async getFreshnessStatus() {
    const staleArtifacts =
      this.state.claims.filter((claim) => claim.freshness !== 'fresh').length +
      this.state.views.filter((view) => view.freshness !== 'fresh').length +
      this.state.bundles.filter((bundle) => bundle.freshness !== 'fresh').length;
    return {
      overall: staleArtifacts > 0 ? ('partial' as const) : ('fresh' as const),
      staleArtifacts,
    };
  }

  public async submitReceipt(input: ReceiptSubmitInput) {
    const createdAt = now();
    const bundle =
      input.bundleId === null
        ? undefined
        : requireById(this.state.bundles, input.bundleId, 'Bundle');
    const receipt: DurableReceiptRecord = {
      id: `receipt_${slugify(`${input.agent}-${input.summary}`)}`,
      bundleId: input.bundleId,
      agent: input.agent,
      summary: input.summary,
      status: 'pending',
      repoIds: bundle?.repoIds ?? [],
      type: 'workflow_note',
      fromRole: 'agent',
      payload: {},
      createdAt,
      updatedAt: createdAt,
    };

    this.state.receipts.push(receipt as ReceiptRecord);
    return receipt as ReceiptRecord;
  }

  public async listReceipts() {
    return [...this.state.receipts];
  }

  public async showReceipt(id: string) {
    return requireById(this.state.receipts, id, 'Receipt');
  }

  public async validateReceipt(id: string) {
    const receipt = requireById(this.state.receipts, id, 'Receipt') as DurableReceiptRecord;
    const bundle =
      receipt.bundleId === null
        ? undefined
        : requireById(this.state.bundles, receipt.bundleId, 'Bundle');
    const decision = validateStoredReceipt(
      this.toProtocolReceipt(receipt, bundle),
      this.buildValidationAnchors(receipt, bundle)
    );
    const validatedReceipt = this.toDurableReceipt(decision.receipt, receipt);

    this.state.receipts = this.state.receipts.map((entry) =>
      entry.id === id ? (validatedReceipt as ReceiptRecord) : entry
    );

    if (decision.promotedClaim) {
      const promotedClaim = toDurableClaim(decision.promotedClaim);
      this.state.claims = this.state.claims
        .filter((entry) => entry.id !== promotedClaim.id)
        .concat(promotedClaim as ClaimRecord);
      this.rebuildViewsForRepo(promotedClaim.repoId);
    }

    return validatedReceipt as ReceiptRecord;
  }

  public async rejectReceipt(id: string) {
    const receipt = requireById(this.state.receipts, id, 'Receipt');
    receipt.status = 'rejected';
    return receipt;
  }

  private toProtocolReceipt(receipt: DurableReceiptRecord, bundle?: BundleRecord): AgentReceipt {
    const createdAt = receipt.createdAt ?? now();
    const updatedAt = receipt.updatedAt ?? createdAt;

    return {
      id: receipt.id,
      bundleId: receipt.bundleId ?? undefined,
      repoIds: Array.isArray(receipt.repoIds) ? receipt.repoIds : (bundle?.repoIds ?? []),
      type: receipt.type ?? 'workflow_note',
      fromRole: receipt.fromRole ?? 'agent',
      summary: receipt.summary,
      payload: receipt.payload && typeof receipt.payload === 'object' ? { ...receipt.payload } : {},
      status: toProtocolReceiptStatus(receipt.status),
      createdAt,
      updatedAt,
    };
  }

  private toDurableReceipt(
    receipt: AgentReceipt,
    previous: DurableReceiptRecord
  ): DurableReceiptRecord {
    return {
      id: receipt.id,
      bundleId: receipt.bundleId ?? previous.bundleId ?? null,
      agent: previous.agent,
      summary: receipt.summary,
      status: toDurableReceiptStatus(receipt.status),
      repoIds: receipt.repoIds,
      type: receipt.type,
      fromRole: receipt.fromRole,
      payload: receipt.payload,
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
    };
  }

  private buildValidationAnchors(
    receipt: DurableReceiptRecord,
    bundle?: BundleRecord
  ): SourceAnchor[] {
    const existingValidation = receipt.payload?.validation as
      | { anchors?: SourceAnchor[] }
      | undefined;
    if (
      existingValidation &&
      typeof existingValidation === 'object' &&
      Array.isArray(existingValidation.anchors) &&
      existingValidation.anchors.length > 0
    ) {
      return existingValidation.anchors as SourceAnchor[];
    }

    const repoIds = Array.isArray(receipt.repoIds)
      ? receipt.repoIds
      : (bundle?.repoIds ?? []).length > 0
        ? (bundle?.repoIds ?? [])
        : [this.state.repos[0]?.id ?? 'repo_local-default'];
    const filePaths = dedupe([
      ...(bundle?.fileScope ?? []),
      ...this.state.views
        .filter((view) => repoIds.includes(view.repoId))
        .flatMap((view) =>
          'fileScope' in view && Array.isArray(view.fileScope) ? view.fileScope : []
        ),
    ]);
    const defaultFilePath = filePaths[0] ?? '.';

    return repoIds.map((repoId) => buildDefaultAnchor(repoId, defaultFilePath));
  }

  private rebuildViewsForRepo(repoId: string): void {
    const graphState = this.state as GraphSeedState;
    const protocolClaims = this.state.claims.map((claim) =>
      toProtocolClaim(claim as DurableClaimRecord)
    );
    const files = graphState.files ?? [];
    const symbols = graphState.symbols ?? [];
    const edges = graphState.edges ?? [];
    const hasGraphInputs = files.length > 0 || symbols.length > 0 || edges.length > 0;
    const repoViews = (
      hasGraphInputs
        ? deriveViews(repoId, files, symbols, protocolClaims, edges)
        : deriveViews(repoId, protocolClaims)
    ).map((view) => toDurableView(view));
    this.state.views = this.state.views
      .filter((view) => view.repoId !== repoId)
      .concat(repoViews as ViewRecord[]);
  }
}

export const createInMemoryScbsService = () => new InMemoryScbsService();
