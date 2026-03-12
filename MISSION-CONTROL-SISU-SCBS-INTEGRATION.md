# Mission Control, SISU, and SCBS Integration

This document defines how SCBS should be installed and operated as part of the Mission Control 24/7
agent swarm system.

It is based on:
- the intended architecture in [SCBS.md](/home/jarip/projects/scbs/SCBS.md)
- the current `0.7` service surface
- the launch/runtime model described for Mission Control and SISU
- the interaction flow in [Project Idea to Deployment-2026-03-11-191805.mmd](/home/jarip/projects/scbs/Project%20Idea%20to%20Deployment-2026-03-11-191805.mmd)

## Bottom Line

SCBS should be integrated as a managed internal service in the Mission Control + SISU system.

Recommended model:
- Mission Control launches the platform
- Mission Control ensures SISU is active
- Mission Control also ensures SCBS API and SCBS worker are active
- SISU consumes SCBS through the API boundary
- Mission Control consumes SCBS either through the API directly for operator views or through SISU

This means:
- SCBS and SISU behave like one system operationally
- but remain separated by an API contract architecturally

That is the correct shape.

## Direct Answer To The Packaging Question

For your system, the best integration is not "npm install inside every project so it plugs itself
in automatically."

The best integration is:
- SCBS runs as a platform service owned by Mission Control/SISU startup
- projects and repos are registered into that service
- agents call the service over HTTP/SDK

Why:
- SCBS is a shared context engine across many repos and many projects
- it needs durable PostgreSQL-backed state
- it needs a worker process
- it needs stable URLs, tokens, audit logs, and webhook delivery
- it should not create hidden per-project local state that fragments the system

So the right answer is:
- use service deployment as the primary integration model
- optionally publish an npm package only as an SDK/client/bootstrap helper, not as the primary runtime

## Recommended Integration Model

Treat the total system like this:

- `Mission Control`
  - product shell
  - web app
  - user/operator surface
  - startup orchestrator for platform services

- `SISU`
  - orchestration engine
  - agent swarm runtime
  - work item flow
  - pod/team dispatch

- `SCBS`
  - context engine
  - bundle planner
  - receipt ingestion and validation
  - freshness/trust state
  - review, audit, outbox, and webhook surface

### Operational truth

Operationally:
- Mission Control starts SISU and SCBS together
- SISU is considered degraded if SCBS is unavailable
- SCBS is considered part of the same product platform

Architecturally:
- SISU must still consume SCBS through API/SDK
- Mission Control must not depend on SCBS internals directly

This matches the rule in `SCBS.md`:
- SCBS is shared by SISU and Mission Control
- SCBS must never depend on Mission Control internals
- SCBS remains standalone even if SISU is its primary consumer at launch

## Startup Model

This is the startup model I recommend for your 24/7 swarm company system.

### Development / local integrated launch

When you launch Mission Control locally:
- PostgreSQL starts or is ensured reachable
- SCBS API starts
- SCBS worker starts
- SISU starts
- Mission Control web app starts

Mission Control should not wait for user action to start SCBS.

Instead:
- Mission Control startup should perform a dependency boot phase
- if SCBS is already running and healthy, reuse it
- if SCBS is not running, start it
- if queued work already exists, SISU and SCBS resume immediately

### Production / long-running deployment

In production, do not couple SCBS lifetime to a browser tab or front-end process.

Recommended deployment units:
- `mission-control-web`
- `sisu-api` or `sisu-orchestrator`
- `scbs-api`
- `scbs-worker`
- `postgres`

Mission Control launching in production should mean:
- the platform stack is up
- not literally that the browser UI process spawns all child processes at runtime

So:
- for local developer experience, unified launch is good
- for production, managed services are better

## What Mission Control Should Launch

Mission Control platform startup should ensure these SCBS pieces exist:

### 1. SCBS API

This is the internal service boundary used by SISU and optionally Mission Control.

Required responsibilities:
- bundle planning
- repo registration
- repo change reporting
- receipt submission
- receipt validation
- admin diagnostics
- review, audit, and outbox inspection

### 2. SCBS worker

This is mandatory for real use.

Without the worker:
- queued repo scans stall
- queued receipt validation stalls
- webhook delivery stalls

So SCBS is not fully "up" unless both are running:
- API
- worker

### 3. PostgreSQL

SCBS should use PostgreSQL in the integrated Mission Control/SISU system.

Do not use local JSON as the real swarm runtime.

Local JSON is only acceptable for:
- very small local experiments
- tests
- temporary bootstrap

## Exact Role Mapping To Your Diagram

Your sequence diagram maps to SCBS like this:

### Phase 1: Intake and planning

`Global Planner -> SCBS API`
- request planning bundle

SCBS responsibilities:
- build or fetch compiled planning bundle
- return bundle, freshness, selected claims/views, diagnostics

Recommended endpoint:
- `POST /api/v1/bundles/plan`

### Phase 2: Repo-local dispatch

`Repo Coordinator -> SCBS API`
- request scoped execution bundle

SCBS responsibilities:
- produce narrower execution bundle
- support parent bundle and scoped child bundle flow

Recommended endpoint:
- `POST /api/v1/bundles/plan`

