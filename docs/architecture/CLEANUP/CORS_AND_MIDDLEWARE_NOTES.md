# CORS and middleware notes

## CORS

Implementation: [`lib/security/cors.ts`](../../lib/security/cors.ts). Production requires **`ALLOWED_ORIGINS`** (comma-separated, no wildcard).

**Slimdown rule:** do not remove origins without proving zero browser traffic from that origin (analytics or CDN logs).

## Middleware

[`middleware.ts`](../../middleware.ts):

- Skips session refresh for `/api/*` (performance).
- Adds `x-request-id` + `OM_TRACE_HEADER` for tracing.
- Düsseldorf geo-fence for ingest (`/api/sync` path handled inside middleware geo check — verify when editing).

Supabase session refresh: [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts).
