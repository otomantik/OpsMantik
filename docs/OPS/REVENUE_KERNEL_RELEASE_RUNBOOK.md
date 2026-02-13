# 📘 REVENUE KERNEL RELEASE RUNBOOK

**Scope:** OpsMantik – Billing / Revenue Kernel only  
**Applies to:** PR-1, PR-2, PR-3, PR-4 ve sonrası tüm faturalama etkileyen değişiklikler

---

## 1️⃣ Amaç

Revenue Kernel finansal doğruluğun kalbidir.

Bu runbook'un amacı:

- Phantom usage riskini önlemek
- Double billing riskini önlemek
- Drift'i erken yakalamak
- Deploy sırasında finansal integrity'yi korumak

---

## 2️⃣ Golden Rules (Non-Negotiable)

- **Billable Event = Successfully inserted idempotency row**
- DB insert başarısızsa → publish yok
- **Invoice SoT = ingest_idempotency WHERE billable=true**
- Redis asla finansal otorite değildir
- Quota 429 ve rate-limit 429 ayrı kalmalıdır

---

## 3️⃣ Release Gate Checklist (Deploy Öncesi)

Deploy edebilmek için:

### ✅ A. Test Gate

```bash
node --import tsx --test tests/unit/revenue-kernel-gates.test.ts
npm run test:unit
```

**Koşullar:**

- 0 fail
- PR gate testleri green
- Idempotency + Quota testleri green

### ✅ B. Static Invariant Check

Aşağıdakiler kodda bulunmalı:

- `billing_gate_closed`
- `x-opsmantik-quota-exceeded`
- `x-opsmantik-ratelimit`
- `billable=false` update on quota reject
- return 500 before publish on idempotency error

### ✅ C. Migration Safety (Schema değiştiyse)

- Migration additive olmalı
- Enum değişiklikleri backward compatible olmalı
- DROP / destructive değişiklik prod'da yasak

---

## 4️⃣ Deployment Strategy

**Option A — Safe Default**

- Feature flag varsa kapalı deploy
- Canary: tek site_id

**Option B — Full deploy**

- Ancak Test Gate + Smoke tamamlandıysa

---

## 5️⃣ Post-Deploy Smoke (5 Dakika)

### 🔎 1. Duplicate testi

Aynı payload 2 kez gönder:

**Beklenen:**

- 2. request → 200
- `x-opsmantik-dedup: 1`
- publish yok

### 🔎 2. Rate limit testi

Limit aş:

**Beklenen:**

- 429
- `x-opsmantik-ratelimit: 1`
- `x-opsmantik-quota-exceeded` YOK

### 🔎 3. Quota reject testi

Limit doldur:

**Beklenen:**

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

**Beklenen:** reject satır → `billable=false`

### 🔎 4. Overage testi (soft limit)

**Beklenen:**

- 200
- `x-opsmantik-overage: true`
- DB → `billing_state=OVERAGE`

---

## 6️⃣ Emergency Rollback Plan

**Rollback gerektiren durumlar:**

- Phantom usage şüphesi
- Duplicate publish şüphesi
- 429 header ayrımı bozulmuş
- Idempotency insert bypass edilmiş

**Rollback Adımları**

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

## 8️⃣ Forbidden Changes (Without CTO Approval)

Aşağıdakiler doğrudan prod'da değiştirilemez:

- Idempotency key format
- Invoice SoT tablosu
- `billable` alan mantığı
- `billing_state` enum semantics
- 429 header contract

---

## 9️⃣ Definition of Done (Revenue PR)

Bir Revenue PR ancak şu durumda DONE sayılır:

- Unit tests green
- PR gates green
- Smoke testi tamam
- Evidence doc güncel
- Runbook checklist işaretli

---

## 🔐 Final Principle

**Revenue Kernel is a financial boundary, not just a feature.**

Bu dosya repo'da olduğu sürece:

- Takımın disiplini korunur
- Enterprise audit'e hazır olunur
- "Bu event neden faturada yok?" tartışması teknik olarak kapanır
