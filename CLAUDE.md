# CLAUDE.md

## Repository conventions

- Keep the CLI thin. Command handlers should translate flags and delegate to a service adapter.
- Preserve a strict separation between human-readable rendering and machine-readable JSON output.
- Favor deterministic, evidence-oriented naming that aligns with the SCBS domain model in `SCBS.md`.
- When downstream `@scbs/*` packages land, replace local adapter implementations rather than expanding inline domain logic in the CLI.

## Local workflow

```bash
bun test
bun run lint
bun run typecheck
bun run test:packages
bun run verify:openapi
```

For end-to-end verification from the root, use `bun run verify`.

For PostgreSQL-backed verification, set `DATABASE_URL` to a writable PostgreSQL database and run
`bun run verify:postgres`. The root verification script will create and drop an isolated temporary database while
applying the checked-in migration. It can use either a local `psql` client or a Dockerized `postgres:16` client.
