# OCI Deterministic Queue and Control Dashboard — Final Plan (100% Determinism)

**Tarih:** 2026-02  
**Durum:** Final mutabakat — %100 deterministik garanti. Tüm kilitler mutabık.

---

## NON-NEGOTIABLE (Determinism Lock)

**attempt_count MUST increment on export claim (QUEUED/RETRY -> PROCESSING)** in [app/api/oci/google-ads-export/route.ts](app/api/oci/google-ads-export/route.ts). This makes attempt-cap a real terminal-state guarantor.

**Also:**
- queue-actions that set QUEUED MUST clear `claimed_at` and `next_retry_at`
- MARK_FAILED must have deterministic defaults (`errorCode`, `errorCategory`, `reason`)
- Export preview must NOT break the script response shape when `markAsExported=true`

---

## 1. Executive Summary

| Garanti | Nasıl Sağlanıyor |
|---------|------------------|
| PROCESSING sonsuz kalmaz | recover-processing (15 dk) → RETRY |
| Script apply exception | ack-failed(TRANSIENT) ile FAILED |
| Sonsuz retry yok | attempt_count cap (≥ MAX_ATTEMPTS) → FAILED(PERMANENT) |
| Operator görünürlük + kontrol | OCI Control UI + queue-actions API |

**Kritik bağımlılık:** attempt_count **claim sırasında** artmalı; aksi halde attempt-cap işe yaramaz.

---

## 2. Final Mutabakat Kilitleri (5 Madde)

### Lock 1: attempt_count Increment — ZORUNLU

**Yer:** [app/api/oci/google-ads-export/route.ts](app/api/oci/google-ads-export/route.ts)  
**Blok:** `markAsExported=true` iken `idsToMarkProcessing` için yapılan update.

**Kural:** Claim anında tek atomik işlemde:
- `status = 'PROCESSING'`
- `claimed_at = now()`
- `attempt_count = attempt_count + 1`
- `updated_at = now()`

**Metrik:** attempt_count = "kaç kez işlenmeye çalışıldı" (export claim sayısı).

**Teknik uygulama:** Supabase JS `.update()` raw SQL desteklemediği için yeni RPC:

```sql
-- Migration: claim_offline_conversion_rows_for_script_export
CREATE OR REPLACE FUNCTION public.claim_offline_conversion_rows_for_script_export(
  p_ids uuid[],
  p_site_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_updated int;
BEGIN
  WITH updated AS (
    UPDATE offline_conversion_queue q
    SET
      status = 'PROCESSING',
      claimed_at = now(),
      updated_at = now(),
      attempt_count = attempt_count + 1
    WHERE q.id = ANY(p_ids)
      AND q.site_id = p_site_id
      AND q.status IN ('QUEUED', 'RETRY')
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;
  RETURN v_updated;
END;
$$;
```

Export route: `idsToMarkProcessing.length > 0` iken `adminClient.rpc('claim_offline_conversion_rows_for_script_export', { p_ids: idsToMarkProcessing, p_site_id: siteUuid })` çağır; mevcut `.update()` çağrısını kaldır. RPC dönen count ile hata kontrolü yap.

---

### Lock 2: Attempt-Cap Kriteri — Basitleştirilmiş

**Kural:** attempt_count claim'de artacağı için attempt-cap şu kadar basit:

| Koşul | Değer |
|-------|-------|
| status | IN ('QUEUED', 'RETRY', 'PROCESSING') |
| attempt_count | >= MAX_ATTEMPTS (5) |
| min-age (opsiyonel) | updated_at < now() - 15 min |

**Set:**
- `status = 'FAILED'`
- `provider_error_code = 'MAX_ATTEMPTS'`
- `provider_error_category = 'PERMANENT'`
- `last_error = 'MAX_ATTEMPTS_EXCEEDED'`
- `updated_at = now()`

**RPC imzası:**
```sql
oci_attempt_cap(p_max_attempts int DEFAULT 5, p_min_age_minutes int DEFAULT 0)
-- p_min_age_minutes=0 => min-age filtre yok (daha agresif)
-- p_min_age_minutes=15 => sadece 15 dk'dan eski satırlar (daha muhafazakâr)
```

---

### Lock 3: queue-actions Side Effects — Deterministik Temizlik

**RETRY_SELECTED** ve **RESET_TO_QUEUED** için zorunlu set:

| Alan | Değer |
|------|-------|
| status | 'QUEUED' |
| claimed_at | NULL |
| next_retry_at | NULL |
| updated_at | now() |

