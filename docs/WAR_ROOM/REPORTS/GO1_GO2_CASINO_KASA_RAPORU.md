# GO1 + GO2 — Casino Kasa Raporu

**Tarih:** 2026-01-30  
**Kapsam:** GO1 (DB kurulum) + GO2 (HunterCard v3 + SealModal + Seal API).  
**Durum:** GO1 migration + types; GO2 UI + API + smoke PASS.

---

## 1. Özet

| GO   | Amaç | Sonuç |
|------|------|--------|
| **GO1** | Casino Kasa DB: `calls` (sale_amount, currency, …), `sites.config`, RLS, tipler | Migration + lib/types/database.ts; doğrulama SQL + smoke script |
| **GO2** | HunterCard v3 + SealModal (Casino Table) + POST /api/calls/[id]/seal | UI, API, Bearer auth, smoke PASS |

---

## 2. GO1 — Casino Kasa DB

### 2.1 Değişen / Eklenen Dosyalar

| Aksiyon | Dosya |
|--------|--------|
| Eklendi | `supabase/migrations/20260130100000_casino_kasa_calls_sites.sql` |
| Eklendi | `lib/types/database.ts` |
| Eklendi | `docs/WAR_ROOM/REPORTS/GO1_CASINO_DB_SETUP.md` |
| Eklendi | `scripts/smoke/go1-casino-db-verify.mjs` |
| Eklendi | `docs/WAR_ROOM/EVIDENCE/GO1_CASINO/PROOF_PACK.md` |

### 2.2 DB Değişiklikleri

- **public.calls**
  - `sale_amount numeric`, `estimated_value numeric`, `currency text NOT NULL DEFAULT 'TRY'`
  - CHECK: `sale_amount >= 0`, `estimated_value >= 0`
  - `updated_at`, BEFORE UPDATE trigger
  - RLS: sadece belirli kolonların güncellenmesine izin veren trigger
- **public.sites**
  - `config jsonb NOT NULL DEFAULT '{}'`
- **RLS**
  - Sites: "Admins can update sites" (is_admin)

### 2.3 Tipler (lib/types/database.ts)

- `CallUpdatableFields`, `CallRow`, `SiteConfig`, `SiteRow`

### 2.4 Doğrulama

- **Script:** `node scripts/smoke/go1-casino-db-verify.mjs`
- **Manuel:** PROOF_PACK içindeki SQL sorguları (kolon varlığı, constraint, config güncelleme)

---

## 3. GO2 — Casino UI (HunterCard v3 + SealModal + Seal API)

### 3.1 Değişen / Eklenen Dosyalar

| Aksiyon | Dosya |
|--------|--------|
| Güncellendi | `components/dashboard-v2/HunterCard.tsx` |
| Güncellendi | `components/dashboard-v2/QualificationQueue.tsx` |
| Güncellendi | `lib/security/validate-site-access.ts` (opsiyonel client) |
| Eklendi | `components/dashboard-v2/SealModal.tsx` |
| Eklendi | `app/api/calls/[id]/seal/route.ts` |
| Eklendi | `lib/hooks/use-site-config.ts` |
| Eklendi | `scripts/smoke/casino-ui-proof.mjs` |
| Eklendi | `scripts/smoke/go2-casino-screenshots.mjs` |
| Eklendi | `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/PROOF_PACK.md` |

### 3.2 HunterCard v3 (Predator HUD)

- **Intent renkleri:** WhatsApp = emerald, Phone = mavi, Form = mor (border + ikon kutusu).
- **Intel Box:** PAGE, CITY/DISTRICT (varsa), DEVICE, CLICK_ID (varsa).
- **Identity:** Maskelenmiş `intent_target`, kısa `matched_session_id` (ilk 8 karakter).
- **CTA:** "SEAL DEAL" → `onSealDeal` varsa SealModal açılır; yoksa yıldızla seal.

### 3.3 SealModal (Casino Table)

