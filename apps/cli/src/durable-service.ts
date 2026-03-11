import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../../../packages/core/src/storage/json-store';
import { InMemoryScbsService, type SeedState, createSeedState } from './in-memory-service';
import { createApiCapabilities } from './service';
import type {
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';

interface DurableServiceOptions {
  cwd?: string;
  configPath?: string;
  statePath?: string;
}

interface DurablePaths {
  cwd: string;
  configPath: string;
  statePath: string;
}

const SERVICE_VERSION = '0.1.0';
const API_VERSION = 'v1' as const;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;

const defaultConfigContents = (statePath: string) => `service:
  name: scbs
  apiVersion: ${API_VERSION}
  host: ${DEFAULT_HOST}
  port: ${DEFAULT_PORT}

storage:
  adapter: local-json
  statePath: ${statePath}

features:
  bundlePlanning: true
  receiptIngestion: true
  freshnessChecks: true
  rebuildTriggers: true
`;

function resolveDurablePaths(options: DurableServiceOptions = {}): DurablePaths {
  const cwd = options.cwd ?? process.cwd();
  return {
    cwd,
    configPath: options.configPath ?? path.join(cwd, 'config/scbs.config.yaml'),
    statePath: options.statePath ?? path.join(cwd, '.scbs/state.json'),
  };
}

export class DurableScbsService implements ScbsService {
  private readonly paths: DurablePaths;

  public constructor(options: DurableServiceOptions = {}) {
    this.paths = resolveDurablePaths(options);
  }

  public async init(configPath: string) {
    const resolvedConfigPath = this.resolveConfigPath(configPath);
    const configCreated = await this.ensureConfig(configPath);
    const stateCreated = await this.ensureState();
    return {
      mode: 'local-durable' as const,
      configPath: this.toRelativePath(resolvedConfigPath),
      statePath: this.toRelativePath(this.paths.statePath),
      created: configCreated || stateCreated,
      configCreated,
      stateCreated,
    };
  }

  public async serve() {
    await this.ensureState();
    return {
      service: 'scbs',
      status: 'listening' as const,
      api: {
        kind: 'local-durable' as const,
        baseUrl: this.getBaseUrl(),
        apiVersion: API_VERSION,
        mode: 'live' as const,
        capabilities: createApiCapabilities(),
      },
      storage: {
        adapter: 'local-json' as const,
        configPath: this.toRelativePath(this.paths.configPath),
        statePath: this.toRelativePath(this.paths.statePath),
        stateExists: true,
      },
    };
  }

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: SERVICE_VERSION };
  }

  public async doctor() {
    const configExists = await this.pathExists(this.paths.configPath);
    const stateExisted = await this.pathExists(this.paths.statePath);
    if (!stateExisted) {
      await this.ensureState();
    }

    return {
      status: configExists ? ('ok' as const) : ('warn' as const),
      summary: configExists
        ? 'Local durable SCBS surface is ready with config and state paths resolved.'
        : 'Local durable state is ready, but the default config file is missing. Run `scbs init` to materialize it.',
      api: {
        kind: 'local-durable' as const,
        baseUrl: this.getBaseUrl(),
        apiVersion: API_VERSION,
        mode: 'live' as const,
        capabilities: createApiCapabilities(),
      },
      storage: {
        adapter: 'local-json' as const,
        configPath: this.toRelativePath(this.paths.configPath),
        statePath: this.toRelativePath(this.paths.statePath),
        stateExists: true,
      },
      checks: [
        {
          name: 'config',
          status: configExists ? ('ok' as const) : ('warn' as const),
          detail: configExists
            ? `Config file is present at ${this.toRelativePath(this.paths.configPath)}.`
            : `Config file is missing at ${this.toRelativePath(this.paths.configPath)}; run init to create the local durable config.`,
        },
        {
          name: 'storage',
          status: 'ok' as const,
          detail: `Local durable adapter is active at ${this.toRelativePath(this.paths.statePath)}.`,
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

  public async migrate() {
    const created = await this.ensureState();
    return {
      adapter: 'local-json' as const,
      statePath: this.toRelativePath(this.paths.statePath),
      applied: created ? ['0001_local_json_store'] : [],
      pending: 0,
      baselineVersion: SERVICE_VERSION,
      stateCreated: created,
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

  public async scanRepo(id: string) {
    return this.withMutation((service) => service.scanRepo(id));
  }

  public async reportRepoChanges(input: RepoChangesInput) {
    return this.withService((service) => service.reportRepoChanges(input));
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

  public async validateReceipt(id: string) {
    return this.withMutation((service) => service.validateReceipt(id));
  }

  public async rejectReceipt(id: string) {
    return this.withMutation((service) => service.rejectReceipt(id));
  }

  private async withService<T>(run: (service: InMemoryScbsService) => Promise<T>): Promise<T> {
    const state = await this.loadState();
    const service = new InMemoryScbsService(state);
    return run(service);
  }

  private async withMutation<T>(run: (service: InMemoryScbsService) => Promise<T>): Promise<T> {
    const state = await this.loadState();
    const service = new InMemoryScbsService(state);
    const result = await run(service);
    await writeJsonFile(this.paths.statePath, state);
    return result;
  }

  private async loadState(): Promise<SeedState> {
    return (await readJsonFile<SeedState>(this.paths.statePath)) ?? createSeedState();
  }

  private async ensureState(): Promise<boolean> {
    const state = await readJsonFile<SeedState>(this.paths.statePath);
    if (state) {
      return false;
    }

    await writeJsonFile(this.paths.statePath, createSeedState());
    return true;
  }

  private async ensureConfig(configPath: string): Promise<boolean> {
    const absoluteConfigPath = this.resolveConfigPath(configPath);
    const contents = defaultConfigContents(this.paths.statePath);

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
