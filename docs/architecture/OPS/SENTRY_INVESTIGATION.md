# Sentry — investigation quick reference

**PII:** Events are scrubbed per [`lib/security/sentry-pii.ts`](../../../lib/security/sentry-pii.ts) and [`docs/architecture/SECURITY.md`](../SECURITY.md).

---

## Saved searches (suggested)

| Scenario | Query / filter | Time window |
|----------|----------------|---------------|
| Sync failures | `tags.route:/api/sync` **or** `transaction:/api/sync` | Last 15 min |
| Call-event v2 failures | `tags.route:/api/call-event/v2` **or** `transaction:*call-event*` | Last 15 min |
| Seal / OCI | `seal` or tag `oci` if set in capture | Last 1 h |
| Health warnings | `route:/api/health` + level:warning | Last 24 h |

**Note:** Exact field names depend on Sentry/GlitchTip SDK version. Prefer **Discover** queries on `message`, `transaction`, and custom tags added in route handlers.

---

## Tags to prefer in new code

When adding `Sentry.captureException` or spans:

- `route` — e.g. `/api/sync`
- `operation` — e.g. `worker_ingest`, `oci_export`
- Avoid raw `site_id` / phone in tags; use **hashed** or internal `public_id` prefix only if necessary.

---

## Playbook cross-links

| Alert / symptom | Steps |
|-----------------|-------|
| `sync_error_rate_high` | [OBSERVABILITY_REQUIREMENTS.md § Investigation](./OBSERVABILITY_REQUIREMENTS.md#investigation-playbook) |
| `call_event_error_rate_high` | Same file, call-event section |
| Redis / rate limit | [`docs/runbooks/SYNC_RATE_LIMIT_AND_QUOTA_DEFAULTS.md`](../../runbooks/SYNC_RATE_LIMIT_AND_QUOTA_DEFAULTS.md) |

---

## Release correlation

Deployments: filter by `release` or `environment` in Sentry (set via `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` / build metadata in [`next.config.ts`](../../../next.config.ts) Sentry plugin).
