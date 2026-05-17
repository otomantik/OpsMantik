# Database tables and RPCs (inventory method)

**Generated types:** [`lib/types/database.ts`](../../lib/types/database.ts) (Supabase `Database` type).

## OCI / ingest–critical tables (non-exhaustive)

Maintain a spreadsheet keyed by **table → writers (route/cron/script)** before dropping columns:

- `marketing_signals` — queue / export source of truth (see architecture docs on queue-only doctrine).
- `oci_*` / outbox / reconciliation tables as referenced from `lib/oci` and migrations.
- `calls`, `sessions`, `intents` — panel + ingest overlap.

## RPC inventory

1. `grep -r "from('rpc_name'" lib app` is brittle; prefer `grep -r "\.rpc\("` across `lib` and `app/api`.
2. Cross-check with `scripts/verify-rpc-exists.mjs` (`npm run verify-rpcs`).

## Migrations

- **123+** SQL files under `supabase/migrations/` — never delete history; use forward migrations to drop unused objects after code stops writing.
