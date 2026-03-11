import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const databaseUrlValue = process.env.DATABASE_URL;

if (!databaseUrlValue) {
  console.error('DATABASE_URL is required for PostgreSQL verification.');
  process.exit(1);
}

const databaseUrl = new URL(databaseUrlValue);
const tempDatabaseName = `scbs_verify_${randomUUID().replaceAll('-', '_')}`;
const migrationPath = path.join(process.cwd(), 'migrations', '0001_init.sql');
const migrationSql = await readFile(migrationPath, 'utf8');

const expectedTables = [
  'agent_receipts',
  'bundle_cache_entries',
  'claim_records',
  'dependency_edges',
  'fact_records',
  'file_records',
  'freshness_recompute_jobs',
  'repositories',
  'symbol_records',
  'task_bundles',
  'view_records',
];

const expectedIndexes = [
  'idx_agent_receipts_status',
  'idx_claim_records_repo_id',
  'idx_dependency_edges_repo_id',
  'idx_fact_records_repo_id',
  'idx_file_records_repo_id',
  'idx_freshness_recompute_jobs_bundle_id',
  'idx_freshness_recompute_jobs_status_requested_at',
  'idx_symbol_records_repo_id',
  'idx_task_bundles_cache_key',
  'idx_view_records_repo_id',
];

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

const createDatabaseUrl = new URL(databaseUrl);
createDatabaseUrl.pathname = `/${tempDatabaseName}`;

const hasLocalPsql = spawnSync('bash', ['-lc', 'command -v psql >/dev/null 2>&1']).status === 0;
const hasDocker = spawnSync('bash', ['-lc', 'command -v docker >/dev/null 2>&1']).status === 0;

if (!hasLocalPsql && !hasDocker) {
  console.error('PostgreSQL verification requires either a local "psql" client or Docker.');
  process.exit(1);
}

const psqlPrefix = hasLocalPsql
  ? ['psql']
  : ['docker', 'run', '--rm', '--network', 'host', 'postgres:16', 'psql'];

const exec = async (args: string[], options?: { env?: NodeJS.ProcessEnv; stdin?: string }) => {
  const [command, ...commandArgs] = args;

  if (!command) {
    throw new Error('Expected a command to execute.');
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, ...options?.env },
    });

    if (options?.stdin) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }

    child.once('error', reject);
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        reject(new Error(`${args.join(' ')} terminated with signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${args.join(' ')}`);
  }
};

const query = async (sql: string, url: string) =>
  await new Promise<string>((resolve, reject) => {
    const [command, ...commandArgs] = psqlPrefix;
    if (!command) {
      reject(new Error('Expected a psql command.'));
      return;
    }

    const child = spawn(
      command,
      [...commandArgs, '-d', url, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
      {
        env: process.env,
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        reject(new Error(`psql query terminated with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `psql exited with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });
  });

try {
  await exec([
    ...psqlPrefix,
    '-d',
    databaseUrl.toString(),
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `CREATE DATABASE ${quoteIdentifier(tempDatabaseName)};`,
  ]);

  await exec([...psqlPrefix, '-d', createDatabaseUrl.toString(), '-v', 'ON_ERROR_STOP=1'], {
    stdin: migrationSql,
  });

  const tableResult = await query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
    createDatabaseUrl.toString()
  );
  const indexResult = await query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;",
    createDatabaseUrl.toString()
  );

  const actualTables = tableResult.split('\n').filter(Boolean);
  const actualIndexes = indexResult.split('\n').filter(Boolean);

  for (const tableName of expectedTables) {
    if (!actualTables.includes(tableName)) {
      throw new Error(
        `Migration verification failed: expected table "${tableName}" was not created.`
      );
    }
  }

  for (const indexName of expectedIndexes) {
    if (!actualIndexes.includes(indexName)) {
      throw new Error(
        `Migration verification failed: expected index "${indexName}" was not created.`
      );
    }
  }

  console.log(`PostgreSQL verification passed for ${migrationPath}.`);
} finally {
  await exec([
    ...psqlPrefix,
    '-d',
    databaseUrl.toString(),
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${tempDatabaseName}' AND pid <> pg_backend_pid();`,
      `DROP DATABASE IF EXISTS ${quoteIdentifier(tempDatabaseName)};`,
    ].join(' '),
  ]).catch((error) => {
    console.error(`Failed to clean up temporary database ${tempDatabaseName}:`, error);
    process.exitCode = 1;
  });
}
