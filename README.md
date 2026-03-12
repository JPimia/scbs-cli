# SCBS 0.7

SCBS is the Shared Context Build System: a standalone context service for agentic systems that need
durable repository context, bundle planning, receipt handling, lifecycle events, and operator
visibility.

On branch `scbs-0.7`, SCBS is in a usable service state for plugging into an agent swarm.

It gives you:
- a standalone HTTP API
- a PostgreSQL-backed durable runtime
- bundle planning and freshness tracking
- receipt submission and validation
- bundle review and receipt review history
- durable outbox events and webhook delivery
- scoped access tokens for admin and repo APIs
- audit logs for admin and repository actions

This is not the full `1.0` product described in `SCBS.md`, but it is ready to integrate as a real
shared service.

## What To Use This For

Use SCBS when your swarm needs a system of record for:
- registered repositories
- current derived context about those repositories
- planned task bundles for agents
- receipts about what agents did
- freshness and recomputation state
- event notifications to outside systems
- auditability around service actions

Practical examples:
- a coordinator asks SCBS for a bundle before dispatching work
- builders submit receipts back into SCBS after they finish
- ops tooling listens to webhook events for receipt validation or bundle lifecycle changes
- humans inspect bundle review history and audit logs when the swarm behaves unexpectedly

## Current 0.7 Surface

SCBS 0.7 should be thought of as:
- usable by an agent swarm now
- reviewable by operators
- integratable with external systems
- auditable at the service boundary

The main service additions in 0.7 are:
- bundle visibility and planner diagnostics over admin APIs
- receipt review history over admin APIs
- durable lifecycle outbox events
- webhook subscriptions and webhook delivery jobs
- scoped access tokens
- audit records for admin and repo requests

## Requirements

- Node `22+`
- Bun `1.3+`
- PostgreSQL if you want a real durable service

Workspace basics:
- TypeScript monorepo
- Bun scripts at the repo root
- OpenAPI artifacts checked into `openapi/`

## Quick Start

If you want SCBS as a real swarm service, use PostgreSQL.

### 1. Start PostgreSQL

```bash
docker compose -f compose.scbs-postgres.yaml up -d
```

Default local database target:

```bash
export SCBS_STORAGE_ADAPTER=postgres
export SCBS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/scbs
```

### 2. Initialize and migrate SCBS

```bash
bun run cli -- init --json
bun run cli -- migrate --json
```

### 3. Start the service

```bash
bun run cli -- serve --json
```

By default, the service is exposed at:

```text
http://127.0.0.1:8791
```

### 4. Start the worker

SCBS has durable jobs for:
- freshness recompute
- repo scan
- receipt validation
- webhook delivery

Run the persistent worker loop against the same durable store:

```bash
bun run cli -- freshness worker --watch --poll-interval-ms 1000 --json
```

### 5. Smoke-test the deployment path

```bash
bun run smoke:postgres-service
```

That smoke path verifies:
- migration
- health
- repo registration
- queued background work
- real HTTP serve
- admin diagnostics and job endpoints

## Agent Swarm Integration Path

This is the recommended integration order.

### Step 1. Bootstrap the first access token

Admin and repo HTTP routes are scope-protected with `x-scbs-token`.

Important 0.7 behavior:
- before any token exists, SCBS allows bootstrap creation of the first token
- after that, use the issued token for admin and repo calls

Create a first operator token:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/admin/access-tokens \
  -H 'content-type: application/json' \
  -d '{
    "label": "swarm-operator",
    "scopes": ["admin:read", "admin:write", "repo:read", "repo:write"]
  }'
```

Save the returned `token` value:

```bash
export SCBS_TOKEN='<returned token>'
```

### Step 2. Register repositories

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/repos/register \
  -H "x-scbs-token: $SCBS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "name": "my-repo",
    "path": "/absolute/path/to/my-repo"
  }'
```

List repos:

```bash
curl -sS http://127.0.0.1:8791/api/v1/repos \
  -H "x-scbs-token: $SCBS_TOKEN"
```

### Step 3. Scan or queue repository work

Immediate scan:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/repos/repo_my-repo/scan \
  -H "x-scbs-token: $SCBS_TOKEN"
```

Queued scan:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/repos/repo_my-repo/scan \
  -H "x-scbs-token: $SCBS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"queue": true}'
```

Report file changes:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/repos/repo_my-repo/changes \
  -H "x-scbs-token: $SCBS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "files": ["src/index.ts", "src/service.ts"]
  }'
```

### Step 4. Plan bundles for agents

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/bundles/plan \
  -H 'content-type: application/json' \
  -d '{
    "task": "Investigate stale receipt handling",
    "taskTitle": "Investigate stale receipt handling",
    "repoIds": ["repo_my-repo"],
    "fileScope": ["src/index.ts"],
    "symbolScope": ["validateReceipt"]
  }'
```

The response gives the bundle id and selected context for your worker agent.

### Step 5. Submit receipts from agents

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/receipts \
  -H 'content-type: application/json' \
  -d '{
    "bundle": "bundle_investigate-stale-receipt-handling",
    "agent": "builder-1",
    "summary": "Validated the failing receipt path and prepared a fix."
  }'
```

Validate immediately:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/receipts/receipt_builder-1-validated-the-failing-receipt-path-and-prepared-a-fix/validate
```

Or queue validation:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/receipts/<receipt-id>/validate \
  -H 'content-type: application/json' \
  -d '{"queue": true}'
