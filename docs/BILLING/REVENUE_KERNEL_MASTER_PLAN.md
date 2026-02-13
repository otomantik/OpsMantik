# Revenue Kernel — Master Freeze (taslak)

**Tarih:** 2026-02-13  
**Durum:** Taslak / Donmuş referans

---

## Amaç

OpsMantik’te faturalanabilir kullanımın **tek kaynak gerçeği**:

- **Invoice SoT** = `ingest_idempotency` BILLABLE satırları (`site_id` + ay)
- Redis / events / sessions **fatura otoritesi değildir**.

---

## Invariants (asla bozulmaz)

| İnvaryant | Açıklama |
|-----------|----------|
| **Billable Event = Idempotency insert success** | Faturalanabilir birim, idempotency tablosuna başarıyla insert edilen satırdır. |
| **Duplicate → non-billable, publish yok** | Duplicate istek 200 + `x-opsmantik-dedup: 1` döner; QStash’a publish edilmez, fatura kesilmez. |
| **Rate-limit 429 → non-billable, idempotency insert yok** | 429 dönen isteklerde idempotency satırı yazılmaz; fatura kesilmez. |
| **QStash fail → fallback buffer’a yazılır → billable (capture)** | Yayın başarısız olursa `ingest_fallback_buffer`’a yazılır; fatura **capture anında** kesilir, recovery’de değil. |
| **Redis SoT değildir** | Redis sıfırlansa bile fatura sayısı bozulmaz; hesap sadece Postgres’ten yapılır. |

---

## Data access rule

**Tenant asla `ingest_idempotency.billable` veya `billing_state` update edemez; sadece service_role / reconciliation job yazar.**  
Bu kural, dispute senaryosunda “müşteri veriyi manipüle etmiş” riskini kapatır. Site member yalnızca kendi site’ına ait satırları okuyabilir (dispute export); INSERT/UPDATE/DELETE yalnızca API (service_role) ve reconciliation cron’a aittir.

---

## PR Dependency Graph

```
PR-1 (Schema) ──────────────────────────────────────────────────────────────┐
     │                                                                       │
     ├──► PR-3 (Quota) ─── soft/overage/cap davranışı                       │
     ├──► PR-4 (Reconciliation) ─── monthly ledger fill + drift alarm        │
     ├──► PR-6 (Dispute export) ─── itiraz çıktıları                         │
     └──► PR-7 (Dispute/export tool)                                         │
     │                                                                       │
PR-2 (Idempotency v2 + versioning) ─── duplicate/billing determinism         │
     │                                                                       │
PR-5 (Fallback recovery) ─── degraded capture + publish recovery            │
     │                                                                       │
PR-8 (Observability) ─── metrik + Watchtower                               │
```

- **PR-1 (Schema):** `site_plans`, `site_usage_monthly`, `invoice_snapshot`, `billing_state`, `ingest_idempotency` genişletmesi → PR-3/4/6/7’nin temeli.
- **PR-2 (Idempotency v2):** Event-specific bucket, versioning → duplicate ve billing determinism.
- **PR-3 (Quota):** Soft / overage / hard cap davranışı.
- **PR-5 (Fallback recovery):** Degraded capture + recovery cron.
- **PR-4 (Reconciliation):** Aylık ledger doldurma + drift alarm.
- **PR-6 / PR-7 (Dispute export):** Itiraz çıktıları (deterministik sıra, hash, CSV).
- **PR-8 (Observability):** Metrikler + Watchtower entegrasyonu.

---

## Idempotency v1 / v2 (PR-2)

| Version | Time bucket | Key format | Kullanım |
|--------|-------------|------------|----------|
| **v1** | Tek 5s penceresi | 64-char hex (prefix yok) | Varsayılan; mevcut satırlarla uyumlu. |
| **v2** | Event-specific | `v2:<64-char hex>` | `OPSMANTIK_IDEMPOTENCY_VERSION=2` ile açılır. |

**v2 bucket kuralları:** heartbeat = 10s, page_view = 2s, click / call_intent = 0s (tam timestamp ms). UNIQUE(site_id, idempotency_key) aynen kalır; versiyon key prefix (`v2:`) ile kodlanır, mevcut fatura kırılmaz.

**Güvenlik (v2):** click ve call_intent için idempotency zaman bileşeni **yalnızca sunucu zamanı** (`getServerNowMs()` / route’tan geçirilen `serverNowMs`) kullanılır; istemci tarafından gönderilen `ts`, `t`, `timestamp`, `created_at` vb. alanlar **dikkate alınmaz**. Böylece istemcinin zamanı değiştirerek dedup’ı bypass edip fatura satırı şişirmesi engellenir. heartbeat/page_view için payload timestamp yalnızca sunucu zamanına ±5 dakika içindeyse kullanılır; aksi halde sunucu zamanına kıstırılır.

**Kod:** v1 = `computeIdempotencyKey()` (değiştirilmez); v2 = `computeIdempotencyKeyV2()`. Route env `OPSMANTIK_IDEMPOTENCY_VERSION` ile hangi fonksiyonun kullanılacağını seçer (default `"1"`). Rollout: env `2` yapılınca v2; rollback: env `1` veya unset.

## Rollout Strategy

- **PR-1 / PR-2:** Feature-flag’li açılır.
- **PR-2:** `OPSMANTIK_IDEMPOTENCY_VERSION` env: `1` (default) v1, `2` v2. v1 korunur; v2 devreye alınınca yeni key’ler `v2:<hash>` olur.
- **Fatura hesabı:** Sadece DB’den (`ingest_idempotency` + reconciliation); Redis/events/sessions kullanılmaz.

---

## Rollback

- **v2 kapat → v1’e dön:** Idempotency v2 flag’i kapatılarak v1 davranışına dönülür.
- **Schema additive:** Yeni tablolar/kolonlar geri alınmaz; sadece yeni kod yolları (quota, v2 idempotency) kapatılır.

---

## İlgili belgeler

- `REVENUE_KERNEL_SPEC.md` — Billable unit, kota, metering, failure mode.
- `REVENUE_KERNEL_ARCHITECTURE_AUDIT.md` — Mimari denetim ve dondurulmuş kurallar.
- `REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE.md` — Uygulama kanıtı, curl, Go/No-Go checklist.
