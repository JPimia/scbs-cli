import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentReceipt,
  BundleCacheEntry,
  ClaimRecord,
  DependencyEdge,
  FactRecord,
  FileRecord,
  RepositoryRef,
  SymbolRecord,
  TaskBundle,
  ViewRecord,
} from '../../../protocol/src/index';

import { type CoreStore, createMemoryStore } from './memory-store';

type SqlValue = string | number | boolean | null;

interface SqlStatement {
  query(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): Promise<Array<Record<string, unknown>>>;
  close(options?: { timeout?: number }): Promise<void>;
}

interface SqlConstructor {
  new (connectionString: string): SqlStatement;
}

export interface PostgresStoreHandle {
  store: CoreStore;
  flush(): Promise<void>;
  close(): Promise<void>;
  isDirty(): boolean;
}

export interface PostgresStoreOptions {
  connectionString: string;
}

const TABLES = {
  repositories: 'repositories',
  files: 'file_records',
  symbols: 'symbol_records',
  edges: 'dependency_edges',
  facts: 'fact_records',
  claims: 'claim_records',
  views: 'view_records',
  bundles: 'task_bundles',
  bundleCache: 'bundle_cache_entries',
  receipts: 'agent_receipts',
} as const;

const MUTATION_SQL = {
  begin: 'BEGIN',
  commit: 'COMMIT',
  rollback: 'ROLLBACK',
  deleteReceipts: `DELETE FROM ${TABLES.receipts}`,
  deleteBundleCache: `DELETE FROM ${TABLES.bundleCache}`,
  deleteBundles: `DELETE FROM ${TABLES.bundles}`,
  deleteViews: `DELETE FROM ${TABLES.views}`,
  deleteClaims: `DELETE FROM ${TABLES.claims}`,
  deleteFacts: `DELETE FROM ${TABLES.facts}`,
  deleteEdges: `DELETE FROM ${TABLES.edges}`,
  deleteSymbols: `DELETE FROM ${TABLES.symbols}`,
  deleteFiles: `DELETE FROM ${TABLES.files}`,
  deleteRepositories: `DELETE FROM ${TABLES.repositories}`,
} as const;

const migrationTableName = '_scbs_migrations';

async function loadSqlConstructor(): Promise<SqlConstructor> {
  const dynamicImport = Function('return import("bun")') as () => Promise<unknown>;
  const module = (await dynamicImport()) as { SQL?: SqlConstructor };
  if (!module.SQL) {
    throw new Error('Bun SQL is unavailable in this runtime.');
  }
  return module.SQL;
}

async function createSql(connectionString: string): Promise<SqlStatement> {
  const SQL = await loadSqlConstructor();
  return new SQL(connectionString);
}

