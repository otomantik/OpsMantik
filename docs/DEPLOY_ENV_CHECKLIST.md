# Deploy Environment Checklist (Opsmantik)

Vercel Production ve Preview ortamlarında set edilmesi / kaldırılması gereken env'ler.

---

## Production'da OLMASI gereken env'ler

Build ve runtime için zorunlu. Eksikse `npm run build` fail eder (validate-env.mjs).

| Key | Açıklama |
|-----|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (client + server). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client + server). |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server-only; worker, DLQ, reconcile). |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (StatsService, rate limit). |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token. |
| `QSTASH_TOKEN` | Upstash QStash token (sync producer publish + DLQ replay). |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash signing key (worker verify). |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key (key rotation). |
| `ALLOWED_ORIGINS` | CORS allowed origins (virgülle ayrılmış; prod domain'leri). |

Opsiyonel ama önerilir:

- `NEXT_PUBLIC_SENTRY_DSN` — Sentry error monitoring.
- `NEXT_PUBLIC_PRIMARY_DOMAIN` — Primary domain (opsiyonel).

---

## Production'da KALDIRILMASI gereken env'ler

Güvenlik ve gereksiz gürültüyü önlemek için Production'da **set etmeyin** veya **kaldırın**.

| Key | Sebep |
|-----|--------|
| `PROOF_EMAIL`, `PROOF_PASSWORD`, `PROOF_STORAGE_STATE` | Playwright/smoke test credential'ları; prod'da gereksiz ve risk. |
| `SITE_ID` | Test/smoke için kullanılan site id; prod'da gereksiz. |
| `DASHBOARD_BASE_URL` | Smoke script base URL; prod'da gereksiz. |
| `OPENAI_API_KEY` | Prod'da AI kullanılmıyorsa kaldır (güvenlik). |
| `SENTRY_AUTH_TOKEN` | Release/source map upload; CI yoksa prod'da gereksiz. |
| `USE_LOCAL_TRACKER_PAGE` | Lokal geliştirme flag'i; prod'da olmamalı. |
| `GOOGLE_CLIENT_SECRET` | Prod'da OAuth kullanılıyorsa kalır; sadece gerekli ortamda set edin. |

---

## Notlar

- **Preview** ortamında da yukarıdaki “OLMASI gereken” env'ler set edilmeli (build + test için).
- **Tırnak:** Vercel'de env değerlerini tırnak içinde girmeyin (URL/token düz metin).
- **Scope:** Her key için Production / Preview / Development scope'u Vercel'de doğru seçin.
