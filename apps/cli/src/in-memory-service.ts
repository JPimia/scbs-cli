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
import { adjustClaimFromValidatedReceipt } from '../../../packages/receipts/src/validation';
import type {
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';
import { createApiCapabilities } from './service';
import type {
  AccessScope,
  AccessTokenCreateInput,
  AccessTokenGrant,
  AccessTokenRecord,
  ApiSurface,
  AuditRecord,
  BundleListEntry,
  BundleRecord,
  BundleReviewRecord,
  ClaimRecord,
  DoctorReport,
  FactRecord,
  FreshnessEventRecord,
  FreshnessImpact,
  FreshnessJobKind,
  FreshnessJobRecord,
  FreshnessState,
  FreshnessWorkerReport,
  InitReport,
  JobListReport,
  MigrationReport,
  OutboxEventRecord,
  ReceiptRecord,
  ReceiptReviewRecord,
  RepoRecord,
  ServeReport,
  ViewRecord,
  WebhookCreateInput,
  WebhookRecord,
  WorkerLoopReport,
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
  receiptReviews: ReceiptReviewRecord[];
  outboxEvents: OutboxEventRecord[];
  webhooks: WebhookRecord[];
  accessTokens: DurableAccessTokenRecord[];
  auditRecords: AuditRecord[];
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

const hasScopes = (granted: AccessScope[], required: AccessScope[]): boolean =>
  required.every((scope) => granted.includes(scope));

const asLifecycleTopics = (values: string[] | undefined): WebhookRecord['events'] =>
  (values ?? []).filter((value): value is WebhookRecord['events'][number] =>
    [
      'repo.registered',
      'repo.scanned',
      'repo.changed',
      'bundle.planned',
      'bundle.expired',
      'receipt.submitted',
      'receipt.validated',
      'receipt.rejected',
    ].includes(value)
  );

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

type DurableAccessTokenRecord = AccessTokenRecord & {
  token: string;
};

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
    receiptReviews: [
      {
        id: 'receipt-review_bootstrap',
        receiptId: 'receipt_bootstrap',
        bundleId,
        action: 'validated',
        actor: 'system',
        note: 'Bootstrap receipt was accepted into the initial state.',
        createdAt: now(),
      },
    ],
    outboxEvents: [],
    webhooks: [],
    accessTokens: [],
    auditRecords: [],
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

function createDiagnostics(state: SeedState): DoctorReport['diagnostics'] {
  const staleBundles = state.bundles.filter((bundle) => bundle.freshness !== 'fresh');
  const staleFacts = state.facts.filter((fact) => fact.freshness !== 'fresh').length;
  const staleClaims = state.claims.filter((claim) => claim.freshness !== 'fresh').length;
  const staleViews = state.views.filter((view) => view.freshness !== 'fresh').length;
  const pendingJobs = state.freshnessJobs.filter((job) => job.status === 'pending');
  const completedJobs = state.freshnessJobs.filter((job) => job.status === 'completed');
  const pendingReceipts = state.receipts.filter((receipt) => receipt.status === 'pending');
  const validatedReceipts = state.receipts.filter((receipt) => receipt.status === 'validated');
  const rejectedReceipts = state.receipts.filter((receipt) => receipt.status === 'rejected');
  const staleArtifacts = staleFacts + staleClaims + staleViews + staleBundles.length;

  return {
    artifacts: {
      repos: state.repos.length,
      facts: state.facts.length,
      claims: state.claims.length,
      views: state.views.length,
      bundles: state.bundles.length,
      cachedBundles: state.bundleCache.length,
      receipts: state.receipts.length,
    },
    freshness: {
      overall:
        staleArtifacts === 0
          ? 'fresh'
          : staleBundles.some((bundle) => bundle.freshness === 'expired')
            ? 'expired'
            : 'stale',
      staleArtifacts,
      pendingJobs: pendingJobs.length,
      completedJobs: completedJobs.length,
      recentEvents: state.freshnessEvents.length,
    },
    receipts: {
      pending: pendingReceipts.length,
      validated: validatedReceipts.length,
      rejected: rejectedReceipts.length,
    },
    hotspots: {
      staleBundleIds: staleBundles.slice(0, 5).map((bundle) => bundle.id),
      pendingReceiptIds: pendingReceipts.slice(0, 5).map((receipt) => receipt.id),
      pendingJobIds: pendingJobs.slice(0, 5).map((job) => job.id),
    },
  };
}

function createJobSummary(state: SeedState): JobListReport['summary'] {
  const summary: JobListReport['summary'] = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const job of state.freshnessJobs) {
    if (job.status === 'pending') {
      summary.pending += 1;
    } else if (job.status === 'running') {
      summary.running += 1;
    } else if (job.status === 'completed') {
      summary.completed += 1;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}

function createJobReport(state: SeedState): JobListReport {
  const pendingReceipts = state.receipts
    .filter((receipt) => receipt.status === 'pending')
    .map((receipt) => receipt.id);

  return {
    summary: createJobSummary(state),
    jobs: [...state.freshnessJobs].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt)
    ),
    recentEvents: [...state.freshnessEvents]
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : right.createdAt.localeCompare(left.createdAt)
      )
      .slice(0, 20),
    pendingReceiptIds: pendingReceipts.slice(0, 20),
  };
}

