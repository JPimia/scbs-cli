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
bun run test
bun run lint
bun run typecheck
```

Run the CLI locally:

```bash
bun run cli -- health
bun run cli -- repo list --json
```

## CLI surface

The `scbs` binary exposes the service, repository, fact, claim, view, bundle, freshness, and receipt commands from the MVP spec. Every command accepts `--json`.

The current CLI implementation stays intentionally thin. It now persists local artifact state through a durable JSON adapter under `.scbs/state.json`, while still keeping the command layer isolated behind the `apps/cli` service interface.