**Error alanları politikası:**
- **RETRY_SELECTED:** `last_error`, `provider_error_code`, `provider_error_category` **koru** (forensics)
- **RESET_TO_QUEUED:** `clearErrors?: boolean` (default: false). `true` ise bu alanları NULL yap.

**Geçerli kaynak durumları:**
- RETRY_SELECTED: sadece FAILED veya RETRY
- RESET_TO_QUEUED: QUEUED, RETRY, PROCESSING, FAILED (COMPLETED asla değiştirilmez)

---

### Lock 4: MARK_FAILED Defaults

Body'de gelmezse:

| Alan | Default |
|------|---------|
| errorCode | 'MANUAL_FAIL' |
| errorCategory | 'PERMANENT' |
| reason | 'MANUALLY_MARKED_FAILED' |

**Geçerli hedef durumlar:** PROCESSING, QUEUED, RETRY.

---

### Lock 5: Export Preview Response Shape — Script Kırılmasın

| markAsExported | Response | Kullanıcı |
|----------------|----------|-----------|
| **true** | Mevcut flat array `[...]` | Script (değişmez) |
| **false** | `{ siteId, items, counts, warnings }` | Dashboard preview |

**Uygulama (route sonu):**
```ts
if (markAsExported) {
  return NextResponse.json(combined); // mevcut
}
return NextResponse.json({
  siteId: siteUuid,
  items: combined,
  counts: { queued: list.length, skipped: skippedIds.length },
  warnings: [],
});
```

---

## 3. State Transition Diagram

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                     QUEUED (ilk kez)                       │
                    └──────────────────────┬───────────────────────────────────┘
                                           │ export claim (attempt_count++)
                                           ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │                   PROCESSING                              │
                    └──┬──────────────────┬──────────────────┬─────────────────┘
                       │                  │                  │
         ACK (ok)      │    ack-failed    │   recover 15dk   │  attempt-cap
                       │                  │                  │  (attempt_count>=5)
                       ▼                  ▼                  ▼
              ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
              │  COMPLETED  │    │   FAILED    │    │    RETRY    │
              └─────────────┘    └─────────────┘    └──────┬──────┘
                                                           │ export claim (attempt_count++)
                                                           ▼
                                                    ┌─────────────┐
                                                    │ PROCESSING  │
                                                    └─────────────┘
                                                           │
                                                           │ attempt-cap
                                                           ▼
                                                    ┌─────────────┐
                                                    │   FAILED    │
                                                    └─────────────┘
