# Platform cleanup — metric baseline

**Captured:** 2026-05-12 (local snapshot; re-run counts after major merges).

| Metric | Value | How to refresh |
|--------|------:|----------------|
| `app/api/**/route.ts` | 104 | `Get-ChildItem -Recurse -Filter route.ts -Path app/api \| Measure-Object` (PowerShell) |
| `lib/**/*.ts` | 326 | `Get-ChildItem -Recurse -Filter *.ts -Path lib \| Measure-Object` |
| Top-level `dependencies` in `package.json` | 29 | Count `dependencies` keys |
| `supabase/migrations` files | ~123 | `Get-ChildItem supabase/migrations -Filter *.sql \| Measure-Object` |

## Build / bundle

Re-record after `npm run build` on a clean tree:

- Wall time for `next build` (CI log or local stopwatch).
- Client bundle: use build output or Lighthouse on `/login`.

## Release discipline

- **Every PR:** `npm run test:release-gates:pr` (tenant boundary + OCI kernel + runtime budget).
- **Deploy / predeploy:** `npm run test:release-gates` (adds chaos + `smoke:oci-rollout-readiness:strict`).

## Related docs

- [`OCI_CORE_ALLOWLIST.md`](./OCI_CORE_ALLOWLIST.md) — routes and jobs treated as production spine during slimdown.
- [`CLEANUP/README.md`](./CLEANUP/README.md) — inventory and governance artifacts from the deep slimdown plan.
