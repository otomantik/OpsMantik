# API Versioning + Deprecation Policy (OpsMantik)

## Goals

- Make API changes predictable for customers and internal integrations.
- Avoid breaking production by default.
- Provide a consistent deprecation / sunset process.

Scope: **HTTP APIs** under `app/api/*` (Next.js App Router).  
Non-scope: internal DB migrations / RPCs (see notes below).

## Versioning model

### 1) Path-based major versions (preferred)

- **Major versions** are expressed in the URL path: `.../v1/...`, `.../v2/...`
- New major version MUST be additive + backward-compatible with itself, but can break v1.

Examples:
- `POST /api/call-event` = legacy v1
- `POST /api/call-event/v2` = v2

### 2) Contract versions (minor) within a major

Within the same major version:
- Additive response fields are allowed.
- Additive optional request fields are allowed.
- Changing meanings, removing fields, or changing validation rules is **breaking** → requires a new major version.

### 3) Response version header (recommended)

All public endpoints SHOULD return:
- `X-OpsMantik-Version`: build/runtime version string (already used in some routes)

This is used for:
- debugging mismatched deployments
- correlating incidents to a release

## What is a breaking change

Breaking changes include (not exhaustive):
- removing/renaming request fields
- making an optional field required
- changing field types
- changing status codes in normal success flows
- changing idempotency behavior for the same request identity
- changing auth requirements (e.g., unsigned → signed) without an overlap period

Non-breaking changes include:
- adding new optional fields
- adding new response fields
- tightening logging/metrics
- improving performance without changing behavior

## Deprecation policy (timeline)

Default timeline for deprecating a major version:

1. **Announce deprecation** (Day 0)
   - add a doc entry + changelog note
   - include response headers on deprecated endpoints
2. **Grace period** (Day 0 → Day 90)
   - keep deprecated version working
   - provide migration docs and examples
3. **Sunset** (Day 90+)
   - endpoint returns `410 Gone` (or `404`) OR is removed
   - only after confirming migration completion for critical customers

For critical endpoints (tracking ingestion), do NOT hard-cut unless you have:
- observability that confirms negligible usage
- an emergency rollback path

## Deprecation headers (HTTP)

When an endpoint is deprecated, return:
- `Deprecation: true`
- `Sunset: <RFC 1123 date>` (planned removal date)
- `Link: <https://.../docs/API/VERSIONING.md>; rel="deprecation"`

Also keep response body stable (avoid adding new error shapes as a “deprecation message”).

## Current version boundaries (as of today)

### Tracking ingestion

- `POST /api/sync`
  - Treat as **v1** (implicit) until a `/v2` exists.
  - Changes must be additive; otherwise create a `/api/sync/v2`.

- `POST /api/call-event` (legacy v1)
  - Browser-signed mode (or unsigned if explicitly enabled) and older embed patterns.

- `POST /api/call-event/v2` (v2)
  - Proxy-first model (server-side signing; site ID normalization and idempotency roadmap).

### Monitoring / Ops

- `GET /api/health`
  - Keep minimal and stable (monitoring dependency).

### OCI / API-key endpoints

Endpoints like `GET /api/oci/export-batch` and `POST /api/oci/ack` are integration endpoints.
- Treat changes as breaking unless explicitly additive.
- Prefer adding `/v2` endpoints rather than changing behavior in place.

## Migration strategy (v1 → v2)

Rules:
- Prefer **dual-run** (keep v1 operational while v2 rolls out).
- Migrate highest-risk customers first (highest traffic / revenue impact).
- Provide production-only smoke checks and rollback.

Suggested phases:
1. **Introduce v2** (no impact to v1)
2. **Update clients** to use v2 (proxy-first; keep v1 fallback if needed)
3. **Observe** usage via logs/Sentry (confirm v1 traffic drops)
4. **Deprecate v1** with headers + docs
5. **Sunset** v1 after grace period

## Smoke checks (before/after deploy)

Run these minimal checks in production:

1. Health:

```bash
curl -sS https://console.opsmantik.com/api/health
```

2. Sync is reachable (CORS will block from random origins; use an allowed Origin if needed):

```bash
curl -sS -i https://console.opsmantik.com/api/sync
```

Expected: 405 with `Allow: POST, OPTIONS` (unless `?diag=1`).

3. Call-event v2 responds (from an allowed origin):

```bash
ORIGIN="https://www.sosreklam.com"
curl -sS -i \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"site_id":"<site_public_id_or_uuid>","fingerprint":"smoke_fp","intent_action":"phone","intent_target":"905000000000","intent_stamp":"smoke-1"}' \
  https://console.opsmantik.com/api/call-event/v2
```

Expected: 200 or a well-formed 4xx (401/403/400). No 5xx.

## DB/RPC versioning notes

Supabase RPCs are part of the internal contract between UI and DB. Treat RPC signature/shape changes as breaking unless:
- UI code is updated in lockstep
- there is a fallback (temporary) with a defined removal date

Recommendation:
- maintain a “contract snapshot” for critical RPCs (types + expected fields)
- remove v1 fallbacks after all environments have v2

