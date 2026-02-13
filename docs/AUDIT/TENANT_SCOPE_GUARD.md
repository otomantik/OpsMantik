# Tenant Scope Guard (adminClient regression lock)

OpsMantik uses Supabase **service-role** (`adminClient`) in server routes and internal jobs. This is necessary for background processing and admin operations, but it bypasses RLS; a single missing tenant filter can leak cross-tenant data.

This guard is a CI regression lock that fails builds when `adminClient.from('...')` is used on tenant-scoped tables without explicit tenant scoping.

## What is checked

- Scans `app/api/**`, `lib/**`, `scripts/**` for `adminClient.from('<table>')`
- For **tenant-scoped** tables (site boundary), requires explicit scope in the same statement chain:
  - Prefer: `.eq('site_id', ...)` or `.in('site_id', ...)`
  - For `sites` (no `site_id`): allow `.eq/.in` on `id`, `public_id`, or `user_id`
  - For `ingest_publish_failures`: allow `site_public_id` scope/payload
  - For `events`: allow `site_id` OR `(session_id + session_month)` (partition/FK-friendly)
- Allows a small documented allowlist for **true global/admin** paths (Watchtower global counts, DLQ replay by id, etc.)

## How to run

```bash
npm run audit:tenant-scope
```

## Allowlist

Add a JSON entry to `scripts/audit/tenant-scope-allowlist.json`:

```json
{ "file": "path/relative/to/repo.ts", "table": "sessions", "reason": "why this is safe" }
```

Keep the allowlist small, and prefer adding explicit scoping in code.

