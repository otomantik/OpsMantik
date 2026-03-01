# OCI Queue: Failure Handling & Dead-Letter Mantığı

**Tarih:** 2026-03  
**Problem:** Script validation/upload hata aldığında satırlar PROCESSING'de kalıyor; recover cron 15 dk sonra blind RETRY yapıyor; FAILED yazılmıyor, sebep takip edilmiyor.

---

## 1. Mevcut Akış (Sorunlu)

```
Export (markAsExported=true) → QUEUED/RETRY → PROCESSING (claim)
     ↓
Script veriyi alır, validate eder, Google Ads'e yükler
     ↓
├─ Başarılı: ACK gönderir → PROCESSING → COMPLETED ✓
├─ Validation fail (INVALID_TIME_FORMAT vb): Hiçbir şey göndermez → PROCESSING'de KALIR ✗
└─ Upload fail (Google red): Hiçbir şey göndermez → PROCESSING'de KALIR ✗

recover-processing (15 dk sonra): PROCESSING → QUEUED (blind retry)
```

**Sorun:** Validation/upload fail durumunda FAILED yazılmıyor. Satır PROCESSING'de 15 dk bekleyip tekrar QUEUED'a dönüyor. Aynı invalid data sonsuz döngüde. last_error, provider_error_code dolu değil. Dashboard'da görünmez.

---

## 2. Profesyonel Yaklaşım (Best Practices)

| Kaynak | Öneri |
|--------|-------|
| **AWS SQS / Dead Letter Queue** | Kalıcı hataları DLQ'ya taşı; transient olanları retry et |
| **Sidekiq** | attempt_count cap (5–25); dead job queue; error reporting |
| **Retry Strategy** | Transient (rate limit, 503) → RETRY; Permanent (validation, invalid data) → FAILED |
| **Observability** | last_error, error_code, failed_at; dashboard; alerting |

**Özet:**
- **Kalıcı hata** (INVALID_TIME_FORMAT, invalid_gclid, business rule) → FAILED, last_error yaz, retry yapma
- **Geçici hata** (429, 503, timeout) → RETRY, attempt_count artır
- **attempt_count** cap (örn. 5) → sonra FAILED

---

## 3. Önerilen Çözüm

### 3.1 POST /api/oci/ack-failed

Script, validation veya upload fail olan satırlar için bu endpoint'i çağırır.

**Request:**
```json
POST /api/oci/ack-failed
{
  "siteId": "81d957f3c7534f53b12ff305f9f07ae7",
  "queueIds": ["seal_xxx", "seal_yyy"],
  "errorCode": "INVALID_TIME_FORMAT",
  "errorMessage": "Expected yyyy-mm-dd HH:mm:ss±HH:mm",
  "errorCategory": "VALIDATION"
}
```

**Davranış:**
- `queueIds`: seal_* prefix → offline_conversion_queue
- `status`: PROCESSING → FAILED
- `last_error` := errorMessage
- `provider_error_code` := errorCode
- `provider_error_category` := errorCategory (VALIDATION | TRANSIENT | AUTH)
- `attempt_count` := attempt_count + 1
- `updated_at` := now

**errorCategory semantiği:**
- **VALIDATION**: Kalıcı (format, invalid gclid) → FAILED, retry yok
- **TRANSIENT**: Geçici (rate limit, 503) → FAILED ama recover veya manuel RETRY ile tekrar denenebilir
- **AUTH**: Kimlik hatası → FAILED

### 3.2 Script Değişikliği

`UploadEngine.process()`:
- Başarılı satırlar → successIds (mevcut)
- Başarısız satırlar (validation fail) → failedIds + failedReasons
- Upload exception (Google Ads red) → failedIds + errorCode

`main()`:
- ACK (successIds) — mevcut
- **ACK-failed** (failedIds, errorCode, errorMessage) — yeni

### 3.3 recover-processing (Değişiklik Yok)

PROCESSING → QUEUED (15 dk sonra) mantığı aynı kalır. "Script crash" varsayımı. FAILED satırlara dokunmaz.

### 3.4 Gelecek: attempt_count Cap

İsteğe bağlı: recover veya başka bir job, `attempt_count >= 5` olan PROCESSING/QUEUED satırları FAILED yapıp last_error ile işaretleyebilir. Şimdilik Script tarafından açıkça ack-failed çağrıldığında FAILED yeterli.

---

## 4. Uygulama Adımları

1. [x] POST /api/oci/ack-failed route
2. [x] QuantumClient.sendAckFailed()
3. [x] UploadEngine.process() → failedRows dön (queueId, errorCode, errorMessage, errorCategory)
4. [x] main() → sendAckFailed çağır (grup başına hata tipine göre batch)
5. [ ] (Opsiyonel) Dashboard: FAILED conversions listesi + last_error
