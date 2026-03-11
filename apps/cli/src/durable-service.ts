import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPostgresMigrations,
  createCoreServices,
  createPostgresStore,
  listAppliedPostgresMigrations,
  planBundle as planCoreBundle,
} from '../../../packages/core/src/index';
import { readJsonFile, writeJsonFile } from '../../../packages/core/src/storage/json-store';
import type { CoreStore } from '../../../packages/core/src/storage/memory-store';
import type {
  AgentReceipt,
  BundleCacheEntry,
  TaskBundle,
} from '../../../packages/protocol/src/index';
import { InMemoryScbsService, type SeedState, createSeedState } from './in-memory-service';
import { createApiCapabilities } from './service';
import type {
  BundlePlanInput,
  FreshnessWorkerInput,
  FreshnessWorkerResult,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';
import type {
  BundleRecord,
  ClaimRecord,
  FactRecord,
  ReceiptRecord,
  RepoRecord,
  ViewRecord,
} from './types';

interface DurableServiceOptions {
  cwd?: string;
  configPath?: string;
  statePath?: string;
  databaseUrl?: string;
}

interface DurablePaths {
  cwd: string;
  configPath: string;
  statePath: string;
  migrationsPath: string;
}

interface PostgresBackend {
  kind: 'postgres';
  connectionString: string;
}

const SERVICE_VERSION = '0.1.0';
const API_VERSION = 'v1' as const;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;
const DEFAULT_DATABASE_URL = 'postgres://127.0.0.1:5432/scbs';
const MIGRATION_TABLE = '_scbs_migrations';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface FreshnessRecomputeJob {
  id: string;
  bundleId: string;
}

const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const MAX_PSQL_LIMIT = 2_147_483_647;

const defaultConfigContents = (
  statePath: string,
  databaseUrl: string,
  migrationsPath: string
) => `service:
  name: scbs
  apiVersion: ${API_VERSION}
  host: ${DEFAULT_HOST}
  port: ${DEFAULT_PORT}

storage:
  statePath: ${statePath}
  adapter: local-json
  # adapter: postgres
  # databaseUrl: ${databaseUrl}
  # migrationTable: ${MIGRATION_TABLE}
  # migrationsPath: ${migrationsPath}

features:
  bundlePlanning: true
  receiptIngestion: true
  freshnessChecks: true
  rebuildTriggers: true
`;

class PostgresFreshnessJobStore {
  private readonly psqlPrefix: string[];

  public constructor(private readonly databaseUrl: string) {
    const hasLocalPsql = spawnSync('bash', ['-lc', 'command -v psql >/dev/null 2>&1']).status === 0;
    const hasDocker = spawnSync('bash', ['-lc', 'command -v docker >/dev/null 2>&1']).status === 0;

    if (!hasLocalPsql && !hasDocker) {
      throw new Error('PostgreSQL freshness jobs require either a local "psql" client or Docker.');
    }

    this.psqlPrefix = hasLocalPsql
      ? ['psql']
      : ['docker', 'run', '--rm', '--network', 'host', 'postgres:16', 'psql'];
  }

  public async enqueueBundle(bundleId: string): Promise<void> {
    await this.execSql(`
      INSERT INTO freshness_recompute_jobs (id, bundle_id, status, requested_at)
      SELECT ${quoteLiteral(randomUUID())}, ${quoteLiteral(bundleId)}, 'pending', NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM freshness_recompute_jobs
        WHERE bundle_id = ${quoteLiteral(bundleId)}
          AND status IN ('pending', 'processing')
      );
    `);
  }

  public async claimPendingJobs(limit: number): Promise<FreshnessRecomputeJob[]> {
    const boundedLimit = Math.max(0, Math.min(Math.trunc(limit), MAX_PSQL_LIMIT));
    if (boundedLimit === 0) {
      return [];
    }

    const rows = await this.queryRows(`
      WITH claimed AS (
        SELECT id
        FROM freshness_recompute_jobs
        WHERE status = 'pending'
        ORDER BY requested_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${boundedLimit}
      )
      UPDATE freshness_recompute_jobs AS jobs
      SET status = 'processing',
          started_at = NOW()
      FROM claimed
      WHERE jobs.id = claimed.id
      RETURNING jobs.id, jobs.bundle_id;
    `);

    return rows.flatMap(([id, bundleId]) =>
      id && bundleId
        ? [
            {
              id,
              bundleId,
            },
          ]
        : []
    );
  }

  public async completeJob(id: string): Promise<void> {
    await this.execSql(`
      UPDATE freshness_recompute_jobs
      SET status = 'completed',
          completed_at = NOW(),
          error_text = NULL
      WHERE id = ${quoteLiteral(id)};
    `);
  }

  public async failJob(id: string, errorText: string): Promise<void> {
    await this.execSql(`
      UPDATE freshness_recompute_jobs
      SET status = 'failed',
          completed_at = NOW(),
          error_text = ${quoteLiteral(errorText.slice(0, 1000))}
      WHERE id = ${quoteLiteral(id)};
    `);
  }

  private async execSql(sql: string): Promise<void> {
    await this.runPsql(['-v', 'ON_ERROR_STOP=1'], sql);
  }

  private async queryRows(sql: string): Promise<string[][]> {
    const stdout = await this.runPsql(['-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', '-c', sql]);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
  }

  private async runPsql(args: string[], stdin?: string): Promise<string> {
    const [command, ...commandArgs] = this.psqlPrefix;
    if (!command) {
      throw new Error('Expected a psql command.');
    }

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, [...commandArgs, '-d', this.databaseUrl, ...args], {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      if (stdin) {
        child.stdin.end(stdin);
      } else {
        child.stdin.end();
      }

      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`psql terminated with signal ${signal}`));
          return;
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || `psql exited with code ${code}`));
          return;
        }

        resolve(stdout.trim());
      });
    });
  }
}

