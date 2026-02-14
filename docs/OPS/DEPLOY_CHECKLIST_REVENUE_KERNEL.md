# Revenue Kernel — Deploy / Sonrası Kontrol Listesi

Bu liste, Revenue Kernel (dispute-export, invoice-freeze, metrics, cleanup batch, Redis metrikleri) deploy sonrası **senin aradan çıkmadan** yapılacak adımları toplar. Her madde tamamlandığında işaretle.

---

## 1. Migration

- [ ] **Idempotency cleanup RPC:** `supabase/migrations/20260217000000_idempotency_cleanup_batch_rpc.sql` uygulandı mı?  
  - `supabase db push` veya Supabase Dashboard’da SQL’i çalıştır.  
  - Yoksa `POST /api/cron/idempotency-cleanup` 500 döner (RPC bulunamadı).

---

## 2. Ortam (Production)

- [ ] **Redis (Upstash):** `UPSTASH_REDIS_REST_URL` ve `UPSTASH_REDIS_REST_TOKEN` production env’de set.  
  - Billing metrikleri Redis’e yazılır; `GET /api/metrics` Redis’ten okur (`ingest_source: redis`).  
  - Yoksa metrikler sadece in-memory (instance bazlı) kalır.

- [ ] **CRON_SECRET:** Cron route’ları (cleanup, reconcile, invoice-freeze, metrics) için Bearer token set.

---

## 3. Test

- [ ] **Lifecycle test:** `tests/billing/lifecycle.test.ts` çalıştır (Supabase + CRON_SECRET env ile).  
  - Eski satır (91 gün) silinmeli, cari ay satırı silinmemeli.

---

## 4. Cron schedule (Vercel veya kullandığın platform)

`vercel.json`’da şu an sadece watchtower ve recover var. Aşağıdakileri Vercel Dashboard’dan veya `vercel.json` ile ekle:

- [ ] **Idempotency cleanup:** `POST /api/cron/idempotency-cleanup` — günlük 03:00 UTC.  
- [ ] **Reconcile usage:** `GET /api/cron/reconcile-usage` (veya enqueue + run ayrı) — günlük veya saatlik.  
- [ ] **Invoice freeze:** `POST /api/cron/invoice-freeze` — ayın 1’i 00:00 UTC.  
- [ ] **Metrics (opsiyonel):** `GET /api/metrics` — scraping için ihtiyaç varsa schedule’a al.

---

## 5. Smoke (tek seferlik)

- [ ] **Cleanup dry_run:**  
  `curl -X POST "https://<APP_URL>/api/cron/idempotency-cleanup?dry_run=true" -H "Authorization: Bearer $CRON_SECRET"`  
  → 200, `would_delete` veya 0.

- [ ] **Metrics:**  
  `curl -H "Authorization: Bearer $CRON_SECRET" "https://<APP_URL>/api/metrics"`  
  → 200, `billing.ingest`, `billing.ingest_source` (redis | memory).

---

## 6. Sonra (ihtiyaçta)

- **PR-9 (partition/BRIN):** `docs/OPS/SCALING_INGEST_IDEMPOTENCY.md` runbook’una göre; satır sayısı ~5–10M veya reconciliation/cleanup yavaşlayınca değerlendir.

---

**Not:** Tüm cron route’ları `requireCronAuth` kullanır; `Authorization: Bearer <CRON_SECRET>` gerekir.
