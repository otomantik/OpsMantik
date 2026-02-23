# 📘 REVENUE KERNEL RELEASE RUNBOOK

**Scope:** OpsMantik – Billing / Revenue Kernel only  
**Applies to:** PR-1, PR-2, PR-3, PR-4 and all subsequent billing-impacting changes

---

## 1️⃣ Purpose

Revenue Kernel is the core of financial correctness.

This runbook aims to:

- Prevent phantom usage risk
- Prevent double billing risk
- Catch drift early
- Preserve financial integrity during deploy

---

## 2️⃣ Golden Rules (Non-Negotiable)

- **Billable Event = Successfully inserted idempotency row**
- If DB insert fails → no publish
- **Invoice SoT = ingest_idempotency WHERE billable=true**
- Redis is never financial authority
- Quota 429 and rate-limit 429 must remain distinct
- **Dispute Evidence = CSV Export from `ingest_idempotency`**
- **Invoice Finality = `invoice_snapshot` table (immutable)**

---

## 3️⃣ Release Gate Checklist (Pre-Deploy)

To deploy:

### ✅ A. Test Gate

```bash
node --import tsx --test tests/unit/revenue-kernel-gates.test.ts
node --import tsx --test tests/billing/financial-proofing.test.ts
npm run test:unit
```

**Conditions:**

- 0 fail
- PR gate tests green
- Idempotency + Quota tests green
- Financial Proofing (Dispute/Freeze) tests green

### ✅ B. Static Invariant Check

The following must exist in code:

- `billing_gate_closed`
- `x-opsmantik-quota-exceeded`
- `x-opsmantik-ratelimit`
- `billable=false` update on quota reject
- return 500 before publish on idempotency error

### ✅ C. Migration Safety (Schema değiştiyse)

- Migration additive olmalı
- Enum değişiklikleri backward compatible olmalı
- DROP / destructive değişiklik prod'da yasak
- Yeni “billing proof” kolonları gibi değişikliklerde **önce migration**, sonra deploy (schema drift toleransı olsa bile evidence için şart).

---

## 3.1 Quota incident quick-reference links

- Temporary unblock SQL: `docs/runbooks/TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md`
- Incident runbook (quota + call-event): `docs/runbooks/QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md`

---

## 4️⃣ Deployment Strategy

**Option A — Safe Default**

- Deploy with feature flag off if present
- Canary: single site_id

**Option B — Full deploy**

- Only if Test Gate + Smoke completed

---

## 4.1 Release'i canlıya alma planı (en güvenlisi)

Canlıya “şimdi almayalım” dense bile, release için standart prosedür:

### A) PR aç

GitHub’da:

- **base:** `master`
- **compare:** `release/revenue-kernel-pr1-4`

PR merge edildikten sonra prod deploy (Vercel) tetiklenir.

### B) Merge sonrası prod deploy doğrulaması

Deploy commit prod’a çıkınca:

1. **Commit hash doğrula:** Response header’dan `x-opsmantik-commit` ile deploy edilen commit’i kontrol et.
2. **Cron smoke (2 endpoint):**

```powershell
$CONSOLE_URL = "https://console.opsmantik.com"
# Set secret (CRON_FORBIDDEN if empty)
$env:CRON_SECRET = "..."   # gerçek secret (Vercel env’den)

curl.exe -s -D - -X GET "$CONSOLE_URL/api/cron/watchtower" -H "Authorization: Bearer $env:CRON_SECRET"
curl.exe -s -D - -X POST "$CONSOLE_URL/api/cron/reconcile-usage/run" -H "Authorization: Bearer $env:CRON_SECRET"
```

**Expected:**

- **watchtower** → 200, body “ok”
- **reconcile run** → 200, body’de `processed` (aktif site varsa > 0)

---

## 4.5 Cron auth doğrulama (CRON_FORBIDDEN önlemi)

CRON_FORBIDDEN genelde shell'de CRON_SECRET boş/yanlış olduğunda olur. Kalıcı çözüm: `$env:CRON_SECRET` set et (profil veya çağrıdan önce), çağrıda `-H "Authorization: Bearer $env:CRON_SECRET"` kullan.

Cron smoke geçerli sayılmadan önce auth 200 dönmeli. PowerShell’de `$CRON_SECRET` boşsa header `Bearer ` gider → 403.

**1) Secret’ın set olduğunu kontrol et**

```powershell
# PowerShell: show variable (must not be empty)
$env:CRON_SECRET
# or one-time set:
$env:CRON_SECRET = "actual-secret-value"
```

**2) Quick test with Watchtower (200 → secret correct)**

```powershell
$CONSOLE_URL = "https://console.opsmantik.com"   # prod
curl.exe -s -D - -X GET "$CONSOLE_URL/api/cron/watchtower" -H "Authorization: Bearer $env:CRON_SECRET"
```

- **200** → secret doğru, cron smoke geçerli.
- **403** → secret yanlış veya prod env’de `CRON_SECRET` yok/değişti.

**3) If header escaping is suspect (safe method)**

