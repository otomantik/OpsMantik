# Iron Seal Architectural Refactoring

**Date:** 2026-02-25  
**Objective:** "Kill the Hybrid, Enforce the Seal" — transition from tracker to Financial Ledger.

---

## 1. SSOT Protocol — conversions table

**Migration:** `20260329000000_iron_seal_conversions_seal_status.sql`

- Added `seal_status` column (`unsealed` | `sealed`) to `conversions` table.
- `get_pending_conversions_for_worker` RPC now returns **only** rows where `seal_status = 'sealed'`.
- Existing rows default to `unsealed` (never dispatched until explicitly sealed).
- Partial index `idx_conversions_sealed_pending` for efficient worker scans.

---

## 2. Immutable Financial Ledger — revenue_snapshots & provider_dispatches

**Migration:** `20260329000001_iron_seal_revenue_snapshots.sql`

- `revenue_snapshots`: APPEND-ONLY (trigger blocks UPDATE and DELETE).
- `provider_dispatches`: No DELETE allowed (audit trail).
- Every sealed conversion creates an immutable record.

---

## 3. API Handshake — /api/oci/v2/verify

- **Endpoint:** `POST /api/oci/v2/verify`
- **Body:** `{ siteId: string }`
- **Headers:** `x-api-key` = OCI_API_KEY (or site-scoped key via OCI_API_KEYS)
- **Response:** `{ session_token: string, expires_at: string }` (5 min TTL)

**Auth:** Script Properties `OPSMANTIK_SITE_ID`, `OPSMANTIK_API_KEY` → handshake → session_token.

---

## 4. Script Multi-Tenancy — GoogleAdsScript.js

- **Script Properties** (required):
  - `OPSMANTIK_SITE_ID` — Site UUID or public_id
  - `OPSMANTIK_API_KEY` — API key
- **Optional:** `OPSMANTIK_EXPORT_URL`, `OPSMANTIK_USE_V2_VERIFY` (set to `true` for v2 handshake)

- When `OPSMANTIK_USE_V2_VERIFY=true`, Script calls `/api/oci/v2/verify` first, then uses `Authorization: Bearer <session_token>` for export and ack.
- No hardcoded site IDs or API keys.

---

## 5. Export & ACK — session_token support

- **google-ads-export** and **ack** accept:
  - `Authorization: Bearer <session_token>` (v2 handshake)
  - `x-api-key` (legacy)
- When both present, Bearer token takes precedence.

---

## 6. Environment

- `OCI_SESSION_SECRET` — optional; falls back to `CRON_SECRET` or `OCI_API_KEY` for signing session tokens.

---

## Watch-Outs (Stratejik Uyarılar)

### İki Dispatcher Çakışması Riski

- Hem `conversions` tablosu (RPC güncellendi) hem de `provider_dispatches` (yeni kuyruk tablosu) mevcut.
- Seal flow tetiklendiğinde üç işlem yapılmalı:
  1. `conversions.seal_status` güncelle (veya insert ederken `sealed` atayarak ekle)
  2. `revenue_snapshots` → INSERT
  3. `provider_dispatches` → INSERT (her provider için)
- **Gelecek hedef:** Worker'ı tekilleştir — `conversions` yerine doğrudan `provider_dispatches` üzerinden çalışsın. Böylece mimari tek bir dispatcher kaynağına indirgenir.

### Katı UPDATE Yasağı

- `revenue_snapshots` tablosunda UPDATE tamamen engellendi (trigger).
- `meta_json` veya `reasons_json` içine sonradan log/not eklemek için UPDATE yapılamaz; DB reddeder.
- **Finansal defter mantığı:** Hata veya düzeltme durumunda yeni bir snapshot (correction) kaydı atılır; mevcut kayda dokunulmaz.
- **Uygulama tarafı (Next.js):** Snapshot oluşturulduktan sonra ona dokunmak yok. Kod bu varsayımla yazılmalı.

---

## Next Steps

1. **conversions table:** Ensure any insert path sets `seal_status = 'sealed'` when the row originates from a seal flow.
2. **Seal path:** Wire `revenue_snapshots` and `provider_dispatches` into the seal flow (enqueueSealConversion or seal route).
3. **Sunset:** Maintain `/api/call-event` v1 sunset schedule (2026-05-10).