- SEAL DEAL ile açılır; shadcn Dialog.
- **Chips:** `site.config.bounty_chips` veya varsayılan `[1000, 5000, 10000, 25000]`.
- Custom amount + para birimi (varsayılan TRY).
- Onay → `POST /api/calls/[id]/seal`; başarıda optimistic UI + toast; hata → toast.

### 3.4 Seal API

- **Endpoint:** `POST /api/calls/[id]/seal`
- **Body:** `{ sale_amount, currency }` (currency varsayılan TRY).
- **Auth:** Cookie veya `Authorization: Bearer <access_token>` (smoke test için).
- **Mantık:** `validateSiteAccess(siteId, user.id, supabase)`; güncelleme: `sale_amount`, `currency`, `status: 'confirmed'`, `confirmed_at`, `confirmed_by`, `oci_status: 'sealed'`.
- **RLS:** Server client (adminClient yok); Bearer ile gelen istekte `validateSiteAccess` için client geçiriliyor.

### 3.5 Site config

- **Hook:** `useSiteConfig(siteId)` → `bountyChips`, `currency` (sites.config veya varsayılan).

### 3.6 Smoke test (GO2)

- **Script:** `node scripts/smoke/casino-ui-proof.mjs`
- **Akış:**
  1. Constraint’e uyan bir intent call seç (intent_action, intent_target, intent_stamp dolu).
  2. Proof user ile Bearer token al; `POST /api/calls/<id>/seal` ile `sale_amount: 1000`, `currency: TRY`.
  3. DB’de `sale_amount=1000`, `status=confirmed` doğrula.
- **Sonuç:** PASS (Seal API 200, DB verified).
- **Inject (opsiyonel):** `PROOF_INJECT_CALL=1` ile test call oluştur (intent_action, intent_target, intent_stamp set).

---

## 4. Ortak / Ek Değişiklikler

- **validate-site-access.ts:** `validateSiteAccess(siteId, userId?, supabaseClient?)` — Bearer ile gelen istekte RLS’li client geçirilebiliyor.
- **Seal route:** Cookie veya Bearer; Bearer kullanıldığında anon client + `global.headers.Authorization: Bearer <token>`.

---

## 5. Kanıt / Checklist

### GO1

| Madde | Durum |
|-------|--------|
| Migration hatasız uygulanır | |
| calls: sale_amount, estimated_value, currency, updated_at | |
| sites.config var, default '{}' | |
| sale_amount güncelleme (service_role veya auth) başarılı | |
| sale_amount = -1 / estimated_value = -10 constraint hatası | |
| npm run build derleme başarılı | |

### GO2

| Madde | Durum |
|-------|--------|
| HunterCard v3: Intel Box, Identity, SEAL DEAL CTA | |
| Intent renkleri: WhatsApp emerald, Phone blue, Form purple | |
| SealModal: chips, custom amount, TRY | |
| Seal API: sale_amount, status=confirmed, confirmed_at, confirmed_by | |
| Optimistic UI + toast | |
| Smoke: casino-ui-proof.mjs PASS | ✅ |
| Screenshots: hunter-card.png, seal-modal-chips.png (opsiyonel) | |
| Modal mobilde overflow yok, butonlar erişilebilir | |

---

## 6. Komutlar

```bash
# GO1 DB doğrulama (migration sonrası)
node scripts/smoke/go1-casino-db-verify.mjs

# GO2 seal smoke (uygulama çalışırken)
node scripts/smoke/casino-ui-proof.mjs

# GO2 seal smoke — test call yoksa inject
PROOF_INJECT_CALL=1 node scripts/smoke/casino-ui-proof.mjs

# GO2 ekran görüntüleri (uygulama çalışırken)
node scripts/smoke/go2-casino-screenshots.mjs
```

---

## 7. Referanslar

- **GO1 detay:** `docs/WAR_ROOM/EVIDENCE/GO1_CASINO/PROOF_PACK.md`, `docs/WAR_ROOM/REPORTS/GO1_CASINO_DB_SETUP.md`
- **GO2 detay:** `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/PROOF_PACK.md`
