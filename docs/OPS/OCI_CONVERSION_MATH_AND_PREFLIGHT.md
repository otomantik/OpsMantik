# OCI dönüşüm matematiği ve pre-flight (kemikleştirilmiş sözleşme)

Bu belge production’a **yüksek hacimli (“tanrı modu”)** dönüşüm göndermeden önce ve sonra uyulacak **matematiksel invariant’ları** ve kontrol listesini sabitler. Git ile birlikte yaşayan tek doğruluk kaynağıdır.

## Üç değişmez (merge öncesi)

1. **Zaman:** Google’a giden `conversion_time` / `occurred_at` = iş olayı zamanı (`call_funnel_ledger`, seal, `calls.confirmed_at` / `created_at`). Backfill **asla** çalışma anının `NOW()`’unu Google zamanı olarak kullanmaz.
2. **Sıra (won):** Seal ile oluşan won satırı **sessizce silinmez**. Precursor’lar hazır değilse **`BLOCKED_PRECEEDING_SIGNALS`**. Export seçimi **yalnız** `QUEUED` / `RETRY`. **`BLOCKED_*` → `QUEUED`** yalnızca **`promote-blocked-queue`** (veya eşdeğer worker + `append_worker_transition_batch_v2`).
3. **Claim:** `append_script_claim_transition_batch` SQL içinde **`WHERE q.status IN ('QUEUED','RETRY')`** — bloklu satır claim edilemez.

## Hat A — Sinyal (contacted / offered)

| Adım | Koşul | Sonuç |
|------|--------|--------|
| Export adayı | En az bir click id | `marketing_signals` upsert; yoksa `oci_reconciliation_events` (`missing_click_ids`) |
| Sıra bloklayıcı dispatch | `PENDING`, `PROCESSING`, `STALLED_FOR_HUMAN_AUDIT` | Won tarafı **`BLOCKED_PRECEEDING_SIGNALS`** (queue’da satır var) |

## Hat B — Won (offline_conversion_queue)

| Durum | Export seçilebilir mi? |
|--------|-------------------------|
| `QUEUED`, `RETRY` | Evet (`export-fetch`) |
| `BLOCKED_PRECEEDING_SIGNALS` | Hayır — önce promoter |
| Diğerleri | Mevcut iş kuralları |

**Parite:** `QueueStatus` / `QUEUE_STATUSES` ↔ Postgres `CHECK` ↔ export filtresi — `tests/unit/oci-queue-ssot-parity.test.ts` ve touchpoint testleri.

## Backfill zaman seçimi (saf fonksiyon)

Kaynak: `lib/oci/precursor-backfill-plan.ts` → `planPrecursorBackfillStages`.

- **`ledger`:** `call_funnel_ledger` içinde ilgili `event_type` için `occurred_at`.
- **`call_snapshot_hybrid`:** Ledger’da **başka** bir precursor var ama bu stage için yok; **calls.status** stage’i gerektiriyorsa zaman = `confirmed_at` veya `created_at` (job saati değil).
- **`call_snapshot_fallback`:** Bu çağrı için ledger satırı **hiç yok**; tüm stage’ler snapshot zamanıyla.

Birim testler: `tests/unit/precursor-backfill-plan.test.ts`.

## Pre-flight checklist (deploy / yoğun gönderim öncesi)

1. Migration’lar uygulandı: `20260503100000_oci_ssot_blocked_and_reconciliation.sql`, `20260503100100_oci_snapshot_and_manual_blocked_clear.sql`.
2. `npm run verify:i18n:keys` (OCI Control yeni anahtarlar).
3. OCI matematiği birim testleri (özet set):
   `node --import tsx --test tests/unit/oci-queue-ssot-parity.test.ts tests/unit/oci-export-touchpoints.test.ts tests/unit/precursor-backfill-plan.test.ts tests/unit/oci-backfill-time-source.test.ts`
4. Deploy gate (workspace kuralı): `npm run smoke:intent-multi-site` — 2/2 site PASS olmadan deploy yok.
5. Cron’lar: `oci/promote-blocked-queue` zamanlandı mı? (Bloklu won birikimini çözer.)
6. Canary: bir sitede `queue-stats` → `BLOCKED_PRECEEDING_SIGNALS`, `promotionReadyInSample`, `oldestBlockedAgeSeconds` izlenir.

## Yoğun gönderim sırasında izleme

- **Artan `BLOCKED_PRECEEDING_SIGNALS` + yaş:** Precursor export veya ACK gecikmesi.
- **`promotionReadyInSample` > 0 sürekli:** Promoter cron çalışmıyor veya RPC hatası.
- **Sadece `QUEUED`/`RETRY` yükselmesi** export-fetch ile uyumlu olmalı.

## İlgili dosyalar

- Runbook: `docs/runbooks/OCI_SSOT_TROUBLESHOOTING.md`
- Taksonomi: `lib/domain/oci/export-eligible-taxonomy.ts`
- Touchpoint testleri: `tests/unit/oci-export-touchpoints.test.ts`