function resolveDurablePaths(options: DurableServiceOptions = {}): DurablePaths {
  const cwd = options.cwd ?? process.cwd();
  return {
    cwd,
    configPath: options.configPath ?? path.join(cwd, 'config/scbs.config.yaml'),
    statePath: options.statePath ?? path.join(cwd, '.scbs/state.json'),
    migrationsPath: path.join(repoRoot, 'migrations'),
  };
}

const now = () => new Date().toISOString();

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const dedupe = (values: string[] | undefined): string[] => [...new Set(values ?? [])];

function parseStorageAdapter(configContents: string): string | undefined {
  let inStorageSection = false;

  for (const rawLine of configContents.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const topLevelMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (topLevelMatch) {
      inStorageSection = topLevelMatch[1] === 'storage';
      continue;
    }

    if (!inStorageSection) {
      continue;
    }

    const adapterMatch = rawLine.match(/^\s+adapter:\s*(\S.*?)\s*$/);
    if (adapterMatch) {
      return adapterMatch[1];
    }

    if (!/^\s/.test(rawLine)) {
      inStorageSection = false;
    }
  }

  return undefined;
}

function requireById<T extends { id: string }>(collection: T[], id: string, label: string): T {
  const match = collection.find((entry) => entry.id === id);
  if (!match) {
    throw new Error(`${label} "${id}" was not found.`);
  }
  return match;
}

function toRepoRecord(store: CoreStore, repoId: string): RepoRecord {
  const repository = requireById(store.repositories, repoId, 'Repository');
  const repoFiles = store.files.filter((file) => file.repoId === repoId);
  const firstSeenAt = repoFiles[0]?.lastSeenAt;
  const lastScannedAt =
    repoFiles.length > 0 && firstSeenAt
      ? repoFiles.reduce(
          (latest, file) => (file.lastSeenAt > latest ? file.lastSeenAt : latest),
          firstSeenAt
        )
      : null;

  return {
    id: repository.id,
    name: repository.name,
    path: repository.rootPath ?? '.',
    status: repoFiles.length > 0 ? ('scanned' as const) : ('registered' as const),
    lastScannedAt,
  };
}

function toFactRecord(fact: CoreStore['facts'][number]): FactRecord {
  const subject =
    typeof fact.value.command === 'string'
      ? String(fact.value.command)
      : typeof fact.value.name === 'string'
        ? `${String(fact.value.name)} (${fact.type})`
        : `${fact.type}:${fact.subjectId}`;

  return {
    id: fact.id,
    repoId: fact.repoId,
    subject,
    freshness: fact.freshness === 'expired' ? 'expired' : fact.freshness,
  };
}

