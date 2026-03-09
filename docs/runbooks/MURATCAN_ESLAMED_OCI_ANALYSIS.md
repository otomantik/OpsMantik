# Muratcan vs Eslamed OCI Analizi — Kontroller & Intent Karşılaştırması

**Tarih:** 25 Şubat 2026  
**Amaç:** Muratcan AKÜ kontrollerini yapmak, Eslamed ile intent/OCI kurulum karşılaştırması

---

## 1. Muratcan Kontrolleri (25 Şub 2026)

### 1.1 Session Diagnostic (`oci-diagnostic-sessions.mjs Muratcan`)

| Metrik | Değer |
|--------|-------|
| Toplam kuyruk | 5 satır |
| Session dağılımı | 5 farklı session (her satır ayrı session) |
| Session dedup etkisi | Yok — tüm satırlar export'a gidebilir |
| Status | Hepsi **COMPLETED** |
| Hata (provider_error_code) | Yok |

### 1.2 Queue Check (`oci-queue-check.mjs Muratcan`)

| Alan | Değer |
|------|-------|
| Site | Muratcan AKÜ |
| UUID | c644fff7-9d7a-440d-b9bf-99f3a0f86073 |
| public_id | 28cf0aefaa074f5bb29e818a9d53b488 |
| oci_sync_method | **script** |
| QUEUED/RETRY | 0 (işlenecek satır yok) |
| COMPLETED | 5 (hepsi `uploaded_at` dolu) |

**Sonuç:** Muratcan kuyruğunda bekleyen satır yok. Tüm 5 dönüşüm Google'a başarıyla gönderilmiş.

---

## 2. Eslamed vs Muratcan — Intent & OCI Kurulum Karşılaştırması

### 2.1 Site Konfigürasyonu

| Alan | Eslamed | Muratcan |
|------|---------|----------|
| Site adı | Eslamed | Muratcan AKÜ |
| UUID | b1264552-c859-40cb-a3fb-0ba057afd070 | c644fff7-9d7a-440d-b9bf-99f3a0f86073 |
| public_id | 81d957f3c7534f53b12ff305f9f07ae7 | 28cf0aefaa074f5bb29e818a9d53b488 |
| Domain | eslamed.com | muratcanaku.com |
| oci_sync_method | script | script |
| intent_weights (default) | `{"junk":0,"pending":0.02,"qualified":0.20,"sealed":1.0}` | Aynı (migration default) |

### 2.2 Intent Akışı (Her İki Site İçin Aynı)

```
call-event → Hunter AI / Operatör → oci_status = 'sealed'
    ↓
offline_conversion_queue (INSERT → status=QUEUED)
    ↓
Export API (script çeker) → value_cents, conversion_time (yyyy-mm-dd HH:mm:ss+0300)
    ↓
Google Ads Script → AdsApp bulk upload → sendAck(pendingConfirmation=true)
    ↓
ACK API → status = UPLOADED / COMPLETED
```

- **intent_weights:** `sites.intent_weights` JSONB — valuation için kullanılır (junk/pending/qualified/sealed ağırlıkları).
- **oci_status = 'sealed':** Mühürlenen aramalar OCI kuyruğuna eklenir. Hem Eslamed hem Muratcan aynı mantığı kullanır.
- **Enqueue:** Seal sonrası `offline_conversion_queue` INSERT (backend trigger veya `oci-enqueue.mjs` / runbook INSERT).

### 2.3 Script Kurulumu

| Özellik | Eslamed | Muratcan |
|---------|---------|----------|
| Deploy script | `deploy/Eslamed-OCI-Quantum.js` | `deploy/Muratcan-OCI-Quantum.js` |
| Engine | Aynı (OCI SYNC ENGINE v3.0 Quantum) | Aynı |
| Site ID değişkeni | ESLAMED_SITE_ID | MURATCAN_SITE_ID |
| API key değişkeni | ESLAMED_API_KEY | MURATCAN_API_KEY |
| Credentials script | `get-eslamed-credentials.mjs` | `get-muratcan-credentials.mjs` |
| Conversion events | OpsMantik_V5_DEMIR_MUHUR vb. | Aynı event seti |

### 2.4 Intent Ağırlıkları (sites.intent_weights)

Migration default (`20260310000000_add_predictive_value_weights.sql`):

```json
{
  "junk": 0.0,
  "pending": 0.02,
  "qualified": 0.20,
  "sealed": 1.0
}
```

- **junk:** 0 — OCI'ya hiç gitmez.
- **pending:** 0.02 — çok düşük değer.
- **qualified:** 0.20 — orta değer.
- **sealed:** 1.0 — tam değer, OCI için ana kaynak.

Eslamed ve Muratcan için özel `intent_weights` override yoksa ikisi de bu default kullanır.

---

## 3. Eslamed vs Muratcan — Güncel Durum Farkı

| Metrik | Eslamed (önceki analiz) | Muratcan (bugün) |
|--------|-------------------------|-------------------|
| Kuyruk durumu | 3 satır: 1 UPLOADED, 2 FAILED (MAX_ATTEMPTS) | 5 satır: hepsi COMPLETED |
| Session dedup | Yok (3 farklı session) | Yok (5 farklı session) |
| Bekleyen (QUEUED/RETRY) | 0 | 0 |
| Öneri | FAILED satırlar için `oci-enqueue --force-reset-completed Eslamed` | Yok — sistem sağlıklı |

---

## 4. Kontrol Komutları Özeti

| Site | Diagnostic | Queue Check |
|------|------------|-------------|
| Muratcan | `node scripts/db/oci-diagnostic-sessions.mjs Muratcan` | `node scripts/db/oci-queue-check.mjs Muratcan` |
| Eslamed | `node scripts/db/oci-diagnostic-sessions.mjs Eslamed` | `node scripts/db/oci-queue-check.mjs Eslamed` |

---

## 5. SQL Runbook'lar

| Dosya | Amaç |
|-------|------|
| `oci_eslamed_muratcan_bugun_intent_durum.sql` | Eslamed + Muratcan bugünkü mühür ve kuyruk durumu |
| `oci_muratcan_gclid_audit.sql` | Muratcan: ghost oranı, early-call latency, GCLID consistency |
| `oci_eslamed_full_diagnostic.sql` | Eslamed OCI tam tanı |

---

## 6. Sonuç

- **Muratcan:** Kuyruk temiz, 5/5 COMPLETED, bekleyen iş yok.
- **Intent:** Eslamed ve Muratcan aynı intent modelini kullanıyor; `sites.intent_weights` default değerlerle (sealed=1.0).
- **OCI path:** İkisi de `oci_sync_method = script` ile Google Ads Script üzerinden sync.
- **Script:** Aynı Quantum Engine; yalnızca site_id ve api_key farklı.
