# Mission Control Platform Up Contract

This document turns the Mission Control + SISU + SCBS relationship into an executable startup and
runtime contract.

Use this for:
- local integrated startup
- future platform supervisor implementation
- production deployment design
- wiring SISU requests to SCBS correctly

It is intentionally concrete.

## Goal

When Mission Control launches:
- SISU is available
- SCBS API is available
- SCBS worker is available
- queued work can resume immediately
- a single-agent mode is still possible without the full swarm stack

This means the platform has to define:
- startup order
- env vars
- health checks
- failure policy
- service supervision
- the request/response shapes at the SISU-to-SCBS boundary

## Service Model

Treat these as separate runtime units:
- `postgres`
- `scbs-api`
- `scbs-worker`
- `sisu`
- `mission-control-web`

For local development, they can be launched from one command.

For production, they should usually be supervised as separate long-running services.

## Startup Order

This is the correct startup order.

1. Ensure PostgreSQL is reachable.
2. Run SCBS migrations.
3. Start `scbs-api`.
4. Wait for SCBS health readiness.
5. Start `scbs-worker`.
6. Start `sisu`.
7. Start `mission-control-web`.

Important rule:
- do not start SISU before SCBS is healthy
- do not treat SCBS as ready if only the API is up and the worker is missing

## Required Environment

These are the minimum useful platform env vars.

### Shared platform env

- `MISSION_CONTROL_BASE_URL`
- `SISU_BASE_URL`
- `SCBS_BASE_URL`

### SCBS runtime env

- `SCBS_STORAGE_ADAPTER=postgres`
- `SCBS_DATABASE_URL`

Recommended default local values:

```bash
export SCBS_STORAGE_ADAPTER=postgres
export SCBS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/scbs
export SCBS_BASE_URL=http://127.0.0.1:8791
```

### Auth env

- `SCBS_ADMIN_TOKEN`
- `SCBS_REPO_TOKEN`

In early local development, one token may hold:
- `admin:read`
- `admin:write`
- `repo:read`
- `repo:write`

### Optional launcher env

The first local launcher script in this repo supports:
- `SCBS_PLATFORM_START_POSTGRES=1|0`
- `SCBS_PLATFORM_SKIP_MIGRATE=1|0`
- `SCBS_PLATFORM_REUSE_RUNNING=1|0`
- `SCBS_PLATFORM_POLL_INTERVAL_MS`
- `SISU_START_COMMAND`
- `MISSION_CONTROL_START_COMMAND`

## Health Contract

Mission Control should treat SCBS as available only if these are true:

- `GET /health` succeeds
- `GET /api/v1/admin/diagnostics` succeeds with auth
- queued work is drainable by a worker

Minimum checks:

### SCBS API health

```http
GET /health
```

Expected:
- `200 OK`
- service name and version returned

### SCBS operator health

```http
GET /api/v1/admin/diagnostics
x-scbs-token: <admin token>
```

Expected:
- `200 OK`
- diagnostics block present

### SCBS queue visibility

```http
GET /api/v1/admin/jobs
x-scbs-token: <admin token>
```

Expected:
- `200 OK`
- queue summary present

Important note:
- the current `0.7` HTTP surface does not expose a dedicated worker heartbeat
- for now, operational readiness should treat `scbs-worker` as a supervised required process

## Failure Policy

### If PostgreSQL is down

- `scbs-api` is down or degraded
- `scbs-worker` is down or degraded
- SISU should not accept new work that requires SCBS
- Mission Control should show platform degraded state

### If SCBS API is down

- SISU should not request new bundles
- receipt submission should be considered failed/deferred
- Mission Control should show the platform degraded

### If SCBS worker is down

- queue-backed repo scans stall
- queue-backed receipt validation stalls
- webhook delivery stalls
- Mission Control should show the platform degraded, even if `/health` still works

### If SISU is down

- SCBS may remain healthy and should stay up
- Mission Control may still provide operator views into SCBS

## Supervision Contract

For local development:
- one parent launcher process may supervise child processes
- on shutdown, it should terminate all started child processes cleanly

For production:
- use a real supervisor
  - systemd
  - containers
  - Kubernetes
  - Nomad
  - equivalent

SCBS should not rely on Mission Control browser state to stay alive.

## SISU To SCBS Request Contract

This is the most important runtime boundary.

### 1. Planning bundle request

Recommended SISU route:

```http
POST /api/v1/integrations/sisu/bundle-request
```

Current `0.7` request shape:

```json
{
  "workspaceId": "workspace_alpha",
  "objective": "Investigate stale receipt handling",
  "repositoryIds": ["repo_alpha"],
  "parentContextId": "bundle_parent_123",
  "focusFiles": ["src/receipts/service.ts"],
  "focusSymbols": ["validateReceipt"]
}
```

