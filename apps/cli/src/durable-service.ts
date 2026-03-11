import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../../../packages/core/src/storage/json-store';
import { InMemoryScbsService, type SeedState, createSeedState } from './in-memory-service';
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

const defaultConfigContents = (statePath: string) => `storage:
  adapter: local-json
  path: ${statePath}
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
    const configCreated = await this.ensureConfig(configPath);
    const stateCreated = await this.ensureState();
    return { configPath, created: configCreated || stateCreated };
  }

  public async serve() {
    return { endpoint: 'http://0.0.0.0:8791', mode: 'dry-run' as const };
  }

  public async health() {
    return { status: 'ok' as const, service: 'scbs', version: '0.1.0' };
  }

  public async doctor() {
    await this.ensureState();
    return {
      status: 'ok' as const,
      checks: [
        {
          name: 'config',
          status: 'ok' as const,
          detail: `Default config path is ${this.paths.configPath}.`,
        },
        {
          name: 'storage',
          status: 'ok' as const,
          detail: `Local durable adapter active at ${this.paths.statePath}.`,
        },
      ],
    };
  }

  public async migrate() {
    const created = await this.ensureState();
    return { applied: created ? ['0001_local_json_store'] : [], pending: 0 };
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
    const absoluteConfigPath = path.isAbsolute(configPath)
      ? configPath
      : path.join(this.paths.cwd, configPath);
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
}

export const createDurableScbsService = (options?: DurableServiceOptions) =>
  new DurableScbsService(options);