async function executeRaw(sql: SqlStatement, statement: string): Promise<void> {
  await sql.query([statement] as unknown as TemplateStringsArray);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${field} to be a string.`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function cloneStore(store: CoreStore): CoreStore {
  return JSON.parse(JSON.stringify(store)) as CoreStore;
}

function createTrackedValue<T extends object>(
  value: T,
  markDirty: () => void,
  seen: WeakMap<object, object>
): T {
  if (seen.has(value)) {
    return seen.get(value) as T;
  }

  const proxy = new Proxy(value, {
    get(target, property, receiver) {
      const nextValue = Reflect.get(target, property, receiver);
      if (typeof nextValue === 'object' && nextValue !== null) {
        return createTrackedValue(nextValue as object, markDirty, seen);
      }
      return nextValue;
    },
    set(target, property, nextValue, receiver) {
      markDirty();
      return Reflect.set(target, property, nextValue, receiver);
    },
    deleteProperty(target, property) {
      markDirty();
      return Reflect.deleteProperty(target, property);
    },
  });

  seen.set(value, proxy);
  return proxy;
}

function createTrackedStore(snapshot: CoreStore): { store: CoreStore; isDirty: () => boolean } {
  let dirty = false;
  const seen = new WeakMap<object, object>();
  const markDirty = () => {
    dirty = true;
  };

  const trackedState = cloneStore(snapshot);
  const store = {} as CoreStore;
  const keys = Object.keys(trackedState) as Array<keyof CoreStore>;

  for (const key of keys) {
    let currentValue = createTrackedValue(trackedState[key], markDirty, seen);
    Object.defineProperty(store, key, {
      enumerable: true,
      configurable: false,
      get() {
        return currentValue;
      },
      set(nextValue: CoreStore[typeof key]) {
        dirty = true;
        currentValue = createTrackedValue(nextValue, markDirty, seen);
      },
    });
  }

  return {
    store,
    isDirty: () => dirty,
  };
}

async function loadSnapshot(sql: SqlStatement): Promise<CoreStore> {
  const [
    repositories,
    files,
    symbols,
    edges,
    facts,
    claims,
    views,
    bundles,
    bundleCache,
    receipts,
  ] = await Promise.all([
    sql.query`SELECT * FROM repositories ORDER BY created_at, id`,
    sql.query`SELECT * FROM file_records ORDER BY repo_id, path`,
    sql.query`SELECT * FROM symbol_records ORDER BY repo_id, file_id, name`,
    sql.query`SELECT * FROM dependency_edges ORDER BY repo_id, from_id, to_id, id`,
    sql.query`SELECT * FROM fact_records ORDER BY repo_id, created_at, id`,
    sql.query`SELECT * FROM claim_records ORDER BY repo_id, created_at, id`,
    sql.query`SELECT * FROM view_records ORDER BY repo_id, type, key`,
    sql.query`SELECT * FROM task_bundles ORDER BY created_at, id`,
    sql.query`SELECT * FROM bundle_cache_entries ORDER BY created_at, id`,
    sql.query`SELECT * FROM agent_receipts ORDER BY created_at, id`,
  ]);

  return createMemoryStore({
    repositories: repositories.map(
      (row): RepositoryRef => ({
        id: requiredString(row.id, 'repositories.id'),
        name: requiredString(row.name, 'repositories.name'),
        rootPath: optionalString(row.root_path),
        remoteUrl: optionalString(row.remote_url),
        defaultBranch: optionalString(row.default_branch),
        provider: optionalString(row.provider),
        projectKey: optionalString(row.project_key),
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
        createdAt: requiredString(row.created_at, 'repositories.created_at'),
        updatedAt: requiredString(row.updated_at, 'repositories.updated_at'),
      })
    ),
    files: files.map(
      (row): FileRecord => ({
        id: requiredString(row.id, 'file_records.id'),
        repoId: requiredString(row.repo_id, 'file_records.repo_id'),
        path: requiredString(row.path, 'file_records.path'),
        language: optionalString(row.language),
        kind: optionalString(row.kind),
        hash: requiredString(row.hash, 'file_records.hash'),
        sizeBytes: optionalNumber(row.size_bytes),
        exists: optionalBoolean(row.exists) ?? true,
        versionStamp: requiredString(row.version_stamp, 'file_records.version_stamp'),
        lastSeenAt: requiredString(row.last_seen_at, 'file_records.last_seen_at'),
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
      })
    ),
    symbols: symbols.map(
      (row): SymbolRecord => ({
        id: requiredString(row.id, 'symbol_records.id'),
        repoId: requiredString(row.repo_id, 'symbol_records.repo_id'),
        fileId: requiredString(row.file_id, 'symbol_records.file_id'),
        name: requiredString(row.name, 'symbol_records.name'),
        kind: requiredString(row.kind, 'symbol_records.kind'),
        exportName: optionalString(row.export_name),
        signature: optionalString(row.signature),
        anchor: parseJson<SymbolRecord['anchor']>(row.anchor, {
          repoId: '',
          filePath: '',
          fileHash: '',
        }),
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
      })
    ),
    edges: edges.map(
      (row): DependencyEdge => ({
        id: requiredString(row.id, 'dependency_edges.id'),
        repoId: requiredString(row.repo_id, 'dependency_edges.repo_id'),
        fromType: requiredString(
          row.from_type,
          'dependency_edges.from_type'
        ) as DependencyEdge['fromType'],
        fromId: requiredString(row.from_id, 'dependency_edges.from_id'),
        toType: requiredString(row.to_type, 'dependency_edges.to_type') as DependencyEdge['toType'],
        toId: requiredString(row.to_id, 'dependency_edges.to_id'),
        edgeType: requiredString(row.edge_type, 'dependency_edges.edge_type'),
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
      })
    ),
    facts: facts.map(
      (row): FactRecord => ({
        id: requiredString(row.id, 'fact_records.id'),
        repoId: requiredString(row.repo_id, 'fact_records.repo_id'),
        type: requiredString(row.type, 'fact_records.type'),
        subjectType: requiredString(
          row.subject_type,
          'fact_records.subject_type'
        ) as FactRecord['subjectType'],
        subjectId: requiredString(row.subject_id, 'fact_records.subject_id'),
        value: parseJson<Record<string, unknown>>(row.value, {}),
        anchors: parseJson(row.anchors, []),
        versionStamp: requiredString(row.version_stamp, 'fact_records.version_stamp'),
        freshness: requiredString(
          row.freshness,
          'fact_records.freshness'
        ) as FactRecord['freshness'],
        createdAt: requiredString(row.created_at, 'fact_records.created_at'),
        updatedAt: requiredString(row.updated_at, 'fact_records.updated_at'),
      })
    ),
    claims: claims.map(
      (row): ClaimRecord => ({
        id: requiredString(row.id, 'claim_records.id'),
        repoId: requiredString(row.repo_id, 'claim_records.repo_id'),
        text: requiredString(row.text, 'claim_records.text'),
        type: requiredString(row.type, 'claim_records.type') as ClaimRecord['type'],
        confidence: Number(row.confidence),
        trustTier: requiredString(
          row.trust_tier,
          'claim_records.trust_tier'
        ) as ClaimRecord['trustTier'],
        factIds: parseJson<string[]>(row.fact_ids, []),
        anchors: parseJson(row.anchors, []),
        freshness: requiredString(
          row.freshness,
          'claim_records.freshness'
        ) as ClaimRecord['freshness'],
        invalidationKeys: parseJson<string[]>(row.invalidation_keys, []),
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
        createdAt: requiredString(row.created_at, 'claim_records.created_at'),
        updatedAt: requiredString(row.updated_at, 'claim_records.updated_at'),
      })
    ),
    views: views.map(
      (row): ViewRecord => ({
        id: requiredString(row.id, 'view_records.id'),
        repoId: requiredString(row.repo_id, 'view_records.repo_id'),
        type: requiredString(row.type, 'view_records.type') as ViewRecord['type'],
        key: requiredString(row.key, 'view_records.key'),
        title: requiredString(row.title, 'view_records.title'),
        summary: requiredString(row.summary, 'view_records.summary'),
        claimIds: parseJson<string[]>(row.claim_ids, []),
        fileScope: parseJson<string[] | undefined>(row.file_scope, undefined),
        symbolScope: parseJson<string[] | undefined>(row.symbol_scope, undefined),
        freshness: requiredString(
          row.freshness,
          'view_records.freshness'
        ) as ViewRecord['freshness'],
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
        createdAt: requiredString(row.created_at, 'view_records.created_at'),
        updatedAt: requiredString(row.updated_at, 'view_records.updated_at'),
      })
    ),
    bundles: bundles.map(
      (row): TaskBundle => ({
        id: requiredString(row.id, 'task_bundles.id'),
        requestId: requiredString(row.request_id, 'task_bundles.request_id'),
        repoIds: parseJson<string[]>(row.repo_ids, []),
        summary: requiredString(row.summary, 'task_bundles.summary'),
        selectedViewIds: parseJson<string[]>(row.selected_view_ids, []),
        selectedClaimIds: parseJson<string[]>(row.selected_claim_ids, []),
        fileScope: parseJson<string[]>(row.file_scope, []),
        symbolScope: parseJson<string[]>(row.symbol_scope, []),
        commands: parseJson<string[]>(row.commands, []),
        proofHandles: parseJson(row.proof_handles, []),
        freshness: requiredString(
          row.freshness,
          'task_bundles.freshness'
        ) as TaskBundle['freshness'],
        cacheKey: optionalString(row.cache_key),
        metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
        createdAt: requiredString(row.created_at, 'task_bundles.created_at'),
        expiresAt: optionalString(row.expires_at),
      })
    ),
    bundleCache: bundleCache.map(
      (row): BundleCacheEntry => ({
        id: requiredString(row.id, 'bundle_cache_entries.id'),
        cacheKey: requiredString(row.cache_key, 'bundle_cache_entries.cache_key'),
        bundleId: requiredString(row.bundle_id, 'bundle_cache_entries.bundle_id'),
        freshness: requiredString(
          row.freshness,
          'bundle_cache_entries.freshness'
        ) as BundleCacheEntry['freshness'],
        hitCount: Number(row.hit_count),
        createdAt: requiredString(row.created_at, 'bundle_cache_entries.created_at'),
        updatedAt: requiredString(row.updated_at, 'bundle_cache_entries.updated_at'),
        expiresAt: optionalString(row.expires_at),
      })
    ),
    receipts: receipts.map(
      (row): AgentReceipt => ({
        id: requiredString(row.id, 'agent_receipts.id'),
        externalRef: parseJson(row.external_ref, undefined),
        repoIds: parseJson<string[]>(row.repo_ids, []),
        bundleId: optionalString(row.bundle_id),
        fromRole: optionalString(row.from_role),
        fromRunId: optionalString(row.from_run_id),
        type: requiredString(row.type, 'agent_receipts.type') as AgentReceipt['type'],
        summary: requiredString(row.summary, 'agent_receipts.summary'),
        payload: parseJson<Record<string, unknown>>(row.payload, {}),
        status: requiredString(row.status, 'agent_receipts.status') as AgentReceipt['status'],
        createdAt: requiredString(row.created_at, 'agent_receipts.created_at'),
        updatedAt: requiredString(row.updated_at, 'agent_receipts.updated_at'),
      })
    ),
  });
}

async function flushSnapshot(sql: SqlStatement, store: CoreStore): Promise<void> {
  const snapshot = cloneStore(store);
  await executeRaw(sql, MUTATION_SQL.begin);
  try {
    await executeRaw(sql, MUTATION_SQL.deleteReceipts);
    await executeRaw(sql, MUTATION_SQL.deleteBundleCache);
    await executeRaw(sql, MUTATION_SQL.deleteBundles);
    await executeRaw(sql, MUTATION_SQL.deleteViews);
    await executeRaw(sql, MUTATION_SQL.deleteClaims);
    await executeRaw(sql, MUTATION_SQL.deleteFacts);
    await executeRaw(sql, MUTATION_SQL.deleteEdges);
    await executeRaw(sql, MUTATION_SQL.deleteSymbols);
    await executeRaw(sql, MUTATION_SQL.deleteFiles);
    await executeRaw(sql, MUTATION_SQL.deleteRepositories);

    for (const repository of snapshot.repositories) {
      await sql.query`
        INSERT INTO repositories (
          id, name, root_path, remote_url, default_branch, provider, project_key, metadata, created_at, updated_at
        ) VALUES (
          ${repository.id},
          ${repository.name},
          ${repository.rootPath ?? null},
          ${repository.remoteUrl ?? null},
          ${repository.defaultBranch ?? null},
          ${repository.provider ?? null},
          ${repository.projectKey ?? null},
          ${JSON.stringify(repository.metadata ?? {})},
          ${repository.createdAt},
          ${repository.updatedAt}
        )
      `;
    }

    for (const file of snapshot.files) {
      await sql.query`
        INSERT INTO file_records (
          id, repo_id, path, language, kind, hash, size_bytes, exists, version_stamp, last_seen_at, metadata
        ) VALUES (
          ${file.id},
          ${file.repoId},
          ${file.path},
          ${file.language ?? null},
          ${file.kind ?? null},
          ${file.hash},
          ${file.sizeBytes ?? null},
          ${file.exists},
          ${file.versionStamp},
          ${file.lastSeenAt},
          ${JSON.stringify(file.metadata ?? {})}
        )
      `;
    }

    for (const symbol of snapshot.symbols) {
      await sql.query`
        INSERT INTO symbol_records (
          id, repo_id, file_id, name, kind, export_name, signature, anchor, metadata
        ) VALUES (
          ${symbol.id},
          ${symbol.repoId},
          ${symbol.fileId},
          ${symbol.name},
          ${symbol.kind},
          ${symbol.exportName ?? null},
          ${symbol.signature ?? null},
          ${JSON.stringify(symbol.anchor)},
          ${JSON.stringify(symbol.metadata ?? {})}
        )
      `;
    }

    for (const edge of snapshot.edges) {
      await sql.query`
        INSERT INTO dependency_edges (
          id, repo_id, from_type, from_id, to_type, to_id, edge_type, metadata
        ) VALUES (
          ${edge.id},
          ${edge.repoId},
          ${edge.fromType},
          ${edge.fromId},
          ${edge.toType},
          ${edge.toId},
          ${edge.edgeType},
          ${JSON.stringify(edge.metadata ?? {})}
        )
      `;
    }

    for (const fact of snapshot.facts) {
      await sql.query`
        INSERT INTO fact_records (
          id, repo_id, type, subject_type, subject_id, value, anchors, version_stamp, freshness, created_at, updated_at
        ) VALUES (
          ${fact.id},
          ${fact.repoId},
          ${fact.type},
          ${fact.subjectType},
          ${fact.subjectId},
          ${JSON.stringify(fact.value)},
          ${JSON.stringify(fact.anchors)},
          ${fact.versionStamp},
          ${fact.freshness},
          ${fact.createdAt},
          ${fact.updatedAt}
        )
      `;
    }

    for (const claim of snapshot.claims) {
      await sql.query`
        INSERT INTO claim_records (
          id, repo_id, text, type, confidence, trust_tier, fact_ids, anchors, freshness, invalidation_keys, metadata, created_at, updated_at
        ) VALUES (
          ${claim.id},
          ${claim.repoId},
          ${claim.text},
          ${claim.type},
          ${claim.confidence},
          ${claim.trustTier},
          ${JSON.stringify(claim.factIds)},
          ${JSON.stringify(claim.anchors)},
          ${claim.freshness},
          ${JSON.stringify(claim.invalidationKeys)},
          ${JSON.stringify(claim.metadata ?? {})},
          ${claim.createdAt},
          ${claim.updatedAt}
        )
      `;
    }

    for (const view of snapshot.views) {
      await sql.query`
        INSERT INTO view_records (
          id, repo_id, type, key, title, summary, claim_ids, file_scope, symbol_scope, freshness, metadata, created_at, updated_at
        ) VALUES (
          ${view.id},
          ${view.repoId},
          ${view.type},
          ${view.key},
          ${view.title},
          ${view.summary},
          ${JSON.stringify(view.claimIds)},
          ${view.fileScope ? JSON.stringify(view.fileScope) : null},
          ${view.symbolScope ? JSON.stringify(view.symbolScope) : null},
          ${view.freshness},
          ${JSON.stringify(view.metadata ?? {})},
          ${view.createdAt},
          ${view.updatedAt}
        )
      `;
    }

    for (const bundle of snapshot.bundles) {
      await sql.query`
        INSERT INTO task_bundles (
          id, request_id, repo_ids, summary, selected_view_ids, selected_claim_ids, file_scope, symbol_scope, commands, proof_handles, freshness, cache_key, metadata, created_at, expires_at
        ) VALUES (
          ${bundle.id},
          ${bundle.requestId},
          ${JSON.stringify(bundle.repoIds)},
          ${bundle.summary},
          ${JSON.stringify(bundle.selectedViewIds)},
          ${JSON.stringify(bundle.selectedClaimIds)},
          ${JSON.stringify(bundle.fileScope)},
          ${JSON.stringify(bundle.symbolScope)},
          ${JSON.stringify(bundle.commands)},
          ${JSON.stringify(bundle.proofHandles)},
          ${bundle.freshness},
          ${bundle.cacheKey ?? null},
          ${JSON.stringify(bundle.metadata ?? {})},
          ${bundle.createdAt},
          ${bundle.expiresAt ?? null}
        )
      `;
    }

    for (const entry of snapshot.bundleCache) {
      await sql.query`
        INSERT INTO bundle_cache_entries (
          id, cache_key, bundle_id, freshness, hit_count, created_at, updated_at, expires_at
        ) VALUES (
          ${entry.id},
          ${entry.cacheKey},
          ${entry.bundleId},
          ${entry.freshness},
          ${entry.hitCount},
          ${entry.createdAt},
          ${entry.updatedAt},
          ${entry.expiresAt ?? null}
        )
      `;
    }

    for (const receipt of snapshot.receipts) {
      await sql.query`
        INSERT INTO agent_receipts (
          id, external_ref, repo_ids, bundle_id, from_role, from_run_id, type, summary, payload, status, created_at, updated_at
        ) VALUES (
          ${receipt.id},
          ${receipt.externalRef ? JSON.stringify(receipt.externalRef) : null},
          ${JSON.stringify(receipt.repoIds)},
          ${receipt.bundleId ?? null},
          ${receipt.fromRole ?? null},
          ${receipt.fromRunId ?? null},
          ${receipt.type},
          ${receipt.summary},
          ${JSON.stringify(receipt.payload)},
          ${receipt.status},
          ${receipt.createdAt},
          ${receipt.updatedAt}
        )
      `;
    }

    await executeRaw(sql, MUTATION_SQL.commit);
  } catch (error) {
    await executeRaw(sql, MUTATION_SQL.rollback);
    throw error;
  }
}

export async function applyPostgresMigrations(
  connectionString: string,
  migrationsPath: string
): Promise<string[]> {
  const sql = await createSql(connectionString);
  try {
    await sql.query`
      CREATE TABLE IF NOT EXISTS _scbs_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const appliedRows = await sql.query`SELECT version FROM _scbs_migrations ORDER BY version`;
    const applied = new Set(
      appliedRows.map((row) => requiredString(row.version, `${migrationTableName}.version`))
    );
    const files = (await readdir(migrationsPath))
      .filter((entry) => entry.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));
    const newlyApplied: string[] = [];

    for (const fileName of files) {
      if (applied.has(fileName)) {
        continue;
      }
      const contents = await readFile(path.join(migrationsPath, fileName), 'utf8');
      await executeRaw(sql, 'BEGIN');
      try {
        await executeRaw(sql, contents);
        await sql.query`
          INSERT INTO _scbs_migrations (version) VALUES (${fileName})
        `;
        await executeRaw(sql, 'COMMIT');
        newlyApplied.push(fileName);
      } catch (error) {
        await executeRaw(sql, 'ROLLBACK');
        throw error;
      }
    }

    return newlyApplied;
  } finally {
    await sql.close();
  }
}

export async function listAppliedPostgresMigrations(connectionString: string): Promise<string[]> {
  const sql = await createSql(connectionString);
  try {
    await sql.query`
      CREATE TABLE IF NOT EXISTS _scbs_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const rows = await sql.query`SELECT version FROM _scbs_migrations ORDER BY version`;
    return rows.map((row) => requiredString(row.version, `${migrationTableName}.version`));
  } finally {
    await sql.close();
  }
}

export async function createPostgresStore(
  options: PostgresStoreOptions
): Promise<PostgresStoreHandle> {
  const sql = await createSql(options.connectionString);
  const snapshot = await loadSnapshot(sql);
  const tracked = createTrackedStore(snapshot);

  return {
    store: tracked.store,
    async flush() {
      if (!tracked.isDirty()) {
        return;
      }
      await flushSnapshot(sql, tracked.store);
    },
    async close() {
      await sql.close();
    },
    isDirty() {
      return tracked.isDirty();
    },
  };
}