What SISU should put here:
- `workspaceId`
  - SISU workspace, run group, or team context identifier
- `objective`
  - the current task title
- `repositoryIds`
  - one or more registered SCBS repo ids
- `parentContextId`
  - optional parent bundle id for child work
- `focusFiles`
  - narrowed file scope for a subtask
- `focusSymbols`
  - narrowed symbol scope for a subtask

Current response shape:

```json
{
  "workspaceId": "workspace_alpha",
  "bundleId": "bundle_investigate-stale-receipt-handling",
  "objective": "Bundle for Investigate stale receipt handling",
  "repositoryIds": ["repo_alpha"],
  "viewIds": ["view_system-overview"],
  "freshness": "fresh",
  "parentContextId": "bundle_parent_123",
  "focusFiles": ["src/receipts/service.ts"],
  "focusSymbols": ["validateReceipt"]
}
```

SISU should persist:
- `bundleId`
- `freshness`
- `viewIds`
- any parent-child relationship

### 2. Receipt submission

Recommended SISU route:

```http
POST /api/v1/integrations/sisu/receipt
```

Current `0.7` request shape:

```json
{
  "workspaceId": "workspace_alpha",
  "agent": "builder-1",
  "summary": "Validated the stale receipt path and prepared a fix.",
  "bundleContextId": "bundle_investigate-stale-receipt-handling"
}
```

Current response shape:

```json
{
  "workspaceId": "workspace_alpha",
  "receiptId": "receipt_builder-1-validated-the-stale-receipt-path-and-prepared-a-fix",
  "agent": "builder-1",
  "summary": "Validated the stale receipt path and prepared a fix.",
  "status": "pending",
  "bundleContextId": "bundle_investigate-stale-receipt-handling"
}
```

SISU should persist:
- `receiptId`
- `status`
- `bundleContextId`

If SISU wants immediate validation, it can follow with:

```http
POST /api/v1/receipts/:id/validate
```

If SISU wants queue-backed validation:

```json
{
  "queue": true
}
```

### 3. Repo change reporting

When SISU or Mission Control knows files changed:

```http
POST /api/v1/repos/:id/changes
```

Example:

```json
{
  "files": ["src/index.ts", "src/worker.ts"]
}
```

Use this to keep bundle freshness honest during long-running workflows.

## Mission Control To SCBS Contract

Mission Control should use SCBS for operator-facing surfaces, not for raw planning ownership.

Recommended reads:

- `GET /api/v1/admin/diagnostics`
- `GET /api/v1/admin/jobs`
- `GET /api/v1/admin/bundles`
- `GET /api/v1/admin/bundles/:id/review`
- `GET /api/v1/admin/receipts/history`
- `GET /api/v1/admin/outbox`
- `GET /api/v1/admin/audit`

Recommended writes:

- `POST /api/v1/repos/register`
- `POST /api/v1/admin/webhooks`
- `POST /api/v1/admin/access-tokens`

## Single-Agent Mode

SCBS is usable by one agent only.

That is a valid operating mode.

Single-agent mode means:
- one human or one agent uses SCBS directly
- no SISU process is required
- Mission Control is optional

Recommended single-agent usage:
- register repo
- plan bundle
- inspect bundle
- do work
- submit receipt
- validate receipt

This is valuable for:
- local development
- prompt-driven solo agent workflows
- debugging context behavior before wiring the full swarm

## Platform Up Command Contract

The first local launcher should do this:

1. optionally start PostgreSQL with Docker Compose
2. run `scbs migrate`
3. start `scbs-api`
4. wait for `/health`
5. start `scbs-worker`
6. optionally start `sisu` if `SISU_START_COMMAND` is provided
7. optionally start `mission-control-web` if `MISSION_CONTROL_START_COMMAND` is provided
8. keep all child processes tied to one parent lifecycle

This is a development launcher, not the final production supervisor.

## Recommended Long-Term Packaging

### Primary packaging

Use SCBS as:
- a service
- a container
- a managed platform dependency

### Secondary packaging

Optionally publish:
- `@scbs/sdk`
- `@scbs/client`
- `@scbs/dev-tools`

Use npm packages for:
- API client access
- local bootstrap helpers
- generated types and helper commands

Do not make npm install inside each target project the primary runtime model.

That would fragment the service and break the shared-state architecture.

## Summary

The correct model is:
- Mission Control launches the platform
- SISU and SCBS become active together
- SCBS remains a real sibling service behind an API boundary
- one-agent mode remains available without the full swarm

This gives you:
- correct architecture
- correct operational model
- a usable local developer experience
- a clean path to a 24/7 production platform
