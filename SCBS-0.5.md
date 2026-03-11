# SCBS 0.5

Operational SCBS is now real. This document narrows the goal from the broad end-state in `SCBS.md` to the next honest milestone: a solid standalone service that an agent swarm can depend on day to day.

It does not replace `SCBS.md`.
It defines the practical 0.5 target based on current `master`.

## Honest Status

SCBS is no longer just an MVP skeleton.

Current `master` already provides:
- deterministic repository extraction and anchored claims
- reusable views and dependency-aware bundle planning
- standalone HTTP API, OpenAPI artifacts, and SDK client
- PostgreSQL-backed durable runtime
- durable freshness events and recompute jobs
- durable repo scan and receipt-validation jobs
- receipt validation with graph/trust updates
- PostgreSQL smoke-path deployment
- basic operator diagnostics through `doctor`

In blunt terms:
- core engine: strong
- standalone service: usable
- production-grade service operations: still partial

## What 0.5 Means

SCBS 0.5 is the point where:
- a swarm can depend on SCBS over HTTP, not just through local CLI commands
- queued work drains without human intervention
- operators can understand, debug, and recover the service without reading raw state files or the database directly

SCBS 0.5 is not the full end-state from `SCBS.md`.
It is the minimum bar for "solid service" rather than "working engine".

## Gap From Current Master

### 1. Operator surface is still mostly CLI-local

Today:
- `doctor` exposes useful diagnostics
- `freshness worker` can drain queued jobs
- repo scan and receipt validation can be queued

But:
- those controls are not exposed as first-class HTTP/admin APIs
- external consumers cannot inspect queue state, worker backlog, or receipt-review state through the service boundary
- operators still need CLI or direct storage access for recovery work

### 2. Background execution still depends on manual worker draining

Today:
- SCBS persists jobs durably
- the worker can drain recompute, repo-scan, and receipt-validation jobs

But:
- there is no always-on worker mode
- there is no service-owned background loop
- there is no clear retry/backoff/dead-letter behavior for stuck jobs

This is the biggest difference between "durable commands exist" and "service actually runs itself".

### 3. Standalone operations are still under-specified

Today:
- PostgreSQL launch docs exist
- a smoke path exists
- `health` and `doctor` exist

But:
- there is no stronger deploy/runbook contract for service operators
- readiness, config validation, and operational recovery flows are still thin
- there is no compact service-grade packaging/ops story beyond local compose and smoke scripts

## SCBS 0.5 Target

A 0.5-complete SCBS should satisfy all of the following:
- HTTP clients can inspect diagnostics, queue state, and receipt review state without shell access
- queued repo scans, receipt validations, and freshness recomputes are processed by a persistent worker mode
- operators have a documented, repeatable deploy and recovery path for PostgreSQL-backed standalone service use

## Highest-Value Remaining Tasks

### Task 1. Expose operator/admin APIs for diagnostics and job control

Why first:
- the swarm primarily benefits from SCBS as a service boundary, not as a local CLI
- current diagnostics are useful but stranded behind CLI-only commands

Scope:
- add HTTP endpoints for service diagnostics and queue inspection
- expose pending/completed job summaries, recent freshness events, and receipt-review backlog
- expose narrow operator actions for draining or retrying jobs
- extend the SDK client to cover those endpoints

Done means:
- operators can answer "what is stuck?", "what is pending?", and "what changed?" over HTTP
- queue/worker state is no longer shell-only

### Task 2. Add persistent background worker mode with retry semantics

Why second:
- durable jobs exist already, so the next leverage is making them self-executing
- manual `freshness worker` draining is acceptable for development, not for a solid service

Scope:
- add a long-running worker command or service mode
- poll and claim pending jobs safely from PostgreSQL
- add retry counters, error capture, and terminal-failure handling
- make repo scan, receipt validation, and freshness recompute use the same durable execution model

Done means:
- SCBS can continuously process queued work without manual CLI intervention
- failed jobs become visible and recoverable instead of silently remaining pending

### Task 3. Ship a service-grade standalone operations baseline

Why third:
- once the service is inspectable and self-draining, the next failure mode is operator confusion
- deployment and recovery need to be explicit enough for routine swarm use

Scope:
- add a canonical standalone deployment path beyond local smoke testing
- strengthen startup/config validation and readiness reporting
- document run/upgrade/recovery flows for PostgreSQL-backed deployment
- add one service-grade verification lane that exercises the documented deployment path end to end

Done means:
- a new operator can bring SCBS up, verify it, and recover common failures from the checked-in repo alone

## Non-Goals For 0.5

These still matter, but they are not the next highest-value slice:
- full Mission Control UI/dashboard scope
- richer human review UX beyond service/operator APIs
- advanced analytics, ratings, and long-horizon learning loops
- full multi-tenant auth and policy system
- every end-state webhook/integration path described in `SCBS.md`

## Bottom Line

SCBS is already useful.

The remaining work to reach a solid 0.5 service is not mostly about the core context engine anymore.
It is about service ownership:
- observe it
- run it continuously
- recover it cleanly

That is the shortest path from "operational" to "dependable".
