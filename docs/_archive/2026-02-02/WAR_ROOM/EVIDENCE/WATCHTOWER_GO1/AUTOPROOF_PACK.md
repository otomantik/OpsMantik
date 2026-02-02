# GO W1 — Watchtower Foundation (AUTOPROOF PACK)

**Scope:** Health endpoint + request-id + structured logger.  
**Smoke:** `node scripts/smoke/watchtower-proof.mjs`

---

## 1) Files touched

| File | Change |
|------|--------|
| `lib/log.ts` | **NEW** — Structured logger (JSON: level, msg, request_id, route, site_id?, user_id?); OPSMANTIK_DEBUG=1 for verbose |
| `middleware.ts` | **NEW** — x-request-id (crypto.randomUUID()) on request + response; matcher `/api/:path*` |
| `app/api/health/route.ts` | **NEW** — GET returns { ok: true, ts, git_sha?, db_ok? }; DB check with timeout (never blocks) |
| `app/api/sync/route.ts` | Request-id + logError with request_id, route |
| `app/api/call-event/route.ts` | Request-id + logError with request_id, route |
| `app/api/calls/[id]/seal/route.ts` | Request-id + logInfo at start, logError in catch |
| `app/api/intents/[id]/status/route.ts` | Request-id + logInfo at start, logError in catch |
| `scripts/smoke/watchtower-proof.mjs` | **NEW** — Calls /api/health, asserts ok=true, x-request-id header |

---

## 2) Key diff hunks

- **lib/log.ts:** `logInfo`, `logError`, `logDebug`, `logWarn`; JSON payload with level, msg, ts, request_id?, route?, site_id?, user_id?; DEBUG gate.
- **middleware.ts:** `crypto.randomUUID()` → request + response header `x-request-id`; matcher `['/api/:path*']`.
- **app/api/health/route.ts:** GET → `{ ok: true, ts, git_sha?, db_ok? }`; `checkDbWithTimeout()` with Promise.race(2s).
- **API routes:** `req.headers.get('x-request-id')`; `logInfo`/`logError` with `request_id`, `route`.

---

## 3) Build logs

```bash
npm run build
```

Paste output below (or "PASS" / "FAIL"):

```
( paste here )
```

---

## 4) Smoke logs

```bash
node scripts/smoke/watchtower-proof.mjs
```

Paste output below (or "PASS" / "FAIL"):

```
( paste here )
```

---

## 5) Evidence files

| File | Description |
|------|-------------|
| `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO1/smoke_log.txt` | Written by watchtower-proof.mjs on success |
| `docs/WAR_ROOM/EVIDENCE/WATCHTOWER_GO1/AUTOPROOF_PACK.md` | This file |

---

## 6) PASS/FAIL checklist

| Item | Status |
|------|--------|
| /api/health returns 200, body.ok === true | ☐ PASS / ☐ FAIL |
| Response has x-request-id header | ☐ PASS / ☐ FAIL |
| npm run build | ☐ PASS / ☐ FAIL |
| node scripts/smoke/watchtower-proof.mjs | ☐ PASS / ☐ FAIL |
