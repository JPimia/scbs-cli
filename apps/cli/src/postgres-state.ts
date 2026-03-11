import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type SeedState, createSeedState } from './in-memory-service';
import type {
  BundleRecord,
  ClaimRecord,
  FactRecord,
  FreshnessEventRecord,
  FreshnessJobRecord,
  ReceiptRecord,
  RepoRecord,
  StorageSurface,
  ViewRecord,
} from './types';

interface PostgresStateOptions {
  cwd: string;
  configPath: string;
  databaseUrl: string;
}

const MIGRATION_NAME = '0001_init.sql';
const now = () => new Date().toISOString();

const psqlPrefix = (() => {
  if (spawnSync('bash', ['-lc', 'command -v psql >/dev/null 2>&1']).status === 0) {
    return ['psql'];
  }

  if (spawnSync('bash', ['-lc', 'command -v docker >/dev/null 2>&1']).status === 0) {
    return ['docker', 'run', '--rm', '--network', 'host', 'postgres:16', 'psql'];
  }

  return null;
})();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const asTimestamp = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const escapeSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const jsonbLiteral = (value: unknown) => `${escapeSqlString(JSON.stringify(value))}::jsonb`;

const textLiteral = (value: string | null | undefined) =>
  value === null || value === undefined ? 'NULL' : escapeSqlString(value);

const splitSqlStatements = (sql: string): string[] =>
  sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

export class PostgresSeedStateStore {
  private schemaReady = false;

  public constructor(private readonly options: PostgresStateOptions) {
    if (!psqlPrefix) {
      throw new Error('PostgreSQL runtime requires either a local "psql" client or Docker.');
    }
  }

  public async close(): Promise<void> {}

  public createStorageSurface(configPath: string): StorageSurface {
    return {
      adapter: 'postgres',
      configPath,
      stateExists: true,
      databaseUrlConfigured: true,
    };
  }

  public async ensureInitialized(): Promise<boolean> {
    await this.ensureSchema();
    return this.ensureSeedState();
  }

  public async migrate(): Promise<{ applied: string[]; stateCreated: boolean }> {
    const schemaCreated = await this.ensureSchema();
    const stateCreated = await this.ensureSeedState();
    return {
      applied: schemaCreated ? [MIGRATION_NAME.replace(/\.sql$/, '')] : [],
      stateCreated,
    };
  }

