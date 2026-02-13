# Revenue Kernel Spec — Faturalanabilir Kullanımın Tek Kaynak Gerçeği

**Amaç:** Sistemi faturalanabilir ve itiraza dayanıklı kılan tek kaynak gerçeği (single source of truth).  
**Kapsam:** Billable unit tanımı, idempotency, kota, metering, failure mode, dispute-proofing.

---

## 1) Scope and Non-Goals

**Scope:**
- Billable Unit’in deterministik tanımı.
- Tenant bazlı kota (Hard, Soft, Hard Cap).
- Çift katman metering (Redis = performans, Postgres = mali gerçek).
- Başarısızlık modlarında gelir bütünlüğü, veri kaybı yok.

**Non-Goals:**
- Ödeme işleme (Stripe’a delege).
- Fatura PDF üretimi.
- Plan seçim UI.
- Çok para birimi (base: USD).

---

## 2) Glossary

| Terim | Tanım |
|-------|--------|
| **Billable Event** | Idempotency kapısından geçen, benzersiz ve başarıyla ingest veya buffer’a yazılmış event. |
| **Duplicate Event** | Idempotency penceresi içinde aynı payload hash’ine sahip event. Maliyet: $0. |
| **Hard Limit** | Kotanın aşıldığı, ingestion’ın reddedildiği eşik (HTTP 429). Free tier’da yaygın. |
| **Soft Limit** | Ingestion devam eder, “Overage” olarak işaretlenir. Pro tier’da yaygın. |
| **Hard Cap** | Güvenlik devre kesici (örn. planın %200’ü); Soft Limit planlarda bile red. |
| **Idempotency Key** | Event niteliklerinden türetilen deterministik hash (SHA-256); duplicate tespiti. |
| **Reconciliation** | Redis sayaçlarının, otorite Postgres ledger’a göre düzeltilmesi (async). |
| **Fallback Buffer** | QStash kullanılamazken event’lerin yazıldığı Postgres tablosu. Bu event’ler billable’dır. |

---

## 3) Actors and Tenancy Model

- **Tenant (Site):** Birincil faturalama birimi. Kota ve usage strictly `site_id` kapsamında.
- **Kernel:** Limitleri uygulayan güvenilir hesaplama tabanı.
- **User:** Tenant’ın kimliği doğrulanmış üyesi; bireysel usage biriktirmez.

---

## 4) Billable Units (What counts, what never counts)

**Billable (sayılır):**
- **Standard Ingest:** Validate edilmiş, duplicate olmayan, QStash’a publish edilmiş event.
- **Degraded Ingest:** QStash down iken `ingest_fallback_buffer`’a yazılan event (veriyi kurtardığımız için değer sağlandı).
- **Recovered Event:** Buffer’dan kuyruğa taşınan event — fatura **capture anında** kesilir, recovery anında değil.

**Non-Billable (sayılmaz):**
- **Duplicate:** Idempotency kapısında red (HTTP 200, `status: "duplicate"`).
- **Throttled / Quota / Rate-limit:** Hard limit veya abuse rate limit nedeniyle red (HTTP 429).
- **Validation Failures:** Malformed JSON, geçersiz API key (HTTP 400/401).
- **Internal Traffic:** Health check veya sentetik probe (belirli header/IP ile tanımlanır).

**Invoice source of truth (kilit cümle):**  
*Fatura kullanımı = fatura ayı kapsamında `ingest_idempotency` tablosundaki BILLABLE satırlarının sayısıdır (site_id + ay scope). `events` / `sessions` aggregate yalnızca sanity check ve drift detection içindir; fatura sayısı bunlardan türetilmez.*

---

## 5) Idempotency Invariants

**İnvaryant:** Billable Event = Idempotent Event. Sistem bir event’in benzersiz olduğunu kanıtlayamıyorsa o event için fatura kesilmez.

**Key tasarımı:**
- **Algoritma:** SHA-256.
- **Girdi:** `site_id` + `event_name` + `normalized_url` + `session_fingerprint` + `time_bucket`.
- **Time bucket:** `floor(timestamp / 5000)` ms. 5 saniyelik pencere, dedup ile meşru hızlı art arda event’ler arasında denge sağlar.

