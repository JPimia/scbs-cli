import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../../../packages/core/src/storage/json-store';
import { InMemoryScbsService, type SeedState, createSeedState } from './in-memory-service';
import { PostgresSeedStateStore } from './postgres-state';
import { createApiCapabilities } from './service';
import type {
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';
import type { DoctorReport, MigrationReport, StorageAdapter, StorageSurface } from './types';
import type { FreshnessJobKind } from './types';

interface DurableServiceOptions {
  cwd?: string;
  configPath?: string;
  statePath?: string;
  adapter?: StorageAdapter;
  databaseUrl?: string;
}

interface DurablePaths {
  cwd: string;
  configPath: string;
  statePath: string;
}

interface DurableStore {
  ensureInitialized(): Promise<boolean>;
  loadState(): Promise<SeedState>;
  saveState(state: SeedState): Promise<void>;
  migrate(): Promise<{ applied: string[]; stateCreated: boolean }>;
  createStorageSurface(configPath: string): StorageSurface;
  close(): Promise<void>;
}

const SERVICE_VERSION = '0.1.0';
const API_VERSION = 'v1' as const;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;

const defaultConfigContents = (
  adapter: StorageAdapter,
  options: { statePath: string; databaseUrlConfigured: boolean }
) => `service:
  name: scbs
  apiVersion: ${API_VERSION}
  host: ${DEFAULT_HOST}
  port: ${DEFAULT_PORT}

storage:
  adapter: ${adapter}
${adapter === 'postgres' ? `  databaseUrlEnv: SCBS_DATABASE_URL\n  databaseUrlConfigured: ${options.databaseUrlConfigured}` : `  statePath: ${options.statePath}`}

features:
  bundlePlanning: true
  receiptIngestion: true
  freshnessChecks: true
  rebuildTriggers: true
`;

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

function resolveDurablePaths(options: DurableServiceOptions = {}): DurablePaths {
  const cwd = options.cwd ?? process.cwd();
  return {
    cwd,
    configPath: options.configPath ?? path.join(cwd, 'config/scbs.config.yaml'),
    statePath: options.statePath ?? path.join(cwd, '.scbs/state.json'),
  };
}

function resolveStorageAdapter(options: DurableServiceOptions): StorageAdapter {
  const adapter = options.adapter ?? process.env.SCBS_STORAGE_ADAPTER ?? 'local-json';
  if (adapter !== 'local-json' && adapter !== 'postgres') {
    throw new Error(`Unsupported SCBS storage adapter "${adapter}".`);
  }

  return adapter;
}

function resolveDatabaseUrl(options: DurableServiceOptions): string | undefined {
  return options.databaseUrl ?? process.env.SCBS_DATABASE_URL ?? process.env.DATABASE_URL;
}

class LocalJsonSeedStateStore implements DurableStore {
  public constructor(private readonly paths: DurablePaths) {}

  public async ensureInitialized(): Promise<boolean> {
    const state = await readJsonFile<SeedState>(this.paths.statePath);
    if (state) {
      return false;
    }

    await writeJsonFile(this.paths.statePath, createSeedState());
    return true;
  }

  public async loadState(): Promise<SeedState> {
    return (await readJsonFile<SeedState>(this.paths.statePath)) ?? createSeedState();
  }

  public async saveState(state: SeedState): Promise<void> {
    await writeJsonFile(this.paths.statePath, state);
  }

  public async migrate(): Promise<{ applied: string[]; stateCreated: boolean }> {
    const stateCreated = await this.ensureInitialized();
    return {
      applied: stateCreated ? ['0001_local_json_store'] : [],
      stateCreated,
    };
  }

  public createStorageSurface(configPath: string): StorageSurface {
    return {
      adapter: 'local-json',
      configPath,
      statePath: this.toRelativePath(this.paths.statePath),
      stateExists: true,
    };
  }

  public async close(): Promise<void> {}

  private toRelativePath(targetPath: string): string {
    return path.relative(this.paths.cwd, targetPath) || path.basename(targetPath);
  }
}

export class DurableScbsService implements ScbsService {
  private readonly paths: DurablePaths;

  private readonly adapter: StorageAdapter;

  private readonly databaseUrl?: string;

  private readonly store: DurableStore;

  public constructor(options: DurableServiceOptions = {}) {
    this.paths = resolveDurablePaths(options);
    this.adapter = resolveStorageAdapter(options);
    this.databaseUrl = resolveDatabaseUrl(options);
    this.store =
      this.adapter === 'postgres'
        ? new PostgresSeedStateStore({
            cwd: this.paths.cwd,
            configPath: this.paths.configPath,
            databaseUrl: this.requireDatabaseUrl(),
          })
        : new LocalJsonSeedStateStore(this.paths);
  }

  public async close(): Promise<void> {
    await this.store.close();
  }

  public async init(configPath: string) {
    const resolvedConfigPath = this.resolveConfigPath(configPath);
    const configCreated = await this.ensureConfig(configPath);
    const stateCreated = await this.store.ensureInitialized();
    return {
      mode: this.adapter,
      configPath: this.toRelativePath(resolvedConfigPath),
      statePath:
        this.adapter === 'local-json' ? this.toRelativePath(this.paths.statePath) : undefined,
      created: configCreated || stateCreated,
      configCreated,
      stateCreated,
    };
  }

  public async serve() {
    await this.store.ensureInitialized();
    return {
      service: 'scbs',
      status: 'listening' as const,
      api: {
        kind: 'standalone' as const,
        baseUrl: this.getBaseUrl(),
        apiVersion: API_VERSION,
        mode: 'live' as const,
        capabilities: createApiCapabilities(),
      },
      storage: this.createStorageSurface(),
    };
  }

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: SERVICE_VERSION };
  }

  public async doctor() {
    const configExists = await this.pathExists(this.paths.configPath);
    await this.store.ensureInitialized();
    const diagnostics = createDiagnostics(await this.store.loadState());

    return {
      status: configExists ? ('ok' as const) : ('warn' as const),
      summary: configExists
        ? `${this.describeRuntime()} SCBS service is ready with config and storage paths resolved.`
        : `${this.describeRuntime()} SCBS state is ready, but the default config file is missing. Run \`scbs init\` to materialize it.`,
      api: {
        kind: 'standalone' as const,
        baseUrl: this.getBaseUrl(),
        apiVersion: API_VERSION,
        mode: 'live' as const,
        capabilities: createApiCapabilities(),
      },
      storage: this.createStorageSurface(),
      diagnostics,
      checks: [
        {
          name: 'config',
          status: configExists ? ('ok' as const) : ('warn' as const),
          detail: configExists
            ? `Config file is present at ${this.toRelativePath(this.paths.configPath)}.`
            : `Config file is missing at ${this.toRelativePath(this.paths.configPath)}; run init to create the ${this.adapter} service config.`,
        },
        {
          name: 'storage',
          status: 'ok' as const,
          detail:
            this.adapter === 'postgres'
              ? 'PostgreSQL storage is active with the configured database URL.'
              : `Local JSON storage is active at ${this.toRelativePath(this.paths.statePath)}.`,
        },
        {
          name: 'api',
          status: 'ok' as const,
          detail: `HTTP API boundary is configured at ${this.getBaseUrl()} (${API_VERSION}).`,
        },
        {
          name: 'capabilities',
          status: 'ok' as const,
          detail:
            'Bundle planning, receipt ingestion, freshness checks, rebuild triggers, and repo operations are available through the CLI surface.',
        },
      ],
    };
  }

  public async listJobs() {
    return this.withService((service) => service.listJobs());
  }

  public async showJob(id: string) {
    return this.withService((service) => service.showJob(id));
  }

  public async retryJob(id: string) {
    return this.withMutation((service) => service.retryJob(id));
  }

  public async listBundles() {
    return this.withService((service) => service.listBundles());
  }

  public async reviewBundle(id: string) {
    return this.withService((service) => service.reviewBundle(id));
  }

  public async listReceiptHistory(id?: string) {
    return this.withService((service) => service.listReceiptHistory(id));
  }

  public async listOutboxEvents() {
    return this.withService((service) => service.listOutboxEvents());
  }

  public async showOutboxEvent(id: string) {
    return this.withService((service) => service.showOutboxEvent(id));
  }

  public async listWebhooks() {
    return this.withService((service) => service.listWebhooks());
  }

  public async createWebhook(input: Parameters<InMemoryScbsService['createWebhook']>[0]) {
    return this.withMutation((service) => service.createWebhook(input));
  }

  public async listAccessTokens() {
    return this.withService((service) => service.listAccessTokens());
  }

  public async createAccessToken(input: Parameters<InMemoryScbsService['createAccessToken']>[0]) {
    return this.withMutation((service) => service.createAccessToken(input));
  }

  public async authorizeAccessToken(
    token: string,
    scopes: Parameters<InMemoryScbsService['authorizeAccessToken']>[1]
  ) {
    return this.withMutation((service) => service.authorizeAccessToken(token, scopes));
  }

  public async listAuditRecords() {
    return this.withService((service) => service.listAuditRecords());
  }

  public async recordAudit(input: Parameters<InMemoryScbsService['recordAudit']>[0]) {
    return this.withMutation((service) => service.recordAudit(input));
  }

  public async migrate(): Promise<MigrationReport> {
    const migration = await this.store.migrate();
    return {
      adapter: this.adapter,
      statePath:
        this.adapter === 'local-json' ? this.toRelativePath(this.paths.statePath) : undefined,
      applied: migration.applied,
      pending: 0,
      baselineVersion: SERVICE_VERSION,
      stateCreated: migration.stateCreated,
    };
  }

  public async registerRepo(input: RegisterRepoInput) {
    return this.withMutation((service) => service.registerRepo(input));
  }

  public async listRepos() {
    return this.withService((service) => service.listRepos());
  }

  public async showRepo(id: string) {
    return this.withService((service) => service.showRepo(id));
  }

  public async scanRepo(id: string, options?: { queue?: boolean }) {
    return this.withMutation((service) => service.scanRepo(id, options));
  }

  public async reportRepoChanges(input: RepoChangesInput) {
    return this.withMutation((service) => service.reportRepoChanges(input));
  }

  public async listFacts() {
    return this.withService((service) => service.listFacts());
  }

  public async listClaims() {
    return this.withService((service) => service.listClaims());
  }

  public async showClaim(id: string) {
    return this.withService((service) => service.showClaim(id));
  }

  public async listViews() {
    return this.withService((service) => service.listViews());
  }

  public async showView(id: string) {
    return this.withService((service) => service.showView(id));
  }

  public async rebuildView(id: string) {
    return this.withMutation((service) => service.rebuildView(id));
  }

  public async planBundle(input: BundlePlanInput) {
    return this.withMutation((service) => service.planBundle(input));
  }

  public async showBundle(id: string) {
    return this.withService((service) => service.showBundle(id));
  }

  public async getBundleFreshness(id: string) {
    return this.withService((service) => service.getBundleFreshness(id));
  }

  public async expireBundle(id: string) {
    return this.withMutation((service) => service.expireBundle(id));
  }

  public async listBundleCache() {
    return this.withService((service) => service.listBundleCache());
  }

  public async clearBundleCache() {
    return this.withMutation((service) => service.clearBundleCache());
  }

  public async getFreshnessImpacts() {
    return this.withService((service) => service.getFreshnessImpacts());
  }

  public async recomputeFreshness() {
    return this.withMutation((service) => service.recomputeFreshness());
  }

  public async runFreshnessWorker(options?: {
    limit?: number;
    kinds?: FreshnessJobKind[];
    jobIds?: string[];
  }) {
    return this.withMutation((service) => service.runFreshnessWorker(options));
  }

  public async runWorkerLoop(options?: {
    pollIntervalMs?: number;
    maxIdleCycles?: number;
    limit?: number;
    kinds?: FreshnessJobKind[];
  }) {
    return this.withMutation((service) => service.runWorkerLoop(options));
  }

  public async getFreshnessStatus() {
    return this.withService((service) => service.getFreshnessStatus());
  }

  public async submitReceipt(input: ReceiptSubmitInput) {
    return this.withMutation((service) => service.submitReceipt(input));
  }

  public async listReceipts() {
    return this.withService((service) => service.listReceipts());
  }

  public async showReceipt(id: string) {
    return this.withService((service) => service.showReceipt(id));
  }

  public async validateReceipt(id: string, options?: { queue?: boolean }) {
    return this.withMutation((service) => service.validateReceipt(id, options));
  }

  public async rejectReceipt(id: string) {
    return this.withMutation((service) => service.rejectReceipt(id));
  }

  private async withService<T>(run: (service: InMemoryScbsService) => Promise<T>): Promise<T> {
    const state = await this.store.loadState();
    const service = new InMemoryScbsService(state);
    return run(service);
  }

  private async withMutation<T>(run: (service: InMemoryScbsService) => Promise<T>): Promise<T> {
    const state = await this.store.loadState();
    const service = new InMemoryScbsService(state);
    const result = await run(service);
    await this.store.saveState(state);
    return result;
  }

  private async ensureConfig(configPath: string): Promise<boolean> {
    const absoluteConfigPath = this.resolveConfigPath(configPath);
    const contents = defaultConfigContents(this.adapter, {
      statePath: this.paths.statePath,
      databaseUrlConfigured: Boolean(this.databaseUrl),
    });

    try {
      await mkdir(path.dirname(absoluteConfigPath), { recursive: true });
      await writeFile(absoluteConfigPath, contents, { flag: 'wx', encoding: 'utf8' });
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === 'EEXIST'
      ) {
        return false;
      }

      throw error;
    }
  }

  private resolveConfigPath(configPath: string): string {
    return path.isAbsolute(configPath) ? configPath : path.join(this.paths.cwd, configPath);
  }

  private toRelativePath(targetPath: string): string {
    return path.relative(this.paths.cwd, targetPath) || path.basename(targetPath);
  }

  private getBaseUrl(): string {
    return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  }

  private createStorageSurface(): StorageSurface {
    return this.store.createStorageSurface(this.toRelativePath(this.paths.configPath));
  }

  private describeRuntime(): string {
    return this.adapter === 'postgres' ? 'PostgreSQL-backed standalone' : 'Local JSON standalone';
  }

  private requireDatabaseUrl(): string {
    if (this.databaseUrl) {
      return this.databaseUrl;
    }

    throw new Error(
      'SCBS PostgreSQL runtime requires SCBS_DATABASE_URL or DATABASE_URL when SCBS_STORAGE_ADAPTER=postgres.'
    );
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

export const createDurableScbsService = (options?: DurableServiceOptions) =>
  new DurableScbsService(options);
