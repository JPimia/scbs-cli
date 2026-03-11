# SCBS 0.7

SCBS 0.6 made the system operational as a real standalone service:
- admin/job APIs exist
- durable jobs are retryable
- a persistent worker loop exists
- PostgreSQL-backed service operation is documented and smoke-tested

`SCBS.md` still describes a broader 1.0 product.

This document defines the next honest step from 0.6 toward that full 1.0 state.
It does not replace `SCBS.md`.

## 1.0 Reference Point

`SCBS.md` describes a complete product with:
- reusable standalone APIs and SDKs
- trust/freshness ownership across artifacts
- reviewable receipt and bundle flows
- Mission Control-facing diagnostics and visibility
- webhook/event contracts
- auditable and scoped repository/service access
- service distribution suitable for independent product use

That is the 1.0 target.

## Current 0.6 Status

Current branch state already covers:
- deterministic extraction and anchored claims
- graph-aware views and dependency-aware planning
- durable PostgreSQL runtime
- HTTP API + OpenAPI + SDK
- durable freshness/recompute jobs
- durable repo scan and receipt validation jobs
- admin diagnostics and job APIs
- retryable worker execution
- smoke-tested standalone PostgreSQL launch path

The core engine and service operations are now credible.

## Remaining Gap To 1.0

The biggest missing pieces are no longer basic runtime features.
They are the product surfaces that make SCBS trustworthy and integratable across systems:

### 1. Reviewability

The system can validate receipts and plan bundles, but it still lacks a strong service-grade review surface for:
- planner diagnostics over HTTP
- stale bundle visibility
- receipt review history and audit-friendly status inspection

This is explicitly called out in `SCBS.md` as:
- freshness dashboards
- stale bundle diagnostics
- receipt review tooling
- context planner debugging

### 2. External integration contracts

SCBS is API-first, but it still mostly behaves like a pull-based service.
`SCBS.md` calls for webhook/event contracts and cross-product integrations.

Right now:
- clients must poll
- there is no durable outbox/event emission model
- no clean notification path exists for freshness, job, or receipt lifecycle changes

### 3. Auditable service ownership

`SCBS.md` explicitly requires repository access to be scoped and auditable.

Right now:
- the service exposes admin and repo operations
- but it does not yet preserve a first-class audit trail for those operations
- and there is no explicit service-level access boundary or operator-action trace

This is the main difference between a capable internal service and a product-ready shared service.

## SCBS 0.7 Target

SCBS 0.7 should make the system:
- reviewable
- externally integratable
- auditable

Concretely, 0.7 should satisfy all of the following:
- operators and clients can inspect planner/bundle/receipt history without raw DB access
- SCBS can emit durable lifecycle events for outside systems
- admin/repo actions become traceable and service-scope aware

## Highest-Value 0.7 Tasks

### Task 1. Expose bundle visibility, planner diagnostics, and receipt review history

Why:
- `SCBS.md` calls for freshness dashboards, stale bundle diagnostics, receipt review tooling, and planner debugging
- the engine already computes much of this data, but the service boundary does not expose it well enough

Scope:
- expose bundle history and richer freshness/review status over HTTP
- expose planner diagnostics from bundle metadata in a stable admin/client view
- expose receipt review history and audit-friendly validated/rejected details
- extend SDK/client views to consume those surfaces

Done means:
- external clients can answer "why did this bundle look like this?" and "what happened to this receipt?" without direct storage access

### Task 2. Add durable outbox/webhook delivery for service lifecycle events

Why:
- 1.0 calls for webhook/event contracts and cross-product integrations
- polling alone is not enough for Mission Control or other service consumers

Scope:
- add an outbox table/model for emitted lifecycle events
- emit events for freshness changes, job failures/completions, and receipt validation outcomes
- expose webhook delivery or at minimum durable event export/replay APIs
- document the event contract as a versioned standalone surface

Done means:
- SCBS can notify outside systems when important trust/freshness/runtime events happen

### Task 3. Add scoped access and audit logging for admin and repository actions

Why:
- `SCBS.md` explicitly says repository access must be scoped and auditable
- 0.6 made admin APIs stronger, which raises the bar for traceability

Scope:
- add a service audit log for admin/job/repo mutation actions
- record actor/source metadata for service-triggered operations
- expose audit records through HTTP/SDK views
- define a lightweight standalone access model suitable for future auth hardening

Done means:
- SCBS can explain who triggered important service changes and when
- the standalone product boundary starts behaving like a real shared system, not just a local tool

## What 0.7 Does Not Try To Finish

0.7 still does not claim full 1.0 completion.

It intentionally does not finish:
- full Mission Control UI/dashboard work
- full auth/multi-tenant policy system
- every packaging/distribution target from `SCBS.md`
- every advanced analytics or operator rating loop

Those belong to later slices.

## Why This Is The Right Next Step

0.6 solved service operation.
0.7 should solve service trust and integration.

That is the shortest path from:
- "SCBS runs"
to
- "SCBS can be embedded as a dependable product component"

## Bottom Line

If 0.5 was "operational engine" and 0.6 is "operational service",
then 0.7 should be:

"reviewable, auditable, integratable service."
