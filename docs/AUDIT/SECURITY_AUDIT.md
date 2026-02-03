# Security Audit — Hacker-Mode Findings

**Date:** 2026-02-03  
**Scope:** API authz, IDOR, env/secrets, CORS, input validation, site scoping

---

## Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **High** | `/api/stats/realtime` — No auth; any allowed origin could read any site’s Redis stats by `siteId` (IDOR) | ✅ Fixed |
| 2 | **Medium** | `SiteService.validateSite` — Only accepted UUID; sync worker uses `public_id` from tracker, so validation could fail for non-UUID `public_id` | ✅ Fixed |
| 3 | **Low** | `/api/debug/realtime-signal` — In dev, authenticated user could insert into any site’s sessions/calls without access check | ✅ Fixed |
| 4 | **Info** | `/api/health` — Public GET; returns only `ok`, `ts`, `git_sha`, `db_ok` (no secrets) | OK |
| 5 | **Info** | Sync worker — Protected by `verifySignatureAppRouter` (QStash) | OK |
| 6 | **Info** | Dashboard APIs (sites, intents, OCI, invite, etc.) — Auth + site access or RLS checked | OK |

---

## 1. IDOR: `/api/stats/realtime` (FIXED)

**Risk:** Endpoint relied only on CORS (allowed origin). Anyone from an allowed origin could call `GET /api/stats/realtime?siteId=<public_id>` and read that site’s Redis overlay (captured, gclid, junk). `siteId` is guessable (e.g. from tracker script `data-site-id`).

**Fix:**
- Require authenticated user (cookie session).
- Resolve `siteId` (UUID or `public_id`) to site row; enforce `validateSiteAccess(site.id)`.
- Use site’s `public_id` (or id) for Redis key so dashboard can keep passing `site.id` (UUID).

**Files:** `app/api/stats/realtime/route.ts`

---

## 2. SiteService.validateSite only accepted UUID (FIXED)

**Risk:** Worker receives `site_id` from tracker body (`body.s` = `data-site-id` = `public_id`). `validateSite` required UUID format and returned “Invalid site_id format” for values like `test_site_abc12345`, so sync could fail for valid tracker requests.

**Fix:** Support both:
- **UUID** (with/without hyphens): look up by `sites.id`.
- **public_id** (any string): look up by `sites.public_id`.

**Files:** `lib/services/site-service.ts`

---

## 3. Debug endpoint site access (FIXED)

**Risk:** `/api/debug/realtime-signal` is disabled in production (404) but in dev only required “any authenticated user”. A logged-in user could send a `siteId` they don’t own and insert test rows into that site’s sessions/calls.

**Fix:** In dev, call `validateSiteAccess(siteId, user.id, supabase)` and return 403 if not allowed.

**Files:** `app/api/debug/realtime-signal/route.ts`

---

## 4. Already in good shape (no change)

- **CORS:** Fail-closed in production; `ALLOWED_ORIGINS` required.
- **Sync route:** Rate limit (Redis) + CORS; payload offloaded to QStash.
- **Worker:** QStash signature verification; no public POST without valid token.
- **Dashboard APIs:** Auth + RLS or explicit site access (e.g. `sites/[id]/status`, `intents/[id]/status`, `calls/[id]/seal`, `customers/invite`, `jobs/auto-approve`, `oci/export`).
- **DLQ list/replay:** Admin-only (`isAdmin()`).
- **Health:** No secrets in response; DB check uses env server-side only.
- **Watchtower test-throw:** Only throws when `WATCHTOWER_TEST_THROW=1`; no sensitive data.

---

## 5. Recommendations (follow-up)

1. **Rate limiting:** `/api/sync` has Redis rate limit; consider rate limiting other public or semi-public APIs (e.g. by IP or user) where appropriate.
2. **intents/[id]/status:** Only owner or global admin can update; site members (viewer/editor) cannot. Confirm this is intentional.
3. **QSTASH_TOKEN:** If missing, sync route and DLQ replay still instantiate `new Client({ token: '' })`; consider failing fast on startup or first use in production when token is empty.
4. **NEXT_PUBLIC_*:** Avoid putting secrets in `NEXT_PUBLIC_*`; current use (Supabase URL/anon key, Sentry DSN, primary domain) is acceptable.

---

## 6. Checklist for new API routes

- [ ] Require auth for dashboard/data routes (cookie or Bearer).
- [ ] For any `siteId`/`site_id` from client: resolve to site then call `validateSiteAccess` (or equivalent RLS) before DB/Redis access.
- [ ] Use parameterized queries / Supabase `.eq()` with variables; avoid building filter strings from user input.
- [ ] CORS: use `parseAllowedOrigins()` and `isOriginAllowed()` for public/cross-origin endpoints.
- [ ] Admin-only routes: guard with `isAdmin()`.