  public async loadState(): Promise<SeedState> {
    await this.ensureSchema();
    if (!(await this.hasSeedData())) {
      return createSeedState();
    }

    const [
      repositories,
      facts,
      claims,
      views,
      bundles,
      bundleCache,
      receipts,
      freshnessEvents,
      freshnessJobs,
    ] = await Promise.all([
      this.queryJson<
        Array<{ id: string; name: string; root_path: string | null; metadata: unknown }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json) FROM (SELECT id, name, root_path, metadata FROM repositories) t"
      ),
      this.queryJson<
        Array<{ id: string; repo_id: string; freshness: FactRecord['freshness']; value: unknown }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json) FROM (SELECT id, repo_id, freshness, value FROM fact_records) t"
      ),
      this.queryJson<
        Array<{
          id: string;
          repo_id: string;
          text: string;
          fact_ids: unknown;
          freshness: ClaimRecord['freshness'];
          type: string;
          confidence: number;
          trust_tier: string;
          anchors: unknown;
          invalidation_keys: unknown;
          metadata: unknown;
          created_at: unknown;
          updated_at: unknown;
        }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json) FROM (SELECT id, repo_id, text, fact_ids, freshness, type, confidence, trust_tier, anchors, invalidation_keys, metadata, created_at, updated_at FROM claim_records) t"
      ),
      this.queryJson<
        Array<{
          id: string;
          repo_id: string;
          title: string;
          claim_ids: unknown;
          freshness: ViewRecord['freshness'];
          type: string;
          key: string;
          summary: string;
          file_scope: unknown;
          symbol_scope: unknown;
          metadata: unknown;
          created_at: unknown;
          updated_at: unknown;
        }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json) FROM (SELECT id, repo_id, title, claim_ids, freshness, type, key, summary, file_scope, symbol_scope, metadata, created_at, updated_at FROM view_records) t"
      ),
      this.queryJson<
        Array<{
          id: string;
          request_id: string;
          repo_ids: unknown;
          summary: string;
          selected_view_ids: unknown;
          selected_claim_ids: unknown;
          file_scope: unknown;
          symbol_scope: unknown;
          commands: unknown;
          proof_handles: unknown;
          freshness: BundleRecord['freshness'];
          cache_key: string | null;
          metadata: unknown;
          created_at: unknown;
          expires_at: unknown;
        }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json) FROM (SELECT id, request_id, repo_ids, summary, selected_view_ids, selected_claim_ids, file_scope, symbol_scope, commands, proof_handles, freshness, cache_key, metadata, created_at, expires_at FROM task_bundles) t"
      ),
      this.queryJson<
        Array<{ cache_key: string; bundle_id: string; freshness: BundleRecord['freshness'] }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.cache_key), '[]'::json) FROM (SELECT cache_key, bundle_id, freshness FROM bundle_cache_entries) t"
      ),
      this.queryJson<
        Array<{
          id: string;
          bundle_id: string | null;
          summary: string;
          status: ReceiptRecord['status'];
          external_ref: unknown;
          payload: unknown;
        }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json) FROM (SELECT id, bundle_id, summary, status, external_ref, payload FROM agent_receipts) t"
      ),
      this.queryJson<
        Array<{ id: string; repo_id: string; changed_files: unknown; created_at: unknown }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at, t.id), '[]'::json) FROM (SELECT id, repo_id, changed_files, created_at FROM freshness_events) t"
      ),
      this.queryJson<
        Array<{
          id: string;
          repo_id: string;
          event_id: string;
          changed_files: unknown;
          status: string;
          created_at: unknown;
          updated_at: unknown;
        }>
      >(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at, t.id), '[]'::json) FROM (SELECT id, repo_id, event_id, changed_files, status, created_at, updated_at FROM recompute_jobs) t"
      ),
    ]);

    const repos: RepoRecord[] = repositories.map((row) => {
      const metadata = asRecord(row.metadata);
      return {
        id: row.id,
        name: row.name,
        path: row.root_path ?? '.',
        status: metadata.status === 'scanned' ? 'scanned' : 'registered',
        lastScannedAt: typeof metadata.lastScannedAt === 'string' ? metadata.lastScannedAt : null,
      };
    });

    const factRecords: FactRecord[] = facts.map((row) => {
      const value = asRecord(row.value);
      return {
        id: row.id,
        repoId: row.repo_id,
        subject: typeof value.subject === 'string' ? value.subject : row.id,
        freshness: row.freshness,
      };
    });

    const claimRecords = claims.map((row) => ({
      id: row.id,
      repoId: row.repo_id,
      statement: row.text,
      factIds: asStringArray(row.fact_ids),
      freshness: row.freshness,
      text: row.text,
      type: row.type,
      confidence: row.confidence,
      trustTier: row.trust_tier,
      anchors: Array.isArray(row.anchors) ? row.anchors : [],
      invalidationKeys: asStringArray(row.invalidation_keys),
      metadata: asRecord(row.metadata),
      createdAt: asTimestamp(row.created_at),
      updatedAt: asTimestamp(row.updated_at),
    })) as ClaimRecord[];

    const viewRecords = views.map((row) => ({
      id: row.id,
      repoId: row.repo_id,
      name: row.title,
      claimIds: asStringArray(row.claim_ids),
      freshness: row.freshness,
      type: row.type,
      key: row.key,
      title: row.title,
      summary: row.summary,
      fileScope: asStringArray(row.file_scope),
      symbolScope: asStringArray(row.symbol_scope),
      metadata: asRecord(row.metadata),
      createdAt: asTimestamp(row.created_at),
      updatedAt: asTimestamp(row.updated_at),
    })) as ViewRecord[];

    const bundleRecords: BundleRecord[] = bundles.map((row) => {
      const metadata = asRecord(row.metadata);
      return {
        id: row.id,
        requestId: row.request_id,
        repoIds: asStringArray(row.repo_ids),
        summary: row.summary,
        selectedViewIds: asStringArray(row.selected_view_ids),
        selectedClaimIds: asStringArray(row.selected_claim_ids),
        commands: asStringArray(row.commands),
        proofHandles: (Array.isArray(row.proof_handles)
          ? row.proof_handles
          : []) as BundleRecord['proofHandles'],
        freshness: row.freshness,
        fileScope: asStringArray(row.file_scope),
        symbolScope: asStringArray(row.symbol_scope),
        cacheKey: typeof row.cache_key === 'string' ? row.cache_key : undefined,
        metadata,
        createdAt: asTimestamp(row.created_at) ?? now(),
        expiresAt: asTimestamp(row.expires_at),
      };
    });

    const receiptRecords = receipts.map((row) => {
      const externalRef = asRecord(row.external_ref);
      const payload = asRecord(row.payload);
      return {
        id: row.id,
        bundleId: row.bundle_id,
        agent: typeof externalRef.agent === 'string' ? externalRef.agent : 'agent',
        summary: row.summary,
        status: row.status,
        repoIds: asStringArray(payload.repoIds),
        type: payload.type,
        fromRole: payload.fromRole,
        payload: asRecord(payload.data),
      };
    }) as ReceiptRecord[];

    return {
      repos,
      facts: factRecords,
      claims: claimRecords,
      views: viewRecords,
      bundles: bundleRecords,
      receipts: receiptRecords,
      bundleCache: bundleCache.map((row) => ({
        key: row.cache_key,
        bundleId: row.bundle_id,
        freshness: row.freshness,
      })),
      freshnessEvents: freshnessEvents.map(
        (row) =>
          ({
            id: row.id,
            repoId: row.repo_id,
            files: asStringArray(row.changed_files),
            createdAt: asTimestamp(row.created_at) ?? now(),
          }) satisfies FreshnessEventRecord
      ),
      freshnessJobs: freshnessJobs.map(
        (row) =>
          ({
            id: row.id,
            repoId: row.repo_id,
            eventId: row.event_id,
            files: asStringArray(row.changed_files),
            status: row.status === 'completed' ? 'completed' : 'pending',
            createdAt: asTimestamp(row.created_at) ?? now(),
            updatedAt: asTimestamp(row.updated_at) ?? now(),
          }) satisfies FreshnessJobRecord
      ),
    };
  }

  public async saveState(state: SeedState): Promise<void> {
    await this.ensureSchema();

    const timestamp = now();
    const viewsById = new Map(state.views.map((view) => [view.id, view]));
    const statements = [
      'BEGIN',
      'DELETE FROM bundle_cache_entries',
      'DELETE FROM recompute_jobs',
      'DELETE FROM freshness_events',
      'DELETE FROM agent_receipts',
      'DELETE FROM task_bundles',
      'DELETE FROM repositories',
      ...state.repos.map(
        (repo) =>
          `INSERT INTO repositories (id, name, root_path, remote_url, default_branch, provider, project_key, metadata, created_at, updated_at) VALUES (${textLiteral(repo.id)}, ${textLiteral(repo.name)}, ${textLiteral(repo.path)}, NULL, NULL, NULL, NULL, ${jsonbLiteral({ status: repo.status, lastScannedAt: repo.lastScannedAt })}, ${textLiteral(timestamp)}, ${textLiteral(timestamp)})`
      ),
      ...state.facts.map(
        (fact) =>
          `INSERT INTO fact_records (id, repo_id, type, subject_type, subject_id, value, anchors, version_stamp, freshness, created_at, updated_at) VALUES (${textLiteral(fact.id)}, ${textLiteral(fact.repoId)}, 'scbs_fact', 'text', ${textLiteral(fact.id)}, ${jsonbLiteral({ subject: fact.subject })}, '[]'::jsonb, 'cli-runtime', ${textLiteral(fact.freshness)}, ${textLiteral(timestamp)}, ${textLiteral(timestamp)})`
      ),
      ...state.claims.map((claim) => {
        const durableClaim = claim as ClaimRecord & Record<string, unknown>;
        return `INSERT INTO claim_records (id, repo_id, text, type, confidence, trust_tier, fact_ids, anchors, freshness, invalidation_keys, metadata, created_at, updated_at) VALUES (${textLiteral(claim.id)}, ${textLiteral(claim.repoId)}, ${textLiteral(String(durableClaim.text ?? claim.statement))}, ${textLiteral(String(durableClaim.type ?? 'provisional'))}, ${Number(durableClaim.confidence ?? 0.6)}, ${textLiteral(String(durableClaim.trustTier ?? 'provisional'))}, ${jsonbLiteral(claim.factIds)}, ${jsonbLiteral(durableClaim.anchors ?? [])}, ${textLiteral(claim.freshness)}, ${jsonbLiteral(durableClaim.invalidationKeys ?? [])}, ${jsonbLiteral(durableClaim.metadata ?? {})}, ${textLiteral(String(durableClaim.createdAt ?? timestamp))}, ${textLiteral(String(durableClaim.updatedAt ?? timestamp))})`;
      }),
      ...state.views.map((view) => {
        const durableView = view as ViewRecord & Record<string, unknown>;
        return `INSERT INTO view_records (id, repo_id, type, key, title, summary, claim_ids, file_scope, symbol_scope, freshness, metadata, created_at, updated_at) VALUES (${textLiteral(view.id)}, ${textLiteral(view.repoId)}, ${textLiteral(String(durableView.type ?? 'overview'))}, ${textLiteral(String(durableView.key ?? view.id))}, ${textLiteral(String(durableView.title ?? view.name))}, ${textLiteral(String(durableView.summary ?? view.name))}, ${jsonbLiteral(view.claimIds)}, ${jsonbLiteral(durableView.fileScope ?? [])}, ${jsonbLiteral(durableView.symbolScope ?? [])}, ${textLiteral(view.freshness)}, ${jsonbLiteral(durableView.metadata ?? {})}, ${textLiteral(String(durableView.createdAt ?? timestamp))}, ${textLiteral(String(durableView.updatedAt ?? timestamp))})`;
      }),
      ...state.bundles.map((bundle) => {
        const metadata = asRecord(bundle.metadata);
        return `INSERT INTO task_bundles (id, request_id, repo_ids, summary, selected_view_ids, selected_claim_ids, file_scope, symbol_scope, commands, proof_handles, freshness, cache_key, metadata, created_at, expires_at) VALUES (${textLiteral(bundle.id)}, ${textLiteral(bundle.requestId)}, ${jsonbLiteral(bundle.repoIds)}, ${textLiteral(bundle.summary)}, ${jsonbLiteral(bundle.selectedViewIds)}, ${jsonbLiteral(bundle.selectedClaimIds)}, ${jsonbLiteral(bundle.fileScope ?? [])}, ${jsonbLiteral(bundle.symbolScope ?? [])}, ${jsonbLiteral(bundle.commands)}, ${jsonbLiteral(bundle.proofHandles)}, ${textLiteral(bundle.freshness)}, ${textLiteral(bundle.cacheKey ?? `bundle:${bundle.id}`)}, ${jsonbLiteral(metadata)}, ${textLiteral(bundle.createdAt ?? timestamp)}, ${textLiteral(bundle.expiresAt)})`;
      }),
      ...state.bundleCache.map(
        (entry) =>
          `INSERT INTO bundle_cache_entries (id, cache_key, bundle_id, freshness, hit_count, created_at, updated_at, expires_at) VALUES (${textLiteral(`cache_${entry.key}`)}, ${textLiteral(entry.key)}, ${textLiteral(entry.bundleId)}, ${textLiteral(entry.freshness)}, 0, ${textLiteral(timestamp)}, ${textLiteral(timestamp)}, NULL)`
      ),
      ...state.receipts.map((receipt) => {
        const durableReceipt = receipt as ReceiptRecord & Record<string, unknown>;
        return `INSERT INTO agent_receipts (id, external_ref, repo_ids, bundle_id, from_role, from_run_id, type, summary, payload, status, created_at, updated_at) VALUES (${textLiteral(receipt.id)}, ${jsonbLiteral({ agent: receipt.agent })}, ${jsonbLiteral(Array.isArray(durableReceipt.repoIds) ? durableReceipt.repoIds : [])}, ${textLiteral(receipt.bundleId)}, ${textLiteral(String(durableReceipt.fromRole ?? 'agent'))}, NULL, ${textLiteral(String(durableReceipt.type ?? 'workflow_note'))}, ${textLiteral(receipt.summary)}, ${jsonbLiteral(
          {
            repoIds: Array.isArray(durableReceipt.repoIds) ? durableReceipt.repoIds : [],
            type: durableReceipt.type ?? 'workflow_note',
            fromRole: durableReceipt.fromRole ?? 'agent',
            data: durableReceipt.payload ?? {},
          }
        )}, ${textLiteral(receipt.status)}, ${textLiteral(String(durableReceipt.createdAt ?? timestamp))}, ${textLiteral(String(durableReceipt.updatedAt ?? timestamp))})`;
      }),
      ...state.freshnessEvents.map(
        (event) =>
          `INSERT INTO freshness_events (id, repo_id, changed_files, created_at) VALUES (${textLiteral(event.id)}, ${textLiteral(event.repoId)}, ${jsonbLiteral(event.files)}, ${textLiteral(event.createdAt)})`
      ),
      ...state.freshnessJobs.map(
        (job) =>
          `INSERT INTO recompute_jobs (id, repo_id, event_id, changed_files, status, created_at, updated_at) VALUES (${textLiteral(job.id)}, ${textLiteral(job.repoId)}, ${textLiteral(job.eventId)}, ${jsonbLiteral(job.files)}, ${textLiteral(job.status)}, ${textLiteral(job.createdAt)}, ${textLiteral(job.updatedAt)})`
      ),
      'COMMIT',
    ];

    await this.exec([], { stdin: `${statements.join(';\n')};\n` });
  }

  private async ensureSeedState(): Promise<boolean> {
    if (await this.hasSeedData()) {
      return false;
    }

    await this.saveState(createSeedState());
    return true;
  }

  private async hasSeedData(): Promise<boolean> {
    return (
      (await this.queryText('SELECT EXISTS (SELECT 1 FROM repositories LIMIT 1)')).trim() === 't'
    );
  }

  private async ensureSchema(): Promise<boolean> {
    if (this.schemaReady) {
      return false;
    }

    const schemaExists =
      (await this.queryText("SELECT to_regclass('public.repositories') IS NOT NULL")).trim() ===
      't';
    if (!schemaExists) {
      const migrationSql = await readFile(
        path.join(this.options.cwd, 'migrations', MIGRATION_NAME),
        'utf8'
      );
      for (const statement of splitSqlStatements(migrationSql)) {
        await this.exec(['-c', statement]);
      }
    }

    this.schemaReady = true;
    return !schemaExists;
  }

  private async queryJson<T>(sql: string): Promise<T> {
    const raw = await this.queryText(sql);
    return JSON.parse(raw) as T;
  }

  private async queryText(sql: string): Promise<string> {
    return this.exec(['-At', '-c', sql]);
  }

  private async exec(args: string[], options?: { stdin?: string }): Promise<string> {
    const [command, ...commandArgs] = psqlPrefix ?? [];
    if (!command) {
      throw new Error('Expected a PostgreSQL client.');
    }

    const child = spawn(
      command,
      [...commandArgs, '-d', this.options.databaseUrl, '-v', 'ON_ERROR_STOP=1', ...args],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      }
    );

    if (options?.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`psql terminated with signal ${signal}`));
          return;
        }

        resolve(code ?? 1);
      });
    });

    if (exitCode !== 0) {
      throw new Error(Buffer.concat(stderr).toString('utf8').trim() || 'psql command failed');
    }

    return Buffer.concat(stdout).toString('utf8').trim();
  }
}
