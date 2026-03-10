# CLAUDE.md

## Repository conventions

- Keep the CLI thin. Command handlers should translate flags and delegate to a service adapter.
- Preserve a strict separation between human-readable rendering and machine-readable JSON output.
- Favor deterministic, evidence-oriented naming that aligns with the SCBS domain model in `SCBS.md`.
- When downstream `@scbs/*` packages land, replace local adapter implementations rather than expanding inline domain logic in the CLI.

## Local workflow

```bash
bun run test
bun run lint
bun run typecheck
```