Important request fields:
- `repoIds`
- `fileScope`
- `symbolScope`
- `parentBundleId`
- `metadata`
- `externalRef`

### Phase 3: Execution

`Execution Pod -> SCBS API`
- submit agent receipt

SCBS responsibilities:
- receive provisional receipt
- validate or queue validation
- preserve review history
- expose status changes
- emit lifecycle events

Recommended endpoints:
- `POST /api/v1/receipts`
- `POST /api/v1/receipts/:id/validate`

### Phase 4: Merge

SCBS does not own merge.

Instead, SCBS should provide:
- receipt review state
- bundle review state
- audit trail
- outbox/webhook events

Your merge service can use SCBS as a source of trust signals, but SCBS should not become the merge
engine itself.

## Recommended Call Contract By System Component

### Global Planner

Use SCBS for:
- initial planning bundle
- re-plan on stale bundle
- parent bundle creation for later child work

Recommended flow:
1. create planning bundle
2. inspect freshness warnings
3. hand bundle id to SISU hierarchy

### Repo Coordinator

Use SCBS for:
- scoped child execution bundles
- repo change reporting
- bundle review and receipt review inspection

Recommended flow:
1. request child bundle with `parentBundleId`
2. dispatch pod with returned bundle
3. after pod returns, check review endpoints if receipt needs inspection

### Execution Pod

Use SCBS for:
- submitting receipt after work
- optionally asking for freshness or updated bundle on long-running work

Recommended flow:
1. consume provided bundle
2. execute work
3. submit receipt
4. if needed, queue validation

### Mission Control UI

Use SCBS for:
- repo registration
- freshness dashboards
- stale bundle inspection
- receipt review views
- audit views
- webhook/event diagnostics

Mission Control should not import SCBS internals.

It should use:
- HTTP API
- SDK client

## Installation Recommendation

This is the integration approach I recommend.

### Recommended: service bundle integration

Mission Control should install and run SCBS as part of the platform stack.

Good forms:
- Docker Compose stack
- process supervisor stack
- workspace monorepo service launcher
- deployment chart / container service definition

This is the right primary installation model.

### Optional: npm package integration

If you publish an npm package, it should be one of these:
- `@scbs/sdk`
- `@scbs/client`
- `@scbs/dev-bootstrap`

Those packages should help with:
- calling the API
- bootstrapping local dev
- generating config
- wiring a local stack launcher

Those packages should not become:
- the primary runtime of SCBS
- a hidden side-effect installer that mutates project state unexpectedly
- a separate per-project SCBS instance

So the npm package is useful, but only as:
- SDK
- bootstrap tooling
- launcher helper

Not as:
- the real platform runtime

## Best Practical Shape For Your Company Stack

For Mission Control 24/7, I recommend this exact shape.

### In development

One top-level "platform up" command starts:
- PostgreSQL
- SCBS API
- SCBS worker
- SISU
- Mission Control web app

Example conceptual command:

```bash
bun run platform:up
```

### In production

Separate managed services:
- Mission Control web
- SISU service
- SCBS API service
- SCBS worker service
- PostgreSQL

And one health model:
- Mission Control healthy only if dependent APIs are reachable
- SISU degraded if SCBS is unavailable
- SCBS degraded if worker is not running or PostgreSQL is unavailable

## Configuration Boundary

Mission Control should own:
- SCBS base URL
- SCBS service token for admin/repo routes
- database/service deployment config
- webhook target configuration

SISU should own:
- how it maps work items to bundle requests
- how it maps execution results to receipts
- how it reacts to review/outbox signals

SCBS should own:
- context compilation
- bundle assembly
- receipt validation state
- lifecycle event emission
- audit and review record persistence

## Minimal Integrated Startup Contract

If Mission Control starts the system, it should do this in order:

1. Ensure PostgreSQL is up.
2. Ensure SCBS database is migrated.
3. Ensure SCBS API is running and healthy.
4. Ensure SCBS worker is running.
5. Ensure at least one admin token exists.
6. Start SISU.
7. Start Mission Control web app.

That is the minimum correct startup sequence.

## Minimal Health Contract

Mission Control should treat SCBS as healthy only if:
- `GET /health` succeeds
- admin diagnostics are reachable
- worker is active enough to drain queued jobs
- PostgreSQL-backed state is available

Useful checks:
- `GET /health`
- `GET /api/v1/admin/diagnostics`
- `GET /api/v1/admin/jobs`

## Recommendation Summary

If the question is:

"Should SCBS plug in by npm install inside every project?"

My answer is:
- no, not as the main runtime model

If the question is:

"Should SCBS start automatically when Mission Control launches the integrated swarm platform?"

My answer is:
- yes

If the question is:

"Should SISU and SCBS feel like one system but remain separated by API?"

My answer is:
- yes, that is exactly the right architecture

## Final Recommendation

Build SCBS integration like this:
- SCBS is a first-class internal platform service
- Mission Control startup ensures SCBS API + SCBS worker are active
- SISU uses SCBS through HTTP/SDK only
- Mission Control uses SCBS through HTTP/SDK for operator views
- npm packaging is secondary and should be for SDK/bootstrap, not the primary runtime

That gives you:
- clean architecture
- correct ownership boundaries
- a real 24/7 service model
- one shared context engine for all teams and repos
