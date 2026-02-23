# PR-G5: Audit Log (Billing / Admin)

- **Scope:** Generic append-only audit trail for billing, admin, and sensitive actions (Tier-1 roadmap: "audit log table and write path for billing/admin").
- **Table:** `public.audit_log` — see migration `20260219100000_audit_log_g5.sql`.
- **Write path:** Only via `adminClient` (service_role). Use `appendAuditLog(client, params)` from `lib/audit/audit-log.ts`.

## Schema (summary)

| Column        | Type   | Description                                |
|---------------|--------|--------------------------------------------|
| id            | uuid   | PK                                        |
| created_at    | timestamptz | Default now()                         |
| actor_type    | text   | `user` \| `service_role` \| `cron`        |
| actor_id      | uuid   | Optional; auth.users.id for user          |
| action        | text   | e.g. `invoice_freeze`, `dispute_export`    |
| resource_type | text   | Optional e.g. `invoice_snapshot`           |
| resource_id   | text   | Optional e.g. year_month or composite id   |
| site_id       | uuid   | Optional; for tenant-scoped queries       |
| payload       | jsonb  | Extra context (counts, year_month, etc.)  |

RLS: only `service_role` can SELECT; only service_role can INSERT (no policy for authenticated = deny). Append-only; no UPDATE/DELETE.

## Wired actions

| Action           | Where                    | Actor   | Notes                                      |
|------------------|--------------------------|---------|--------------------------------------------|
| `invoice_freeze` | cron/invoice-freeze      | cron    | resource_id = year_month; payload: frozen, failed |
| `dispute_export` | billing/dispute-export   | user    | actor_id = user.id; site_id set; payload: year_month |

## Adding new actions

1. Call `appendAuditLog(adminClient, { actor_type, actor_id?, action, resource_type?, resource_id?, site_id?, payload? })` from the route/cron that already uses `adminClient`.
2. Use a stable `action` string (e.g. `confirm_sale`, `idempotency_cleanup`). Document new actions in this file.
3. Do not throw on audit failure; `appendAuditLog` returns `{ ok, error? }` and does not throw.

## Querying (backend only)

Only service_role can read. Use adminClient, e.g.:

```ts
const { data } = await adminClient
  .from('audit_log')
  .select('*')
  .eq('action', 'dispute_export')
  .order('created_at', { ascending: false })
  .limit(100);
```

No authenticated API is exposed for audit log in G5; that can be a later PR (admin-only endpoint with RLS).
