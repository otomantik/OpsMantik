# `lib/` layer map (prune guide)

## Protected (OCI / ingest spine)

- `lib/oci/**` — export, ACK, queue, guards, contracts consumed by `test:oci-kernel`.
- `lib/ingest/**` — ingest execution, QStash worker path.
- `lib/supabase/**` — clients and middleware.
- `lib/qstash/**`, `lib/upstash.ts` — async and rate limits.

## Product / panel heavy (prune only with import graph proof)

- `lib/domain/truth/**`, `lib/domain/mizan-mantik/**`, `lib/domain/funnel-kernel/**`
- `lib/scoring/**`
- `lib/hooks/**` — delete hooks only when zero page imports remain.

## Knip

Run `npm run audit:knip` after changing exports; do not delete files flagged as unused until confirmed by tests and `grep` from `app/`.