```

**Terminal durumlar:** COMPLETED, FAILED (PERMANENT veya MANUAL_FAIL ile).

---

## 4. Dosya Bazlı Uygulama Planı

| # | Dosya | Değişiklik | Detay |
|---|-------|------------|-------|
| 1 | supabase/migrations/YYYYMMDD_oci_claim_and_attempt_cap.sql | Create | `claim_offline_conversion_rows_for_script_export`, `oci_attempt_cap` RPC'leri |
| 2 | app/api/oci/google-ads-export/route.ts | Modify | RPC çağır (update yerine); markAsExported true/false response ayır |
| 3 | lib/domain/oci/queue-types.ts | Create | QueueStatus, ProviderErrorCategory, MAX_ATTEMPTS=5, zod schemas |
| 4 | app/api/oci/queue-stats/route.ts | Create | RBAC + counts + stuckProcessing |
| 5 | app/api/oci/queue-rows/route.ts | Create | RBAC + paginated rows |
| 6 | app/api/oci/queue-actions/route.ts | Create | RETRY_SELECTED, RESET_TO_QUEUED, MARK_FAILED; Lock 3 ve 4 |
| 7 | app/api/cron/oci/attempt-cap/route.ts | Create | requireCronAuth, RPC çağır |
| 8 | vercel.json | Modify | attempt-cap cron ekle (örn. */15) |
| 9 | scripts/google-ads-oci/GoogleAdsScript.js | Modify | try/catch apply, sendAckFailed(TRANSIENT) |
| 10 | app/dashboard/site/[siteId]/oci-control/page.tsx | Create | Server page, validateSiteAccess |
| 11 | components/dashboard/oci-control/* | Create | OciControlSummary, OciControlTable, OciControlFilters, OciControlBulkActions |
| 12 | components/dashboard/dashboard-shell.tsx | Modify | OCI Control link (veya sidebar) |
| 13 | docs/OPS/OCI_ATTEMPT_CAP.md | Create | Runbook |
| 14 | docs/OPS/OCI_CONTROL_SMOKE.md | Create | Smoke checklist |
| 15-18 | tests/unit/* | Create | oci-queue-actions, oci-export-preview, oci-attempt-cap, oci-script-ack-failed |

---

## 5. API Contract Özeti

### GET /api/oci/queue-stats
- Query: `siteId`, `scope?` (site | multi)
- Auth: Session + validateSiteAccess
- Response: `{ siteId, totals: { QUEUED, RETRY, PROCESSING, COMPLETED, FAILED }, stuckProcessing?, lastUpdatedAt? }`

### GET /api/oci/queue-rows
- Query: `siteId`, `limit?`, `status?`, `cursor?`
- Auth: Session + validateSiteAccess
- Response: `{ siteId, rows: [...], nextCursor? }`

### POST /api/oci/queue-actions
- Body: `{ siteId, action, ids, reason?, errorCode?, errorCategory?, clearErrors? }`
- Auth: Session + validateSiteAccess
- Lock 3 ve 4 uygulanacak.

### GET /api/oci/google-ads-export
- Query: `siteId`, `markAsExported` (true | false)
- Lock 5: markAsExported=true → flat array; false → structured preview.

---

## 6. Extensibility Noktaları

| Nokta | Gelecek genişleme |
|-------|-------------------|
| MAX_ATTEMPTS | lib/domain/oci/queue-types.ts'den tek kaynak; env override eklenebilir |
| attempt-cap min_age | RPC parametresi; cron'dan farklı değerlerle çağrılabilir |
| clearErrors | RESET_TO_QUEUED'da v1'de false; v2'de UI toggle ile true |
| Circuit breaker | queue-stats'ta FAILED oranı > %20 ise uyarı badge'i (ileride) |
| DLQ export | FAILED satırları CSV olarak export (ileride) |

---

## 7. Final Patch (Cursor — Tek Paragraf)

```
NON-NEGOTIABLE: attempt_count MUST increment on export claim (QUEUED/RETRY -> PROCESSING) in google-ads-export route. This makes attempt-cap a real terminal-state guarantor. Also, queue-actions that set QUEUED MUST clear claimed_at and next_retry_at. MARK_FAILED must have deterministic defaults. Export preview must not break the script response shape when markAsExported=true.
```

---

## 8. Delta Prompt (Cursor Execution Checklist)

Aşağıdaki prompt Cursor'a verildiğinde sadece eksik kilitleri uygular:

```
Apply final OCI determinism locks (docs/OCI_DETERMINISTIC_PLAN_FINAL.md):

1) Export claim must increment attempt_count:
   - Create migration: claim_offline_conversion_rows_for_script_export(p_ids uuid[], p_site_id uuid) RPC.
   - In app/api/oci/google-ads-export/route.ts: replace .update() with adminClient.rpc('claim_offline_conversion_rows_for_script_export', { p_ids: idsToMarkProcessing, p_site_id: siteUuid }) when markAsExported=true and idsToMarkProcessing.length > 0.

2) queue-actions must set claimed_at=NULL and next_retry_at=NULL when moving rows to QUEUED (RETRY_SELECTED, RESET_TO_QUEUED). RESET_TO_QUEUED: optional clearErrors (default false). RETRY_SELECTED: preserve error fields.

3) MARK_FAILED defaults: errorCode='MANUAL_FAIL', errorCategory='PERMANENT', reason='MANUALLY_MARKED_FAILED' if missing.

4) Export preview response:
   - markAsExported=true: keep existing flat array response (script compatibility).
   - markAsExported=false: return { siteId, items, counts, warnings }.

5) Attempt-cap RPC: status IN (QUEUED,RETRY,PROCESSING), attempt_count >= MAX_ATTEMPTS; set FAILED with provider_error_code='MAX_ATTEMPTS', provider_error_category='PERMANENT', last_error='MAX_ATTEMPTS_EXCEEDED'. Optional min_age_minutes filter.

Do not change any other behavior.
```

---

## 9. Verification Checklist

| Adım | Beklenen |
|------|----------|
| Export claim | idsToMarkProcessing için attempt_count 1 artar |
| markAsExported=false | Response structured; DB'de update yok |
| RETRY_SELECTED | status=QUEUED, claimed_at=NULL, next_retry_at=NULL; error alanları korunur |
| RESET_TO_QUEUED | status=QUEUED, claimed_at=NULL, next_retry_at=NULL; clearErrors=true ise error alanları NULL |
| MARK_FAILED (body boş) | errorCode=MANUAL_FAIL, errorCategory=PERMANENT, reason=MANUALLY_MARKED_FAILED |
| attempt-cap | attempt_count>=5 satırlar FAILED, provider_error_code=MAX_ATTEMPTS |
| Script apply throw | sendAckFailed(TRANSIENT) çağrılır; satırlar FAILED |