function toClaimRecord(claim: CoreStore['claims'][number]): ClaimRecord {
  return {
    id: claim.id,
    repoId: claim.repoId,
    statement: claim.text,
    factIds: claim.factIds,
    freshness: claim.freshness === 'partial' ? 'partial' : claim.freshness,
  };
}

function toViewRecord(view: CoreStore['views'][number]): ViewRecord {
  return {
    id: view.id,
    repoId: view.repoId,
    name: view.key,
    claimIds: view.claimIds,
    freshness: view.freshness === 'partial' ? 'partial' : view.freshness,
  };
}

function toBundleRecord(bundle: TaskBundle, warnings: string[] = []): BundleRecord {
  const metadata = bundle.metadata ?? {};
  return {
    id: bundle.id,
    repoIds: bundle.repoIds,
    task: typeof metadata.task === 'string' ? String(metadata.task) : bundle.summary,
    viewIds: bundle.selectedViewIds,
    freshness: bundle.freshness === 'unknown' ? 'partial' : bundle.freshness,
    parentBundleId:
      typeof metadata.parentBundleId === 'string' ? String(metadata.parentBundleId) : undefined,
    fileScope: bundle.fileScope,
    symbolScope: bundle.symbolScope,
    commands: bundle.commands,
    proofHandles: bundle.proofHandles,
    warnings,
  };
}

function toReceiptRecord(receipt: AgentReceipt): ReceiptRecord {
  return {
    id: receipt.id,
    bundleId: receipt.bundleId ?? null,
    agent: receipt.fromRole ?? 'system',
    summary: receipt.summary,
    status:
      receipt.status === 'provisional'
        ? ('pending' as const)
        : receipt.status === 'validated'
          ? ('validated' as const)
          : ('rejected' as const),
  };
}

function toSeedState(store: CoreStore): SeedState {
  return {
    repos: store.repositories.map((repository) => toRepoRecord(store, repository.id)),
    facts: store.facts.map(toFactRecord),
    claims: store.claims.map(toClaimRecord),
    views: store.views.map(toViewRecord),
    bundles: store.bundles.map((bundle) => toBundleRecord(bundle)),
    receipts: store.receipts.map(toReceiptRecord),
    bundleCache: store.bundleCache.map((entry) => ({
      key: entry.cacheKey,
      bundleId: entry.bundleId,
      freshness: entry.freshness === 'expired' ? 'expired' : entry.freshness,
    })),
  };
}

