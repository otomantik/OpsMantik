# Conversation Layer — Edge Cases & Idempotency Raporu

## 1. Enqueue-from-sales: `hours` sınır değerleri

| Değer | Davranış | Test |
|-------|----------|------|
| `hours=-1` | **400** — "hours must be between 1 and 168" | ✅ hours boundary: hours=-1 returns 400 |
| `hours=0` | **400** — aynı hata | ✅ hours boundary: hours=0 returns 400 |
| `hours=1` | 200 (geçerli) | — |
| `hours=24` | 200 (varsayılan) | — |
| `hours=168` | **200** (geçerli, tam 168 dahil) | ✅ hours boundary: 168 is within valid range |
| `hours=169` | **400** | ✅ hours boundary: hours=169 returns 400 |
| `hours=abc` | **400** (NaN) | parse edilemez → 400 |

**Kod değişikliği:** Geçersiz `hours` (NaN, <1, >168) artık sessizce default’a düşmüyor; açıkça **400** ve hata mesajı dönüyor.

---

## 2. Idempotency: POST /api/sales/confirm (aynı sale_id iki kez)

**Akış:**
1. İlk çağrı: Sale DRAFT → RPC `confirm_sale_and_enqueue` sale’i **FOR UPDATE** kilitler, status = CONFIRMED yapar, queue’ya INSERT (ON CONFLICT DO NOTHING), 200 döner.
2. İkinci çağrı: Sale artık CONFIRMED. RPC içinde:
   - `IF v_sale.status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'sale_already_confirmed_or_canceled'`
   - API bu exception’ı yakalar → **409** + `code: 'ALREADY_CONFIRMED_OR_CANCELED'`

**RPC garantisi (migration):**
- `WHERE id = p_sale_id FOR UPDATE` → tek satır kilitlenir.
- `IF v_sale.status IS DISTINCT FROM 'DRAFT'` → CONFIRMED/CANCELED ise exception.
- `ON CONFLICT (sale_id) DO NOTHING` → queue’da zaten varsa ikinci insert sessizce atlanır (ilk çağrıda da koruma).

**Test:** `Idempotency: RPC confirm_sale_and_enqueue rejects non-DRAFT (second call => 409)` — migration kaynak kodu bu kontrolleri doğruluyor.

---

## 3. Primary source: önceliklendirme ve unit testler

**Kurallar (primary-source.ts):**
- **Call > Session:** Hem `callId` hem `sessionId` gelirse önce `if (input.callId)` çalışır; session dalı sonra.
- **Tenant-safe:** Tüm `calls` ve `sessions` sorguları `.eq('site_id', siteId)` ile kısıtlı.
- **Best-effort:** Hata veya bulunamayan session/call → `null`; conversation create asla kırılmaz.

**Yeni unit testler (tests/unit/primary-source.test.ts):**
- `getPrimarySource with empty input returns null`
- `getPrimarySource with only sessionId (no callId) uses session path` (DB yok → null)
- `Precedence: callId branch is evaluated before sessionId in getPrimarySource`
- `Primary source is always scoped by site_id (tenant-safe)`
- `Primary source returns null on error (best-effort)`

---

## Sonraki adım önerisi

- **Idempotency:** RPC ve API tarafında net; ikinci confirm 409 dönüyor, queue’da tek satır garantisi var.
- **Seçenekler:**
  1. **Migration’ı staging’e push + E2E:** Gerçek DB ile confirm iki kez → 200 sonra 409, queue count = 1 doğrulanır.
  2. **primary-source.ts incelemesi:** Kurallar ve testler dokümante edildi; ek business kuralları (örn. farklı kanal önceliği) istersen bu dosyada netleştirilebilir.

Tercih: Önce **staging’e migration push + E2E** ile confirm idempotency ve enqueue akışını canlıda doğrulamak, ardından primary-source’u ihtiyaca göre genişletmek mantıklı.
