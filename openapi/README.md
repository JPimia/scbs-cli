# SCBS OpenAPI

Checked-in OpenAPI artifacts for the first-class `apps/server` v1 HTTP surface live here.

- `scbs-v1.openapi.json` is the canonical artifact consumed by tests.
- `scbs-v1.openapi.yaml` is a YAML rendering of the same document.

The artifacts are generated from `apps/server/src/openapi.ts` and must stay aligned with
`apps/server/src/contract.ts`.