function seedStoreFromState(store: CoreStore, state: SeedState): void {
  const seededAt = now();
  store.repositories = state.repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    rootPath: repo.path,
    provider: 'git',
    metadata: {},
    createdAt: seededAt,
    updatedAt: seededAt,
  }));
  store.files = [];
  store.symbols = [];
  store.edges = [];
  store.facts = state.facts.map((fact, index) => ({
    id: fact.id,
    repoId: fact.repoId,
    type: 'seed_fact',
    subjectType: 'repo',
    subjectId: `seed_subject_${index}`,
    value: { subject: fact.subject },
    anchors: [],
    versionStamp: `seed-fact-${index}`,
    freshness:
      fact.freshness === 'stale' ? 'stale' : fact.freshness === 'expired' ? 'expired' : 'fresh',
    createdAt: seededAt,
    updatedAt: seededAt,
  }));
  store.claims = state.claims.map((claim) => ({
    id: claim.id,
    repoId: claim.repoId,
    text: claim.statement,
    type: 'observed',
    confidence: 1,
    trustTier: 'source',
    factIds: claim.factIds,
    anchors: [],
    freshness:
      claim.freshness === 'expired'
        ? 'expired'
        : claim.freshness === 'stale'
          ? 'stale'
          : claim.freshness === 'unknown'
            ? 'unknown'
            : claim.freshness === 'partial'
              ? 'partial'
              : 'fresh',
    invalidationKeys: [],
    metadata: {},
    createdAt: seededAt,
    updatedAt: seededAt,
  }));
  store.views = state.views.map((view) => ({
    id: view.id,
    repoId: view.repoId,
    type: 'file_scope',
    key: view.name,
    title: view.name,
    summary: view.name,
    claimIds: view.claimIds,
    freshness:
      view.freshness === 'expired'
        ? 'expired'
        : view.freshness === 'stale'
          ? 'stale'
          : view.freshness === 'unknown'
            ? 'unknown'
            : view.freshness === 'partial'
              ? 'partial'
              : 'fresh',
    createdAt: seededAt,
    updatedAt: seededAt,
    metadata: {},
  }));
  store.bundles = state.bundles.map((bundle) => ({
    id: bundle.id,
    requestId: `seed_${bundle.id}`,
    repoIds: bundle.repoIds,
    summary: bundle.task,
    selectedViewIds: bundle.viewIds,
    selectedClaimIds: [],
    fileScope: bundle.fileScope ?? [],
    symbolScope: bundle.symbolScope ?? [],
    commands: [],
    proofHandles: [],
    freshness:
      bundle.freshness === 'expired'
        ? 'expired'
        : bundle.freshness === 'stale'
          ? 'stale'
          : bundle.freshness === 'unknown'
            ? 'unknown'
            : bundle.freshness === 'partial'
              ? 'partial'
              : 'fresh',
    cacheKey: `bundle:${bundle.id}`,
    metadata: { task: bundle.task, parentBundleId: bundle.parentBundleId },
    createdAt: seededAt,
  }));
  store.bundleCache = state.bundleCache.map(
    (entry, index): BundleCacheEntry => ({
      id: `bc_seed_${index}`,
      cacheKey: entry.key,
      bundleId: entry.bundleId,
      freshness: entry.freshness === 'unknown' ? 'partial' : entry.freshness,
      hitCount: 0,
      createdAt: seededAt,
      updatedAt: seededAt,
    })
  );
  store.receipts = state.receipts.map((receipt) => ({
    id: receipt.id,
    repoIds: receipt.bundleId
      ? (store.bundles.find((bundle) => bundle.id === receipt.bundleId)?.repoIds ?? [])
      : [],
    bundleId: receipt.bundleId ?? undefined,
    fromRole: receipt.agent,
    type: 'workflow_note',
    summary: receipt.summary,
    payload: {},
    status:
      receipt.status === 'pending'
        ? 'provisional'
        : receipt.status === 'validated'
          ? 'validated'
          : 'rejected',
    createdAt: seededAt,
    updatedAt: seededAt,
  }));
}

export class DurableScbsService implements ScbsService {
  private readonly paths: DurablePaths;
  private readonly databaseUrl: string;
  private readonly explicitDatabaseUrl: boolean;
  private readonly postgresJobs: PostgresFreshnessJobStore | null;

  public constructor(options: DurableServiceOptions = {}) {
    this.paths = resolveDurablePaths(options);
    this.explicitDatabaseUrl =
      options.databaseUrl !== undefined || process.env.SCBS_DATABASE_URL !== undefined;
    this.databaseUrl = options.databaseUrl ?? process.env.SCBS_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    this.postgresJobs =
      options.databaseUrl !== undefined || process.env.DATABASE_URL !== undefined
        ? new PostgresFreshnessJobStore(
            options.databaseUrl ?? process.env.DATABASE_URL ?? this.databaseUrl
          )
        : null;
  }

  public async init(configPath: string) {
    const resolvedConfigPath = this.resolveConfigPath(configPath);
    const configCreated = await this.ensureConfig(configPath);
    const stateCreated = await this.ensureState();
    await this.syncCompatibilityState();
    return {
      mode: 'local-durable' as const,
      configPath: this.toRelativePath(resolvedConfigPath),
      statePath: this.toRelativePath(this.paths.statePath),
      created: configCreated || stateCreated,
      configCreated,
      stateCreated,
      driver: (await this.resolvePostgresBackend())
        ? ('postgres' as const)
        : ('local-json' as const),
      databaseUrl: this.databaseUrl,
      migrationTable: MIGRATION_TABLE,
    };
  }

