# Security headers inventory

## Next.js config

[`next.config.ts`](../../next.config.ts) `headers()` currently sets **Cache-Control** for `/assets/core.js` only.

## Recommended additions (review per deploy)

| Header | Typical value | Notes |
|--------|---------------|------|
| `X-Content-Type-Options` | `nosniff` | Safe for HTML + API |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Reduces leakage |
| `Permissions-Policy` | camera=(), microphone=() | tighten as needed |
| `Content-Security-Policy` | default-src 'self' | **High regression risk** for inline scripts — stage behind flag |

## Middleware

[`middleware.ts`](../../middleware.ts) injects `x-request-id` and `OM_TRACE_HEADER`.

## Cookies

Supabase cookie options: `sameSite: 'lax'`, `secure: true` in [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts).

## CSRF

Panel POSTs use server actions and JSON APIs with same-site cookies — inventory forms in `app/` when adding new POST surfaces.
