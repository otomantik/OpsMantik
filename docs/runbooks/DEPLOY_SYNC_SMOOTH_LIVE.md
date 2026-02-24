# Canlıya Alma: Sync Pürüzsüz (Rate Limit + Batch + Entitlements)

Bu deploy ile **400 batch_not_supported** kalkar, **429** riski azalır, **entitlements** prod’da varsayılan full access olur.

---

## Deploy öncesi

- [ ] `NODE_ENV=production` Vercel’de zaten ayarlı (varsayılan).
- [ ] İsteğe bağlı env’ler: **OPSMANTIK_SYNC_RL_DEFAULT**, **OPSMANTIK_SYNC_RL_SITE_OVERRIDE**, **OPSMANTIK_ENTITLEMENTS_STRICT**. Hiçbiri zorunlu değil.

---

## Adımlar

1. **Commit + push** (aşağıdaki değişen dosyalar).
2. **Vercel** otomatik deploy alacak (Git bağlıysa).
3. **Doğrulama:** Bir sitede sayfa aç → Network’te POST `/api/sync` → **200** (batch veya tek event). 400 `batch_not_supported` gelmemeli.

---

## Değişen dosyalar (bu deploy)

- `app/api/sync/route.ts` — Batch desteği, rate limit 2000/dk, OPSMANTIK_SYNC_RL_DEFAULT
- `lib/entitlements/getEntitlements.ts` — Prod’da varsayılan full access
- `lib/quota.ts` — Varsayılan plan 100k/ay, soft_limit
- `docs/runbooks/SYNC_RATE_LIMIT_AND_QUOTA_DEFAULTS.md`
- `docs/runbooks/DEPLOY_SYNC_429_SITE_SCOPED_RL.md`
- `docs/runbooks/DEPLOY_SYNC_SMOOTH_LIVE.md` (bu dosya)
