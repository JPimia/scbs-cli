# SCBS

SCBS is the Shared Context Build System: a context compiler and bundle planner for AI agents operating across one or more repositories.

This worktree provides the root repository scaffold plus the `scbs` CLI MVP surface described in `SCBS.md`.

## Workspace

- Runtime: Node 22+
- Package manager layout: pnpm workspace
- Local task runner: Bun
- Language: TypeScript (strict)
- Tests: Vitest
- Linting/formatting: Biome

## Commands

Run the workspace checks from the repository root:

```bash
bun test
bun run lint
bun run typecheck
bun run test:packages
bun run verify:openapi
```

Run the full root verification lane:

```bash
bun run verify
```

PostgreSQL-backed verification is wired separately because it requires a reachable PostgreSQL instance plus either a
local `psql` client or Docker:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
bun run verify:postgres
```

That command creates a temporary database, applies `migrations/0001_init.sql`, verifies the expected tables and
indexes, and drops the temporary database.

## Operational PostgreSQL Launch

Bring up a local PostgreSQL instance for SCBS:

```bash
docker compose -f compose.scbs-postgres.yaml up -d
```

Start SCBS against PostgreSQL:

```bash
export SCBS_STORAGE_ADAPTER=postgres
export SCBS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/scbs
bun run cli -- migrate --json
bun run cli -- serve --json
```

Run the persistent background worker against the same durable store:

```bash
bun run cli -- freshness worker --watch --json
```

Run the checked-in smoke lane for that deployment path:

```bash
bun run smoke:postgres-service
```

That smoke lane runs `migrate`, registers a smoke repo, queues and drains a real background job, starts the HTTP
`serve` process against PostgreSQL, verifies the admin diagnostics/job endpoints, and shuts the service down cleanly.

Run the CLI locally:

```bash
bun run cli -- health
bun run cli -- repo list --json
```

## CLI surface

The `scbs` binary exposes the service, repository, fact, claim, view, bundle, freshness, and receipt commands from the MVP spec. Every command accepts `--json`.

The current CLI implementation stays intentionally thin. It now persists local artifact state through a durable JSON adapter under `.scbs/state.json`, while still keeping the command layer isolated behind the `apps/cli` service interface.

Operator-oriented commands now include:

```bash
bun run cli -- admin diagnostics --json
bun run cli -- admin jobs list --json
bun run cli -- admin jobs show <job-id> --json
bun run cli -- admin jobs retry <job-id> --json
bun run cli -- freshness worker --watch --poll-interval-ms 1000 --json
```

The standalone HTTP surface exposes the same service-operations shape over:
- `GET /api/v1/admin/diagnostics`
- `GET /api/v1/admin/jobs`
- `GET /api/v1/admin/jobs/:id`
- `POST /api/v1/admin/jobs/:id/retry`
- `POST /api/v1/admin/worker/drain`

## Verification coverage

- `bun test` runs the Bun-native unit suites across the workspace.
- `bun run test:packages` runs the Vitest suites in `apps/cli` and `apps/server`, including the checked-in OpenAPI artifact parity assertions.
- `bun run verify:openapi` performs an explicit root contract check by regenerating the server OpenAPI JSON and YAML and comparing them to the tracked artifacts under `openapi/`.
- `bun run verify:postgres` exercises the checked-in PostgreSQL migration against a real PostgreSQL database.
- `bun run verify:ci` is the CI lane entrypoint and adds PostgreSQL verification to the local lane.