  public async serve() {
    await this.ensureState();
    const backend = await this.resolvePostgresBackend();
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
        adapter: backend ? ('postgres' as const) : ('local-json' as const),
        driver: backend ? ('postgres' as const) : ('local-json' as const),
        configPath: this.toRelativePath(this.paths.configPath),
        statePath: this.toRelativePath(this.paths.statePath),
        stateExists: true,
        databaseUrl: backend?.connectionString ?? this.databaseUrl,
        migrationTable: MIGRATION_TABLE,
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
    const backend = await this.resolvePostgresBackend();

    return {
      status: configExists ? ('ok' as const) : ('warn' as const),
      summary: backend
        ? 'PostgreSQL durable storage is available and the local compatibility mirror is synchronized.'
        : configExists
          ? 'SCBS is using the local compatibility mirror because PostgreSQL is unavailable.'
          : 'Local durable state is ready, but the default config file is missing. Run `scbs init` to materialize it.',
      api: {
        kind: 'local-durable' as const,
        baseUrl: this.getBaseUrl(),
        apiVersion: API_VERSION,
        mode: 'live' as const,
        capabilities: createApiCapabilities(),
      },
      storage: {
        adapter: backend ? ('postgres' as const) : ('local-json' as const),
        driver: backend ? ('postgres' as const) : ('local-json' as const),
        configPath: this.toRelativePath(this.paths.configPath),
        statePath: this.toRelativePath(this.paths.statePath),
        stateExists: true,
        databaseUrl: this.databaseUrl,
        migrationTable: MIGRATION_TABLE,
      },
      checks: [
        {
          name: 'config',
          status: configExists ? ('ok' as const) : ('warn' as const),
          detail: configExists
            ? `Config file is present at ${this.toRelativePath(this.paths.configPath)}.`
            : `Config file is missing at ${this.toRelativePath(this.paths.configPath)}; run init to create the durable config.`,
        },
        {
          name: 'storage',
          status: 'ok' as const,
          detail: backend
            ? `PostgreSQL durable adapter is active at ${this.databaseUrl}.`
            : `Local compatibility adapter is active at ${this.toRelativePath(this.paths.statePath)} because PostgreSQL could not be reached.`,
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
    const stateCreated = await this.ensureState();
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return {
        adapter: 'local-json' as const,
        statePath: this.toRelativePath(this.paths.statePath),
        applied: stateCreated ? ['0001_local_json_store'] : [],
        pending: 0,
        baselineVersion: SERVICE_VERSION,
        stateCreated,
        driver: 'local-json' as const,
        databaseUrl: this.databaseUrl,
        migrationTable: MIGRATION_TABLE,
      };
    }

    const newlyApplied = await applyPostgresMigrations(
      backend.connectionString,
      this.paths.migrationsPath
    );
    const applied = await listAppliedPostgresMigrations(backend.connectionString);
    await this.syncCompatibilityState();
    return {
      adapter: 'postgres' as const,
      statePath: this.toRelativePath(this.paths.statePath),
      applied: newlyApplied,
      pending: 0,
      baselineVersion: SERVICE_VERSION,
      stateCreated,
      driver: 'postgres' as const,
      databaseUrl: backend.connectionString,
      migrationTable: MIGRATION_TABLE,
      currentVersion: applied.at(-1),
    };
  }

  public async registerRepo(input: RegisterRepoInput) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.registerRepo(input));
    }

