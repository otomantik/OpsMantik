# OCI Deterministic Queue and Control Dashboard — Plan v2 (100% Determinism)

**Tarih:** 2026-02  
**Durum:** Mutabık — 2 kritik düzeltme + 3 netleştirme ile %100 determinizm.

---

## Mutabakat Özeti

| Konu | Karar |
|------|-------|
| Discovery map | Export→PROCESSING, ACK→COMPLETED, ack-failed→FAILED, recover→RETRY |
| OCI Control API | stats, rows, actions, export preview |
| Script try/catch + ack-failed | Deterministik eksik halka |
| UI spec | Dense, Slate/Emerald, Lucide-only, bulk actions |
| RBAC | Session + validateSiteAccess, cron secret yok |
| Recover hedefi | RETRY (doğru: QUEUED = ilk kez, RETRY = tekrar denenecek) |

---

## Kritik Düzeltme 1: attempt_count Increment (Zorunlu)

**Sorun:** attempt_count şu an hiç artmıyor. attempt-cap işe yaramaz.

**Karar:** attempt_count **yalnızca export claim sırasında** artacak.

| Konum | Davranış |
|-------|----------|
| **A) Export claim** (QUEUED/RETRY → PROCESSING) | `attempt_count = attempt_count + 1` **zorunlu** |
| B) Recover RPC (PROCESSING → RETRY) | attempt_count'a **dokunma** |
| C) ack-failed | attempt_count'a **dokunma** |

**Metrik:** attempt_count = "kaç kere export edilip işlenmeye çalışıldı".

**Uygulama:** [app/api/oci/google-ads-export/route.ts](app/api/oci/google-ads-export/route.ts) update bloğunda (markAsExported=true iken):

```ts
.update({
  status: 'PROCESSING',
  claimed_at: now,
  updated_at: now,
  // ZORUNLU: attempt_count increment
  attempt_count: sql`attempt_count + 1`, // veya RPC ile
})
```

**Not:** Supabase client `.update()` raw SQL ile doğrudan artış desteklemiyor. Alternatifler:
- RPC `increment_attempt_count_on_claim(ids[])` ile tek seferde UPDATE ... SET attempt_count = attempt_count + 1
- Veya raw SQL ile tek sorgu (adminClient.rpc veya pg)

---

## Kritik Düzeltme 2: Terminal Guarantee

attempt-cap **yalnızca attempt_count artıyorsa** gerçek garantör olur. Düzeltme 1 olmadan "eventually COMPLETED/FAILED" garanti değil.

**Sonuç:** Düzeltme 1 ile birlikte attempt-cap terminal garantör.

---

## Netleştirme 3: RETRY_SELECTED ve RESET_TO_QUEUED Davranışı

| Alan | RETRY_SELECTED | RESET_TO_QUEUED |
|------|----------------|-----------------|
| status | QUEUED | QUEUED |
| next_retry_at | **NULL** | **NULL** |
| claimed_at | **NULL** | **NULL** |
| last_error | **Koru** (forensics) | Opsiyonel `clearErrors=true` ile temizle |
| provider_error_code | Koru | clearErrors ile temizle |
| provider_error_category | Koru | clearErrors ile temizle |

**queue-actions body:** `clearErrors?: boolean` (sadece RESET_TO_QUEUED için geçerli).

---

## Netleştirme 4: MARK_FAILED Varsayılanları

Operator reason vermese bile deterministik olmalı:

| Alan | Verilmezse |
|------|------------|
| errorCategory | **PERMANENT** |
| errorCode | **"MANUAL_FAIL"** |
| reason | `errorCode` veya boş string |

---

## Netleştirme 5: Export Preview Response Shape

**Zorunlu kural:** Script mevcut response formatını bekliyor. Kırma yok.

| markAsExported | Response format |
|----------------|-----------------|
| **true** | Mevcut format (flat array) — **script compatibility** |
| **false** | Yeni preview format: `{ siteId, items, counts, warnings }` — dashboard |

**Uygulama:** Route içinde açıkça ayır:

```ts
if (markAsExported) {
  return NextResponse.json(combined); // mevcut flat array
}
// Preview: structured
return NextResponse.json({
  siteId: siteUuid,
  items: combined,
  counts: { queued: list.length, skipped: skippedIds.length },
  warnings: [],
});
```

---

## Dosya Bazlı Checklist (Güncellenmiş)

| # | Action | Path | Not |
|---|--------|------|-----|
| 1 | Create | lib/domain/oci/queue-types.ts | QueueStatus, ProviderErrorCategory, MAX_ATTEMPTS, zod |
| 2 | **Modify** | app/api/oci/google-ads-export/route.ts | **attempt_count + 1** (claim sırasında); **markAsExported=true/false** response ayır |
| 3 | Create | app/api/oci/queue-stats/route.ts | |
| 4 | Create | app/api/oci/queue-rows/route.ts | |
| 5 | Create | app/api/oci/queue-actions/route.ts | RETRY_SELECTED/RESET: next_retry_at=NULL, claimed_at=NULL; error politikası; MARK_FAILED default PERMANENT, MANUAL_FAIL |
| 6 | Modify | scripts/google-ads-oci/GoogleAdsScript.js | try/catch apply, sendAckFailed |
| 7 | Create | supabase/migrations/YYYYMMDD_oci_attempt_cap.sql | RPC oci_attempt_cap (attempt_count >= 5 → FAILED) |
| 8 | Create | app/api/cron/oci/attempt-cap/route.ts | |
| 9 | Update | vercel.json | attempt-cap cron |
| 10 | Create | docs/OPS/OCI_ATTEMPT_CAP.md | |
| 11 | Create | app/dashboard/site/[siteId]/oci-control/page.tsx | |
| 12 | Create | components/dashboard/oci-control/* | |
| 13 | Add nav | dashboard-shell veya sidebar | OCI Control link |
| 14-17 | Tests | oci-queue-actions, oci-export-preview, oci-attempt-cap, oci-script-ack-failed | |
| 18 | Create | docs/OPS/OCI_CONTROL_SMOKE.md | |

---

## attempt_count Increment: Teknik Not

Postgres'te `attempt_count = attempt_count + 1` için Supabase JS client `.update()` ile doğrudan yapılamaz. Seçenekler:

1. **RPC:** `update_offline_conversion_queue_on_claim(ids uuid[], p_site_id uuid)` — FOR EACH id UPDATE ... SET status='PROCESSING', claimed_at=now(), attempt_count=attempt_count+1
2. **Raw SQL:** adminClient ile `supabase.rpc('exec_sql', { query: '...' })` — projede varsa
3. **İki adım:** Önce select ile mevcut attempt_count al, sonra update ile attempt_count+1 yaz — race riski var, önerilmez.

**Öneri:** Yeni migration ile RPC `claim_offline_conversion_rows_for_export(p_ids uuid[], p_site_id uuid)` oluştur; tek atomik UPDATE ile status, claimed_at, updated_at, attempt_count+1 yapsın. Export route bu RPC'yi çağırsın; mevcut `.update()` çağrısını kaldır.