export class InMemoryScbsService implements ScbsService {
  private readonly state: SeedState;

  public constructor(seedState?: SeedState) {
    if (!seedState) {
      this.state = createSeedState();
      return;
    }

    seedState.repos ??= [];
    seedState.facts ??= [];
    seedState.claims ??= [];
    seedState.views ??= [];
    seedState.bundles ??= [];
    seedState.receipts ??= [];
    seedState.bundleCache ??= [];
    seedState.freshnessEvents ??= [];
    seedState.freshnessJobs ??= [];
    seedState.receiptReviews ??= [];
    seedState.outboxEvents ??= [];
    seedState.webhooks ??= [];
    seedState.accessTokens ??= [];
    seedState.auditRecords ??= [];
    this.state = seedState;
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
    const diagnostics = createDiagnostics(this.state);
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
      diagnostics,
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

  public async listJobs(): Promise<JobListReport> {
    return createJobReport(this.state);
  }

  public async showJob(id: string): Promise<FreshnessJobRecord> {
    return requireById(this.state.freshnessJobs, id, 'Job');
  }

  public async retryJob(id: string): Promise<FreshnessJobRecord> {
    const job = requireById(this.state.freshnessJobs, id, 'Job');
    if (job.status === 'running') {
      throw new Error(`Job "${id}" is currently running.`);
    }
    if (job.status === 'completed') {
      return job;
    }

    const timestamp = now();
    job.status = 'pending';
    job.availableAt = timestamp;
    job.updatedAt = timestamp;
    job.startedAt = undefined;
    job.completedAt = undefined;
    job.lastError = undefined;
    return job;
  }

  public async listBundles(): Promise<BundleListEntry[]> {
    return [...this.state.bundles]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((bundle) => {
        const receipts = this.state.receipts.filter((receipt) => receipt.bundleId === bundle.id);
        return {
          id: bundle.id,
          taskTitle:
            typeof bundle.metadata?.taskTitle === 'string'
              ? bundle.metadata.taskTitle
              : bundle.summary,
          repoIds: bundle.repoIds,
          freshness: bundle.freshness,
          receiptCount: receipts.length,
          pendingReceiptCount: receipts.filter((receipt) => receipt.status === 'pending').length,
          hasPlannerDiagnostics:
            Boolean(bundle.metadata) &&
            typeof bundle.metadata === 'object' &&
            'plannerDiagnostics' in bundle.metadata,
          createdAt: bundle.createdAt,
        };
      });
  }

  public async reviewBundle(id: string): Promise<BundleReviewRecord> {
    const bundle = requireById(this.state.bundles, id, 'Bundle');
    const receipts = this.state.receipts.filter((receipt) => receipt.bundleId === bundle.id);
    return {
      bundle,
      receipts,
      receiptHistory: this.state.receiptReviews.filter((entry) => entry.bundleId === bundle.id),
      plannerDiagnostics:
        bundle.metadata &&
        typeof bundle.metadata === 'object' &&
        typeof bundle.metadata.plannerDiagnostics === 'object'
          ? (bundle.metadata.plannerDiagnostics as Record<string, unknown>)
          : undefined,
    };
  }

  public async listReceiptHistory(id?: string): Promise<ReceiptReviewRecord[]> {
    return this.state.receiptReviews.filter((entry) => (id ? entry.receiptId === id : true));
  }

  public async listOutboxEvents(): Promise<OutboxEventRecord[]> {
    return [...this.state.outboxEvents].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  public async showOutboxEvent(id: string): Promise<OutboxEventRecord> {
    return requireById(this.state.outboxEvents, id, 'Outbox event');
  }

  public async listWebhooks(): Promise<WebhookRecord[]> {
    return [...this.state.webhooks];
  }

  public async createWebhook(input: WebhookCreateInput): Promise<WebhookRecord> {
    const createdAt = now();
    const webhook: WebhookRecord = {
      id: `webhook_${slugify(`${input.label}-${createdAt}`)}`,
      label: input.label,
      url: input.url,
      events: asLifecycleTopics(dedupe(input.events)),
      active: true,
      createdAt,
      updatedAt: createdAt,
    };
    this.state.webhooks.push(webhook);
    return webhook;
  }

  public async listAccessTokens(): Promise<AccessTokenRecord[]> {
    return this.state.accessTokens.map(({ token: _token, ...record }) => record);
  }

  public async createAccessToken(input: AccessTokenCreateInput): Promise<AccessTokenGrant> {
    const createdAt = now();
    const record: DurableAccessTokenRecord = {
      id: `token_${slugify(`${input.label}-${createdAt}`)}`,
      label: input.label,
      scopes: dedupe(input.scopes) as AccessScope[],
      createdAt,
      token: `scbs_${slugify(input.label)}_${createdAt.replaceAll(/[^0-9]/g, '')}`,
    };
    this.state.accessTokens.push(record);
    return {
      token: record.token,
      record: {
        id: record.id,
        label: record.label,
        scopes: record.scopes,
        createdAt: record.createdAt,
      },
    };
  }

  public async authorizeAccessToken(
    token: string,
    scopes: AccessScope[]
  ): Promise<AccessTokenRecord | null> {
    if (this.state.accessTokens.length === 0) {
      return {
        id: 'anonymous-open-access',
        label: 'anonymous-open-access',
        scopes,
        createdAt: now(),
      };
    }

    const record = this.state.accessTokens.find((entry) => entry.token === token);
    if (!record || !hasScopes(record.scopes, scopes)) {
      return null;
    }

    record.lastUsedAt = now();
    return {
      id: record.id,
      label: record.label,
      scopes: record.scopes,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
    };
  }

  public async listAuditRecords(): Promise<AuditRecord[]> {
    return [...this.state.auditRecords].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  public async recordAudit(input: {
    actor: string;
    action: string;
    scope: AuditRecord['scope'];
    resourceType: string;
    resourceId?: string;
    outcome: AuditRecord['outcome'];
    metadata?: Record<string, unknown>;
  }): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: `audit_${slugify(`${input.scope}-${input.action}-${now()}`)}`,
      actor: input.actor,
      action: input.action,
      scope: input.scope,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome,
      metadata: input.metadata,
      createdAt: now(),
    };
    this.state.auditRecords.push(record);
    return record;
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
    this.emitOutboxEvent({
      topic: 'repo.registered',
      aggregateType: 'repo',
      aggregateId: repo.id,
      repoId: repo.id,
      payload: { name: repo.name, path: repo.path },
    });
    return repo;
  }

  public async listRepos() {
    return [...this.state.repos];
  }

  public async showRepo(id: string) {
    return requireById(this.state.repos, id, 'Repository');
  }

  public async scanRepo(id: string, options?: { queue?: boolean }) {
    const repo = requireById(this.state.repos, id, 'Repository');
    const createdAt = now();
    const job = this.enqueueJob({
      kind: 'repo_scan',
      repoId: repo.id,
      targetId: repo.id,
      files: [],
      createdAt,
    });
    if (!(options?.queue ?? false)) {
      await this.runFreshnessWorker({ limit: 1, kinds: ['repo_scan'], jobIds: [job.id] });
    }
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
      kind: 'freshness_recompute',
      repoId: input.id,
      eventId,
      targetId: input.id,
      files: [...input.files],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      availableAt: createdAt,
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

    this.emitOutboxEvent({
      topic: 'repo.changed',
      aggregateType: 'repo',
      aggregateId: input.id,
      repoId: input.id,
      payload: {
        files: input.files,
        impacts,
        eventId,
      },
    });

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
    this.emitOutboxEvent({
      topic: 'bundle.planned',
      aggregateType: 'bundle',
      aggregateId: bundle.id,
      repoId: bundle.repoIds[0],
      payload: {
        taskTitle,
        repoIds: bundle.repoIds,
        freshness: bundle.freshness,
      },
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
    this.emitOutboxEvent({
      topic: 'bundle.expired',
      aggregateType: 'bundle',
      aggregateId: bundle.id,
      repoId: bundle.repoIds[0],
      payload: {
        freshness: bundle.freshness,
      },
    });
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

  public async runFreshnessWorker(options?: {
    limit?: number;
    kinds?: FreshnessJobKind[];
    jobIds?: string[];
  }): Promise<FreshnessWorkerReport> {
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const kinds = options?.kinds;
    const explicitJobIds = options?.jobIds;
    const startedAt = now();
    const pendingJobs = this.state.freshnessJobs.filter(
      (job) =>
        job.status === 'pending' &&
        job.availableAt <= startedAt &&
        (kinds ? kinds.includes(job.kind) : true) &&
        (explicitJobIds ? explicitJobIds.includes(job.id) : true)
    );
    const selectedJobs = pendingJobs.slice(0, Math.max(0, limit));
    const failedJobIds: string[] = [];

    for (const job of selectedJobs) {
      if (!(await this.processJob(job))) {
        failedJobIds.push(job.id);
      }
    }

    return {
      processed: selectedJobs.length,
      remaining: this.state.freshnessJobs.filter((job) => job.status === 'pending').length,
      jobIds: selectedJobs.map((job) => job.id),
      failedJobIds,
    };
  }

  public async runWorkerLoop(options?: {
    pollIntervalMs?: number;
    maxIdleCycles?: number;
    limit?: number;
    kinds?: FreshnessJobKind[];
  }): Promise<WorkerLoopReport> {
    const pollIntervalMs = Math.max(10, options?.pollIntervalMs ?? 1000);
    const maxIdleCycles = options?.maxIdleCycles;
    let cycles = 0;
    let idleCycles = 0;
    let processed = 0;
    let failed = 0;

    while (maxIdleCycles === undefined || idleCycles < maxIdleCycles) {
      const result = await this.runFreshnessWorker({
        limit: options?.limit,
        kinds: options?.kinds,
      });
      cycles += 1;
      processed += result.processed;
      failed += result.failedJobIds.length;

      if (result.processed === 0) {
        idleCycles += 1;
      } else {
        idleCycles = 0;
      }

      if (maxIdleCycles !== undefined && idleCycles >= maxIdleCycles) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      cycles,
      processed,
      idleCycles,
      remaining: this.state.freshnessJobs.filter((job) => job.status === 'pending').length,
      failed,
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
    this.recordReceiptReview({
      receiptId: receipt.id,
      bundleId: receipt.bundleId,
      action: 'submitted',
      actor: input.agent,
      note: input.summary,
    });
    this.emitOutboxEvent({
      topic: 'receipt.submitted',
      aggregateType: 'receipt',
      aggregateId: receipt.id,
      repoId: bundle?.repoIds[0],
      payload: {
        bundleId: receipt.bundleId,
        agent: receipt.agent,
        status: receipt.status,
      },
    });
    return receipt as ReceiptRecord;
  }

  public async listReceipts() {
    return [...this.state.receipts];
  }

  public async showReceipt(id: string) {
    return requireById(this.state.receipts, id, 'Receipt');
  }

  public async validateReceipt(id: string, options?: { queue?: boolean }) {
    const receipt = requireById(this.state.receipts, id, 'Receipt') as DurableReceiptRecord;
    const createdAt = now();
    const receiptRepoIds = Array.isArray(receipt.repoIds) ? receipt.repoIds : [];
    const job = this.enqueueJob({
      kind: 'receipt_validation',
      repoId: receiptRepoIds[0] ?? this.state.repos[0]?.id ?? 'repo_local-default',
      targetId: receipt.id,
      files: [],
      createdAt,
    });
    this.recordReceiptReview({
      receiptId: receipt.id,
      bundleId: receipt.bundleId,
      action: 'queued_for_validation',
      actor: 'system',
      note: `Queued validation job ${job.id}.`,
    });
    if (options?.queue ?? false) {
      return receipt as ReceiptRecord;
    }
    await this.runFreshnessWorker({ limit: 1, kinds: ['receipt_validation'], jobIds: [job.id] });
    return requireById(this.state.receipts, id, 'Receipt');
  }

  private validateReceiptNow(id: string): ReceiptRecord {
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
    this.recordReceiptReview({
      receiptId: id,
      bundleId: validatedReceipt.bundleId,
      action: 'validated',
      actor: 'system',
      note: validatedReceipt.summary,
    });
    this.emitOutboxEvent({
      topic: 'receipt.validated',
      aggregateType: 'receipt',
      aggregateId: validatedReceipt.id,
      repoId: validatedReceipt.repoIds?.[0],
      payload: {
        bundleId: validatedReceipt.bundleId,
        status: validatedReceipt.status,
      },
    });

    if (decision.promotedClaims.length > 0) {
      const promotedClaims = decision.promotedClaims.map((claim) => toDurableClaim(claim));
      const promotedIds = new Set(promotedClaims.map((claim) => claim.id));
      this.state.claims = this.state.claims
        .map((entry) => {
          const protocolClaim = toProtocolClaim(entry as DurableClaimRecord);
          const adjustment = adjustClaimFromValidatedReceipt(protocolClaim, decision.receipt);
          if (!adjustment || promotedIds.has(entry.id)) {
            return entry;
          }
          return {
            ...entry,
            confidence: adjustment.confidence,
            trustTier: adjustment.trustTier,
            freshness: adjustment.freshness,
            metadata: adjustment.metadata,
            updatedAt: decision.receipt.updatedAt,
          } as ClaimRecord;
        })
        .filter((entry) => !promotedIds.has(entry.id))
        .concat(promotedClaims as ClaimRecord[]);
      const affectedRepoIds = [...new Set(promotedClaims.map((claim) => claim.repoId))];
      for (const repoId of affectedRepoIds) {
        this.rebuildViewsForRepo(repoId);
      }
    }

    return validatedReceipt as ReceiptRecord;
  }

  public async rejectReceipt(id: string) {
    const receipt = requireById(this.state.receipts, id, 'Receipt');
    receipt.status = 'rejected';
    this.recordReceiptReview({
      receiptId: receipt.id,
      bundleId: receipt.bundleId,
      action: 'rejected',
      actor: 'system',
      note: receipt.summary,
    });
    this.emitOutboxEvent({
      topic: 'receipt.rejected',
      aggregateType: 'receipt',
      aggregateId: receipt.id,
      repoId: undefined,
      payload: {
        bundleId: receipt.bundleId,
        status: receipt.status,
      },
    });
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

  private enqueueJob(input: {
    kind: FreshnessJobRecord['kind'];
    repoId: string;
    targetId: string;
    files: string[];
    createdAt: string;
    eventId?: string;
  }): FreshnessJobRecord {
    const job: FreshnessJobRecord = {
      id: `job_${slugify(`${input.kind}-${input.targetId}-${input.createdAt}`)}`,
      kind: input.kind,
      repoId: input.repoId,
      eventId: input.eventId,
      targetId: input.targetId,
      files: [...input.files],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      availableAt: input.createdAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.state.freshnessJobs.push(job);
    return job;
  }

  private recordReceiptReview(input: {
    receiptId: string;
    bundleId: string | null;
    action: ReceiptReviewRecord['action'];
    actor: string;
    note: string;
  }): void {
    this.state.receiptReviews.push({
      id: `receipt-review_${slugify(`${input.receiptId}-${input.action}-${now()}`)}`,
      receiptId: input.receiptId,
      bundleId: input.bundleId,
      action: input.action,
      actor: input.actor,
      note: input.note,
      createdAt: now(),
    });
  }

  private emitOutboxEvent(input: {
    topic: OutboxEventRecord['topic'];
    aggregateType: OutboxEventRecord['aggregateType'];
    aggregateId: string;
    repoId?: string;
    payload: Record<string, unknown>;
  }): void {
    const createdAt = now();
    const deliveries = this.state.webhooks
      .filter((webhook) => webhook.active && webhook.events.includes(input.topic))
      .map((webhook) => ({
        webhookId: webhook.id,
        status: 'pending' as const,
        attempts: 0,
      }));
    const event: OutboxEventRecord = {
      id: `outbox_${slugify(`${input.topic}-${input.aggregateId}-${createdAt}`)}`,
      topic: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      repoId: input.repoId,
      status: deliveries.length === 0 ? 'delivered' : 'pending',
      payload: input.payload,
      deliveries,
      createdAt,
      updatedAt: createdAt,
    };
    this.state.outboxEvents.push(event);

    for (const delivery of deliveries) {
      this.enqueueJob({
        kind: 'webhook_delivery',
        repoId: input.repoId ?? this.state.repos[0]?.id ?? 'repo_local-default',
        targetId: `${event.id}:${delivery.webhookId}`,
        files: [],
        createdAt,
      });
    }
  }

  private async processWebhookDelivery(job: FreshnessJobRecord): Promise<void> {
    const [eventId, webhookId] = job.targetId.split(':');
    if (!eventId || !webhookId) {
      throw new Error(`Webhook delivery target "${job.targetId}" is invalid.`);
    }

    const event = requireById(this.state.outboxEvents, eventId, 'Outbox event');
    const webhook = requireById(this.state.webhooks, webhookId, 'Webhook');
    const delivery = event.deliveries.find((entry) => entry.webhookId === webhookId);
    if (!delivery) {
      throw new Error(
        `Webhook delivery for event "${eventId}" and webhook "${webhookId}" is missing.`
      );
    }

    const attemptAt = now();
    delivery.attempts += 1;
    delivery.lastAttemptAt = attemptAt;
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scbs-event-topic': event.topic,
        'x-scbs-webhook-id': webhook.id,
      },
      body: JSON.stringify({
        id: event.id,
        topic: event.topic,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        repoId: event.repoId,
        payload: event.payload,
        createdAt: event.createdAt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status}.`);
    }

    delivery.status = 'delivered';
    delivery.deliveredAt = attemptAt;
    delivery.lastError = undefined;
    webhook.lastDeliveryAt = attemptAt;
    event.updatedAt = attemptAt;
    event.status = event.deliveries.every((entry) => entry.status === 'delivered')
      ? 'delivered'
      : 'partial';
  }

  private async processJob(job: FreshnessJobRecord): Promise<boolean> {
    const startedAt = now();
    job.status = 'running';
    job.startedAt = startedAt;
    job.updatedAt = startedAt;
    job.lastError = undefined;

    try {
      if (job.kind === 'repo_scan') {
        const repo = requireById(this.state.repos, job.targetId, 'Repository');
        repo.status = 'scanned';
        repo.lastScannedAt = now();
        this.emitOutboxEvent({
          topic: 'repo.scanned',
          aggregateType: 'repo',
          aggregateId: repo.id,
          repoId: repo.id,
          payload: {
            lastScannedAt: repo.lastScannedAt,
          },
        });
      } else if (job.kind === 'receipt_validation') {
        this.validateReceiptNow(job.targetId);
      } else if (job.kind === 'webhook_delivery') {
        await this.processWebhookDelivery(job);
      } else {
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
      }

      const completedAt = now();
      job.status = 'completed';
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      return true;
    } catch (error) {
      const failedAt = now();
      job.attempts += 1;
      job.updatedAt = failedAt;
      job.completedAt = undefined;
      job.lastError = error instanceof Error ? error.message : 'Unknown job failure';
      if (job.kind === 'receipt_validation') {
        this.recordReceiptReview({
          receiptId: job.targetId,
          bundleId: requireById(this.state.receipts, job.targetId, 'Receipt').bundleId,
          action: 'validation_failed',
          actor: 'system',
          note: job.lastError,
        });
      }
      if (job.kind === 'webhook_delivery') {
        const [eventId, webhookId] = job.targetId.split(':');
        const event = this.state.outboxEvents.find((entry) => entry.id === eventId);
        const delivery = event?.deliveries.find((entry) => entry.webhookId === webhookId);
        if (delivery) {
          delivery.status = 'failed';
          delivery.lastError = job.lastError;
          delivery.lastAttemptAt = failedAt;
        }
        if (event) {
          event.updatedAt = failedAt;
          event.status = 'failed';
        }
      }
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
      } else {
        job.status = 'pending';
        job.availableAt = new Date(
          Date.now() + Math.min(1000 * 2 ** (job.attempts - 1), 30000)
        ).toISOString();
      }
      return false;
    }
  }
}

export const createInMemoryScbsService = () => new InMemoryScbsService();