```powershell
$h = @("Authorization: Bearer $env:CRON_SECRET")
curl.exe -s -X GET "$CONSOLE_URL/api/cron/reconcile-usage/enqueue" -H $h
```

---

## 5️⃣ Post-Deploy Smoke (5 Dakika)

### 🔎 1. Duplicate testi

Aynı payload 2 kez gönder:

**Expected:**

- 2. request → 200
- `x-opsmantik-dedup: 1`
- publish yok

### 🔎 2. Rate limit testi

Limit aş:

**Expected:**

- 429
- `x-opsmantik-ratelimit: 1`
- `x-opsmantik-quota-exceeded` YOK

### 🔎 3. Quota reject testi

Limit doldur:

**Expected:**

- 429
- `x-opsmantik-quota-exceeded: 1`
- Retry-After var

**DB kontrol:**

```sql
SELECT billable
FROM ingest_idempotency
WHERE site_id='<site_uuid>'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** reject satır → `billable=false`

**Reconciliation kanıt (COMPLETED job vs idempotency/site_usage_monthly):**

```sql
SELECT
  j.site_id, j.year_month, j.updated_at AS job_time,
  (SELECT COUNT(*) FROM ingest_idempotency i
   WHERE i.site_id = j.site_id AND i.year_month = j.year_month AND i.billable = true) AS billable_total_now,
  (SELECT event_count FROM site_usage_monthly u
   WHERE u.site_id = j.site_id AND u.year_month = j.year_month) AS monthly_event_count
FROM billing_reconciliation_jobs j
WHERE j.status = 'COMPLETED'
ORDER BY j.updated_at DESC
LIMIT 5;
```

`billable_total_now` = `monthly_event_count` ise reconciliation doğru çalışıyor.

### 🔎 4. Overage testi (soft limit)

**Expected:**

- 200
- `x-opsmantik-overage: true`
- DB → `billing_state=OVERAGE`

### 🔎 5. Financial Finality Testi (Phase 1)

**Dispute Export:**

- Tarayıcıda `https://console.opsmantik.com/api/billing/dispute-export?site_id=...&year_month=...`
- Beklenen: CSV dosyası iner.
- `idempotency_key` sütunu var mı?

**Invoice Freeze:**

- `curl -X POST https://console.opsmantik.com/api/cron/invoice-freeze -H "Authorization: Bearer $CRON_SECRET"`
- Beklenen: `{ ok: true, frozen: ... }`

---

## 6️⃣ Emergency Rollback Plan

**Situations requiring rollback:**

- Phantom usage şüphesi
- Duplicate publish şüphesi
- 429 header ayrımı bozulmuş
- Idempotency insert bypass edilmiş
- Dispute export yanlış veri sızdırıyor

**Rollback steps**

1. Billing feature flag kapat
2. Önceki stable tag'e dön
3. Drift analizi yap:

   ```sql
   SELECT COUNT(*) FROM ingest_idempotency WHERE billable=true;
   ```

4. Olası publish ama no-idempotency event'leri kontrol et

---

## 7️⃣ Production Monitoring (Minimum)

İzlenecek metrikler:

- `billing.ingest.allowed`
- `billing.ingest.duplicate`
- `billing.ingest.rejected_quota`
- `billing.ingest.overage`
- `ingestPublishFailuresLast15m`
- (PR-4 sonrası) `billing.reconciliation.drift`

---

## 7.1 Cron Schedules

| Cron Job | Endpoint | Schedule | Purpose |
| :--- | :--- | :--- | :--- |
| **Reconcile Usage** | `GET /api/cron/reconcile-usage` | Her 15 dk | Usage sayıcılarını (Redis vs PG) eşitler. SoT'yi (ingest_idempotency) baz alır. |
| **Invoice Freeze** | `POST /api/cron/invoice-freeze` | Ayın 1. günü 00:00 UTC | Önceki ayın usage'ını `invoice_snapshot` tablosuna kilitler (immutable). |
| **Idempotency Cleanup** | `POST /api/cron/idempotency-cleanup` | Her gün 03:00 UTC | 90 günden eski rowları batch (max 10k/run) siler; büyük backlog’ta birkaç run gerekebilir. `?dry_run=true` ile önizleme. |
| **Watchtower** | `GET /api/cron/watchtower` | Her 15 dk | Sistem sağlığı ve "Dead Man Switch" kontrolü. |

---

## 8️⃣ Definition of Done

Bir Revenue PR ancak şu durumda DONE sayılır:

- Unit tests green
- PR gates green
- Smoke testi tamam
- Evidence doc güncel
- Runbook checklist işaretli
- **Dispute Export authorization verified**
- **Invoice Snapshot hash verified**

---

## 9️⃣ Post-deploy (first deploy / after migration)

For steps after deploy or new migration (e.g. idempotency cleanup RPC): **`docs/runbooks/DEPLOY_CHECKLIST_REVENUE_KERNEL.md`**.  
Migration, Redis/CRON_SECRET env, lifecycle test, cron schedule, dry_run ve metrics smoke orada listelenir.

---
