# GDPR and retention cron ↔ API

| Route / cron | Purpose |
|--------------|---------|
| `app/api/gdpr/erase` | Erasure requests |
| `app/api/gdpr/export` | Data export |
| `app/api/gdpr/consent` | Consent recording |
| `app/api/cron/gdpr-retention` | Scheduled retention enforcement |

**Cross-reference:** [`CRON_VERCEL_MATRIX.md`](./CRON_VERCEL_MATRIX.md) — `gdpr-retention` is Vercel-scheduled daily at 05:00 UTC.

Product + legal must approve any reduction in retention coverage; this doc is mapping only.