```

### Step 6. Inspect review state

Bundle review:

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/bundles \
  -H "x-scbs-token: $SCBS_TOKEN"
```

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/bundles/<bundle-id>/review \
  -H "x-scbs-token: $SCBS_TOKEN"
```

Receipt review history:

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/receipts/history \
  -H "x-scbs-token: $SCBS_TOKEN"
```

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/receipts/<receipt-id>/history \
  -H "x-scbs-token: $SCBS_TOKEN"
```

### Step 7. Wire webhooks

Create a webhook subscription:

```bash
curl -sS -X POST http://127.0.0.1:8791/api/v1/admin/webhooks \
  -H "x-scbs-token: $SCBS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "label": "swarm-events",
    "url": "http://127.0.0.1:9900/scbs-events",
    "events": ["bundle.planned", "receipt.validated", "receipt.rejected", "repo.changed"]
  }'
```

List outbox events:

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/outbox \
  -H "x-scbs-token: $SCBS_TOKEN"
```

Show one event:

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/outbox/<event-id> \
  -H "x-scbs-token: $SCBS_TOKEN"
```

Webhook deliveries are driven by the same durable worker loop, so keep the worker process running.

### Step 8. Inspect audit state

```bash
curl -sS http://127.0.0.1:8791/api/v1/admin/audit \
  -H "x-scbs-token: $SCBS_TOKEN"
```

This is where you inspect:
- who used admin routes
- who changed repo state
- denied requests due to missing scopes

## HTTP API Overview

Useful system routes:
- `GET /health`
- `GET /api/v1`

Useful repo routes:
- `GET /api/v1/repos`
- `POST /api/v1/repos/register`
- `GET /api/v1/repos/:id`
- `POST /api/v1/repos/:id/scan`
- `POST /api/v1/repos/:id/changes`

Useful planning and receipt routes:
- `POST /api/v1/bundles/plan`
- `GET /api/v1/bundles/:id`
- `GET /api/v1/bundles/:id/freshness`
- `POST /api/v1/bundles/:id/expire`
- `POST /api/v1/receipts`
- `GET /api/v1/receipts`
- `GET /api/v1/receipts/:id`
- `POST /api/v1/receipts/:id/validate`
- `POST /api/v1/receipts/:id/reject`

Useful admin routes:
- `GET /api/v1/admin/diagnostics`
- `GET /api/v1/admin/jobs`
- `GET /api/v1/admin/jobs/:id`
- `POST /api/v1/admin/jobs/:id/retry`
- `POST /api/v1/admin/worker/drain`
- `GET /api/v1/admin/bundles`
- `GET /api/v1/admin/bundles/:id/review`
- `GET /api/v1/admin/receipts/history`
- `GET /api/v1/admin/receipts/:id/history`
- `GET /api/v1/admin/outbox`
- `GET /api/v1/admin/outbox/:id`
- `GET /api/v1/admin/webhooks`
- `POST /api/v1/admin/webhooks`
- `GET /api/v1/admin/access-tokens`
- `POST /api/v1/admin/access-tokens`
- `GET /api/v1/admin/audit`

The checked-in OpenAPI contract is here:
- `openapi/scbs-v1.openapi.json`
- `openapi/scbs-v1.openapi.yaml`

## CLI Overview

The CLI is mainly for local operation and service ownership.

Common commands:

```bash
bun run cli -- init --json
bun run cli -- migrate --json
bun run cli -- serve --json
bun run cli -- health --json
bun run cli -- doctor --json
bun run cli -- admin diagnostics --json
bun run cli -- admin jobs list --json
bun run cli -- admin jobs show <job-id> --json
bun run cli -- admin jobs retry <job-id> --json
bun run cli -- freshness worker --watch --json
```

Repo and planning commands:

```bash
bun run cli -- repo register --name my-repo --path /absolute/path/to/repo --json
bun run cli -- repo list --json
bun run cli -- repo scan repo_my-repo --queue --json
bun run cli -- repo changes repo_my-repo --files src/index.ts,src/service.ts --json
bun run cli -- bundle plan --task "Investigate receipt path" --repo repo_my-repo --file-scope src/index.ts --json
bun run cli -- receipt submit --bundle <bundle-id> --agent builder-1 --summary "Investigated bug" --json
```

## Authentication Model In 0.7

SCBS 0.7 uses a lightweight scoped token model.

Scopes:
- `admin:read`
- `admin:write`
- `repo:read`
- `repo:write`

Behavior:
- admin routes require admin scopes
- repo routes require repo scopes
- bundle planning and receipt submission routes are currently open service routes
- successful and denied admin/repo requests are written to the audit log

This is intentionally lightweight. It is meant to make SCBS safe enough to run as a shared swarm
service now, not to be the final 1.0 identity system.

## Operational Notes

- keep the worker running if you rely on queued repo scans, queued receipt validation, or webhook delivery
- use PostgreSQL for real swarm usage; local JSON is useful for bootstrap and local experiments
- treat the admin APIs as the main operator surface for review, queue, event, and audit inspection
- the HTTP API is the best integration boundary for the swarm; the CLI is for operators

## Verification

Run the main quality gates from the repo root:

```bash
bun test
bun run lint
bun run typecheck
bun run verify:openapi
```

Optional PostgreSQL verification:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
bun run verify:postgres
```

## Honest Status

SCBS 0.7 is:
- operational
- durable
- reviewable
- auditable
- integratable

SCBS 0.7 is not yet:
- full `1.0`
- a polished multi-tenant product
- a complete UI/dashboard product

But if your goal is to plug SCBS into a real agent swarm and start benefiting from it now, this
branch is in that state.