**Akış:**
1. Key hesapla.
2. `ingest_idempotency` tablosuna INSERT dene (ON CONFLICT DO NOTHING).
3. Conflict (duplicate) → Duplicate dön; usage artırma.
4. Başarılı insert → Quota kontrolüne geç.

**Retention (mutabık):**  
`ingest_idempotency` kayıtları en az **1 fatura dönemi + itiraz penceresi** kadar tutulmalıdır. Önerilen policy: **90 gün** veya **120 gün** (veya “cari ay + önceki 2 ay”). 24 saat fatura ve itiraz için yetersizdir; implementasyon bu policy’e göre TTL/archive ile uyumlu olmalıdır.

---

## 6) Metering Architecture (Redis vs Postgres)

- **Redis:** Sadece performans katmanı. Source of truth değildir; kaybolsa/ sıfırlansa finansal risk yok.
- **Postgres:** Fatura ve dispute için tek otorite. Reconciliation ve invoice count Postgres’ten (ingest_idempotency) türetilir.

**Katman 1 – Performance (Redis):**  
Key: `usage:{site_id}:{YYYY-MM}`. Ingress’te GET, worker başarısında INCR. Ephemeral.

**Katman 2 – Financial Ledger (Postgres):**  
Tablo: `site_usage_monthly`. Periyodik reconciliation cron ile `ingest_idempotency` (site_id + ay) COUNT ile güncellenir. ACID.

---

## 7) Quota Semantics (hard / soft / cap + response codes + headers)

**Akış (/api/sync):**
1. Idempotency check → duplicate ise 200 dön (billable yok).
2. Plan & usage al (Cache/DB): `plan_tier`, `hard_limit`, `soft_limit_enabled`.
3. Değerlendir:
   - usage < limit → ALLOW.
   - usage ≥ limit ve `soft_limit_enabled`: usage > hard_cap (örn. limit × 2) → REJECT (429); değilse ALLOW (Overage).
   - usage ≥ limit ve `!soft_limit_enabled` → REJECT (429).

**429 ayrımı (mutabık):**  
429 her zaman aynı anlama gelmez. İki neden ayrılmalıdır:
- **Quota aşımı:** `x-opsmantik-quota-exceeded: 1` + `Retry-After` (ay sıfırlanması / policy).
- **Rate-limit / abuse:** `x-opsmantik-ratelimit: 1` (veya mevcut şemada net bir header).  
Böylece müşteri itirazında “kotam mı doldu, güvenlik mi kesti?” delille ayrılır.

**Response sözleşmeleri:**

| Durum | HTTP | Örnek header’lar |
|-------|------|-------------------|
| Allowed (standard) | 200 OK | `x-opsmantik-quota-remaining: 4500`, `x-opsmantik-dedup: 0` |
| Allowed (overage / soft) | 200 OK | `x-opsmantik-quota-remaining: 0`, `x-opsmantik-overage: true`, `x-opsmantik-dedup: 0` |
| Rejected (quota / hard cap) | 429 Too Many Requests | `Retry-After: 3600`, `x-opsmantik-quota-exceeded: 1` |
| Rejected (rate-limit / abuse) | 429 Too Many Requests | `x-opsmantik-ratelimit: 1` |
| Duplicate (non-billable) | 200 OK | `x-opsmantik-dedup: 1`; body’de `ingest_id` **omit edilebilir veya null olabilir** (pratik: omit kabul edilir). |
| Degraded (fallback) | 200 OK | `x-opsmantik-degraded: qstash_publish_failed`, `x-opsmantik-fallback: true` |

---

## 8) Dispute-Proofing

Müşteri itirazında (“1M event göndermedim”) kanıt:

- **Kanıt tablosu:** `ingest_idempotency`.
- **Üretilebilir delil:** İlgili `site_id` ve fatura dönemi için `idempotency_key` + `created_at` listesi.
- **Reconcilability:** Fatura ayı için `ingest_idempotency` satır sayısı, faturalanan tutarla eşleşir (±1% drift yalnızca cache/async increment gecikmesi için kabul edilebilir; nihai fatura DB’den üretilir).

---

## 9) Failure Modes