    return this.withPostgresMutation(backend, async (store) => {
      const services = createCoreServices({ store });
      const repository = services.repositories.register({
        id: `repo_${slugify(input.name || input.path)}`,
        name: input.name,
        rootPath: input.path,
      });
      return toRepoRecord(store, repository.id);
    });
  }

  public async listRepos() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.listRepos());
    }

    return this.withPostgresService(backend, async (store) =>
      store.repositories.map((repository) => toRepoRecord(store, repository.id))
    );
  }

  public async showRepo(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.showRepo(id));
    }

    return this.withPostgresService(backend, async (store) => toRepoRecord(store, id));
  }

  public async scanRepo(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.scanRepo(id));
    }

    return this.withPostgresMutation(backend, async (store) => {
      const services = createCoreServices({ store });
      await services.repositories.scan(id);
      services.derive(id);
      return toRepoRecord(store, id);
    });
  }

  public async reportRepoChanges(input: RepoChangesInput) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.reportRepoChanges(input));
    }

    return this.withPostgresMutation(backend, async (store) => {
      requireById(store.repositories, input.id, 'Repository');
      const services = createCoreServices({ store });
      const freshness = services.freshness.markChanged(
        input.files.map((filePath) => ({ repoId: input.id, filePath }))
      );
      const impacted = freshness.bundles.filter((bundle) => bundle.freshness !== 'fresh');
      return {
        repoId: input.id,
        files: input.files,
        impacts: impacted.length || input.files.length,
      };
    });
  }

  public async listFacts() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.listFacts());
    }
    return this.withPostgresService(backend, async (store) => store.facts.map(toFactRecord));
  }

  public async listClaims() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.listClaims());
    }
    return this.withPostgresService(backend, async (store) => store.claims.map(toClaimRecord));
  }

  public async showClaim(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.showClaim(id));
    }
    return this.withPostgresService(backend, async (store) =>
      toClaimRecord(requireById(store.claims, id, 'Claim'))
    );
  }

  public async listViews() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.listViews());
    }
    return this.withPostgresService(backend, async (store) => store.views.map(toViewRecord));
  }

  public async showView(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.showView(id));
    }
    return this.withPostgresService(backend, async (store) =>
      toViewRecord(requireById(store.views, id, 'View'))
    );
  }

  public async rebuildView(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.rebuildView(id));
    }
    return this.withPostgresMutation(backend, async (store) => {
      const view = requireById(store.views, id, 'View');
      view.freshness = 'fresh';
      view.updatedAt = now();
      return toViewRecord(view);
    });
  }

  public async planBundle(input: BundlePlanInput) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.planBundle(input));
    }

    return this.withPostgresMutation(backend, async (store) => {
      const repoIds = dedupe(input.repoIds ?? (input.repoId ? [input.repoId] : []));
      const result = planCoreBundle(createCoreServices({ store }), {
        id: `req_${slugify(input.task)}`,
        taskTitle: input.task,
        repoIds,
        parentBundleId: input.parentBundleId,
        fileScope: input.fileScope,
        symbolScope: input.symbolScope,
        constraints: {
          includeCommands: true,
          includeProofHandles: true,
        },
      });
      result.bundle.metadata = {
        ...result.bundle.metadata,
        task: input.task,
      };
      return toBundleRecord(result.bundle, result.warnings);
    });
  }

  public async showBundle(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.showBundle(id));
    }
    return this.withPostgresService(backend, async (store) =>
      toBundleRecord(requireById(store.bundles, id, 'Bundle'))
    );
  }

  public async getBundleFreshness(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.getBundleFreshness(id));
    }
    return this.withPostgresService(backend, async (store) => {
      const bundle = requireById(store.bundles, id, 'Bundle');
      return {
        bundleId: bundle.id,
        freshness: bundle.freshness === 'unknown' ? 'partial' : bundle.freshness,
      };
    });
  }

  public async expireBundle(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.expireBundle(id));
    }
    const bundle = await this.withPostgresMutation(backend, async (store) => {
      const bundle = requireById(store.bundles, id, 'Bundle');
      bundle.freshness = 'expired';
      return toBundleRecord(bundle);
    });
    await this.postgresJobs?.enqueueBundle(bundle.id);
    return bundle;
  }

  public async listBundleCache() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.listBundleCache());
    }
    return this.withPostgresMutation(backend, async (store) =>
      store.bundleCache.map((entry) => ({
        key: entry.cacheKey,
        bundleId: entry.bundleId,
        freshness: entry.freshness,
      }))
    );
  }

  public async clearBundleCache() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.clearBundleCache());
    }
    return this.withPostgresMutation(backend, async (store) => {
      const cleared = store.bundleCache.length;
      store.bundleCache = [];
      return { cleared };
    });
  }

  public async getFreshnessImpacts() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.getFreshnessImpacts());
    }
    return this.withPostgresService(backend, async (store) =>
      store.bundles.map((bundle) => ({
        artifactType: 'bundle' as const,
        artifactId: bundle.id,
        state: bundle.freshness === 'unknown' ? 'partial' : bundle.freshness,
      }))
    );
  }

  public async recomputeFreshness() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.recomputeFreshness());
    }
    if (!this.postgresJobs) {
      return this.withPostgresMutation(backend, async (store) => {
        let updated = 0;
        for (const bundle of store.bundles) {
          if (bundle.freshness !== 'fresh') {
            bundle.freshness = 'fresh';
            updated += 1;
          }
        }
        return { updated };
      });
    }

    const result = await this.runClaimedFreshnessJobs(backend, Number.MAX_SAFE_INTEGER);
    return { updated: result.updated };
  }

  public async runFreshnessWorker(input: FreshnessWorkerInput): Promise<FreshnessWorkerResult> {
    const limit = Math.max(0, Math.trunc(input.limit));
    if (limit === 0) {
      return { claimed: 0, processed: 0, succeeded: 0, failed: 0, updated: 0 };
    }

    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation(async (service) => {
        const staleBundleIds = (await service.getFreshnessImpacts())
          .filter((impact) => impact.state !== 'fresh')
          .slice(0, limit)
          .map((impact) => impact.artifactId);
        const result = await service.recomputeBundles(staleBundleIds);
        return {
          claimed: staleBundleIds.length,
          processed: staleBundleIds.length,
          succeeded: staleBundleIds.length,
          failed: 0,
          updated: result.updated,
        };
      });
    }

    if (!this.postgresJobs) {
      return { claimed: 0, processed: 0, succeeded: 0, failed: 0, updated: 0 };
    }

    return this.runClaimedFreshnessJobs(backend, limit);
  }

  public async getFreshnessStatus() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.getFreshnessStatus());
    }
    return this.withPostgresService(backend, async (store) => {
      let updated = 0;
      for (const bundle of store.bundles) {
        if (bundle.freshness !== 'fresh') updated += 1;
      }
      return {
        overall: updated > 0 ? ('partial' as const) : ('fresh' as const),
        staleArtifacts: updated,
      };
    });
  }

  public async submitReceipt(input: ReceiptSubmitInput) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.submitReceipt(input));
    }
    return this.withPostgresMutation(backend, async (store) => {
      const createdAt = now();
      const receipt: AgentReceipt = {
        id: `receipt_${slugify(`${input.agent}-${input.summary}`)}`,
        repoIds: input.bundleId ? requireById(store.bundles, input.bundleId, 'Bundle').repoIds : [],
        bundleId: input.bundleId ?? undefined,
        fromRole: input.agent,
        type: 'workflow_note',
        summary: input.summary,
        payload: {},
        status: 'provisional',
        createdAt,
        updatedAt: createdAt,
      };
      store.receipts.push(receipt);
      return toReceiptRecord(receipt);
    });
  }

  public async listReceipts() {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.listReceipts());
    }
    return this.withPostgresService(backend, async (store) => store.receipts.map(toReceiptRecord));
  }

  public async showReceipt(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyService((service) => service.showReceipt(id));
    }
    return this.withPostgresService(backend, async (store) =>
      toReceiptRecord(requireById(store.receipts, id, 'Receipt'))
    );
  }

  public async validateReceipt(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.validateReceipt(id));
    }
    return this.withPostgresMutation(backend, async (store) => {
      const receipt = requireById(store.receipts, id, 'Receipt');
      receipt.status = 'validated';
      receipt.updatedAt = now();
      return toReceiptRecord(receipt);
    });
  }

  public async rejectReceipt(id: string) {
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      return this.withLegacyMutation((service) => service.rejectReceipt(id));
    }
    return this.withPostgresMutation(backend, async (store) => {
      const receipt = requireById(store.receipts, id, 'Receipt');
      receipt.status = 'rejected';
      receipt.updatedAt = now();
      return toReceiptRecord(receipt);
    });
  }

  private async withLegacyService<T>(
    run: (service: InMemoryScbsService) => Promise<T>
  ): Promise<T> {
    const state = await this.loadState();
    const service = new InMemoryScbsService(state);
    return run(service);
  }

  private async withLegacyMutation<T>(
    run: (service: InMemoryScbsService) => Promise<T>
  ): Promise<T> {
    const state = await this.loadState();
    const service = new InMemoryScbsService(state);
    const result = await run(service);
    await writeJsonFile(this.paths.statePath, state);
    return result;
  }

  private async withPostgresService<T>(
    backend: PostgresBackend,
    run: (store: CoreStore) => Promise<T>
  ): Promise<T> {
    const handle = await createPostgresStore({ connectionString: backend.connectionString });
    try {
      await this.seedPostgresIfEmpty(handle.store);
      const result = await run(handle.store);
      await this.syncCompatibilityState(handle.store);
      return result;
    } finally {
      await handle.close();
    }
  }

  private async withPostgresMutation<T>(
    backend: PostgresBackend,
    run: (store: CoreStore) => Promise<T>
  ): Promise<T> {
    const handle = await createPostgresStore({ connectionString: backend.connectionString });
    try {
      await this.seedPostgresIfEmpty(handle.store);
      const result = await run(handle.store);
      await handle.flush();
      await this.syncCompatibilityState(handle.store);
      return result;
    } finally {
      await handle.close();
    }
  }

  private async seedPostgresIfEmpty(store: CoreStore): Promise<void> {
    if (store.repositories.length > 0) {
      return;
    }
    const state = (await readJsonFile<SeedState>(this.paths.statePath)) ?? createSeedState();
    seedStoreFromState(store, state);
  }

  private async syncCompatibilityState(store?: CoreStore): Promise<void> {
    if (store) {
      await writeJsonFile(this.paths.statePath, toSeedState(store));
      return;
    }
    const backend = await this.resolvePostgresBackend();
    if (!backend) {
      await this.ensureState();
      return;
    }
    const handle = await createPostgresStore({ connectionString: backend.connectionString });
    try {
      await this.seedPostgresIfEmpty(handle.store);
      await handle.flush();
      await writeJsonFile(this.paths.statePath, toSeedState(handle.store));
    } finally {
      await handle.close();
    }
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
    const contents = defaultConfigContents(
      this.toRelativePath(this.paths.statePath),
      this.databaseUrl,
      path.relative(this.paths.cwd, this.paths.migrationsPath) || 'migrations'
    );

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

  private async resolvePostgresBackend(): Promise<PostgresBackend | undefined> {
    try {
      return await this.initializePostgresBackend();
    } catch (error) {
      if (await this.shouldRequirePostgres()) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`PostgreSQL durable storage initialization failed: ${message}`);
      }
      return undefined;
    }
  }

  private async initializePostgresBackend(): Promise<PostgresBackend> {
    await applyPostgresMigrations(this.databaseUrl, this.paths.migrationsPath);
    return {
      kind: 'postgres',
      connectionString: this.databaseUrl,
    };
  }

  private async shouldRequirePostgres(): Promise<boolean> {
    if (this.explicitDatabaseUrl) {
      return true;
    }

    try {
      const configContents = await readFile(this.paths.configPath, 'utf8');
      return parseStorageAdapter(configContents) === 'postgres';
    } catch {
      return false;
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

  private async runClaimedFreshnessJobs(
    backend: PostgresBackend,
    limit: number
  ): Promise<FreshnessWorkerResult> {
    const jobs = await this.postgresJobs?.claimPendingJobs(limit);
    if (!jobs?.length) {
      return { claimed: 0, processed: 0, succeeded: 0, failed: 0, updated: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    let updated = 0;

    for (const job of jobs) {
      try {
        const result = await this.withPostgresMutation(backend, async (store) => {
          const bundle = requireById(store.bundles, job.bundleId, 'Bundle');
          if (bundle.freshness !== 'fresh') {
            bundle.freshness = 'fresh';
            return { updated: 1 };
          }
          return { updated: 0 };
        });
        updated += result.updated;
        succeeded += 1;
        await this.postgresJobs?.completeJob(job.id);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await this.postgresJobs?.failJob(job.id, message);
      }
    }

    return {
      claimed: jobs.length,
      processed: jobs.length,
      succeeded,
      failed,
      updated,
    };
  }
}

export const createDurableScbsService = (options?: DurableServiceOptions) =>
  new DurableScbsService(options);