| Bileşen | Ingestion etkisi | Billing etkisi | Kurtarma |
|---------|-------------------|----------------|----------|
| QStash down | Degraded (200), `ingest_fallback_buffer`’a yazılır. | Billable (capture değer sağlar). | Recovery cron sonra tekrar publish eder. |
| Redis down | Degraded (200). Quota check PG snapshot’a düşer. | Billable. Sayaçlar sonra reconcile edilir. | Conservative mode (Hard Limit’e yakınsa red). |
| Postgres down | Critical (500). Tenant/idempotency yazılamaz. | Non-billable; veri kabul edilmez. | İstemci retry (client-side buffer). |
| Worker crash | QStash retry ile güvenli. | Idempotency key retry’da çift faturayı engeller. | Standart QStash DLQ. |

---

## 10) Data Model (high level)

- **site_plans:** `site_id`, `plan_tier`, `monthly_limit`, `soft_limit_enabled`, `hard_cap_multiplier`.
- **site_usage_monthly (source of truth for invoice):** `site_id`, `year_month`, `event_count`, `last_synced_at`. Değer, `ingest_idempotency` (site_id + ay) COUNT ile doldurulur.
- **ingest_idempotency (gate):** `site_id`, `idempotency_key`, `created_at`. UNIQUE(site_id, idempotency_key). Retention: 90–120 gün veya cari ay + önceki 2 ay (fatura + itiraz penceresi).

---

## 11) Security & Abuse Controls

- **Spoofing:** Tüm giriş geçerli Public API Key ile `site_id` çözümlemesi gerektirir.
- **Rate limiting (abuse):** Quota’dan bağımsız; IP bazlı (örn. 100 req/s). Redis/Edge ile 429; gerekirse credential doğrulamadan önce red (ucuz). Header: `x-opsmantik-ratelimit: 1`.
- **Overage koruma:** Hard Cap, Pro plan’da sızıntılı API key ile sınırsız overage’ı engeller.

---

## 12) Observability

**Golden signals:**  
`billing.ingest.allowed`, `billing.ingest.duplicate`, `billing.ingest.rejected_quota`, `billing.ingest.overage`, `billing.reconciliation.drift`.

**Zorunlu header’lar:**  
`x-opsmantik-dedup`, `x-opsmantik-quota-remaining`, `x-opsmantik-overage` (uygulanabiliyorsa), `x-opsmantik-quota-exceeded`, `x-opsmantik-ratelimit`, `x-opsmantik-commit`, `x-opsmantik-branch`, `x-opsmantik-degraded`, `x-opsmantik-fallback`.

Watchtower ile entegrasyon: degradation ve failure count’lar mevcut pattern’e uyumlu.

---

## 13) Acceptance Criteria (PR-1 .. PR-8)

- **PR-1 Schema:** `site_plans`, `site_usage_monthly` RLS ile; unique constraint’ler.
- **PR-2 Idempotency:** Duplicate’ta 200 + `x-opsmantik-dedup: 1`; duplicate QStash’a gitmez; duplicate body’de `ingest_id` omit veya null.
- **PR-3 Quota:** Redis lookup &lt;10ms; Hard limit → 429 + `x-opsmantik-quota-exceeded`; Soft limit → 200 + overage log; 429’da Quota vs Rate-limit header ayrımı.
- **PR-4 Reconciliation:** Worker Redis INCR best-effort; cron `site_usage_monthly`’yi DB count ile günceller; FOR UPDATE SKIP LOCKED ile yarış önlenir.
- **PR-5 Failure:** Redis down → PG snapshot ile kabul; QStash down → Fallback buffer ile kabul.
- **PR-6 Dispute:** Fatura dönemi için site bazında idempotency listesi üretilebilir.
- **PR-7 Retention:** ingest_idempotency 90/120 gün (veya cari + 2 ay) policy.
- **PR-8 Observability:** Yukarıdaki header’lar ve billing metric’leri.

---

## 14) Open Questions

- **Overage fiyatlandırma:** Overage anlık mı, ay sonu mu hesaplanır? (Öneri: Ay sonu, `site_usage_monthly`’ye göre.)
- **Mevcut kullanıcı migration:** Alpha kullanıcılar için limit nasıl başlatılır? (Öneri: “Free” plan default ile seed.)

---

*Bu doküman, dört mutabakat (duplicate ingest_id, invoice SoT, 429 ayrımı, idempotency retention) ile kilitlenmiştir.*
