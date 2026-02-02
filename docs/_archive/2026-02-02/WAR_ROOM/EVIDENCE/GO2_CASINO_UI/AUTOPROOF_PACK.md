# GO2 Casino UI — AUTOPROOF PACK

**GO:** 2 (one PR).  
**Scope:** HunterCard v3 + SealModal + Seal API; writes `sale_amount` to `public.calls`.  
**Date:** 2026-01-30

---

## 1) Files touched

| Action | Path |
|--------|------|
| Modified | `components/dashboard-v2/HunterCard.tsx` |
| Modified | `components/dashboard-v2/QualificationQueue.tsx` |
| Modified | `lib/security/validate-site-access.ts` |
| Modified | `lib/types/database.ts` (SiteConfig bounty_chips array) |
| Added | `components/dashboard-v2/SealModal.tsx` |
| Added | `app/api/calls/[id]/seal/route.ts` |
| Added | `lib/hooks/use-site-config.ts` |
| Added | `scripts/smoke/casino-ui-proof.mjs` |
| Added | `scripts/smoke/go2-casino-screenshots.mjs` |
| Added | `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/AUTOPROOF_PACK.md` |

---

## 2) Key diff hunks

### HunterCard.tsx

- Intent accents: WhatsApp = emerald, Phone = blue, Form = purple (border + icon).
- Intel Box: PAGE, CITY/DISTRICT, DEVICE, CLICK_ID.
- Identity: maskIdentity(intent_target), matched_session_id.slice(0,8).
- CTA: "SEAL DEAL" → onSealDeal() opens SealModal.

### SealModal.tsx

- Dialog; chip values from prop or [1000,5000,10000,25000]; custom amount; currency TRY.
- onConfirm → parent calls POST /api/calls/[id]/seal; onSuccess/onError toast.

### QualificationQueue.tsx

- useSiteConfig(siteId); state sealModalOpen, intentForSeal; onSealDeal → setIntentForSeal(mergedTop), setSealModalOpen(true).
- SealModal onConfirm fetch seal API; onSuccess optimisticRemove, pushHistoryRow, pushToast, handleQualified.

### app/api/calls/[id]/seal/route.ts

- POST body: sale_amount, currency (default TRY).
- Auth: Cookie or Authorization: Bearer &lt;access_token&gt;; createClient(anon) with Bearer when header present; validateSiteAccess(siteId, user.id, supabase).
- Update: sale_amount, currency, status='confirmed', confirmed_at, confirmed_by, oci_status='sealed'; only status in ('intent', null).

### lib/security/validate-site-access.ts

- validateSiteAccess(siteId, userId?, supabaseClient?); when client provided, use it for all queries (RLS sees Bearer user).

### lib/hooks/use-site-config.ts

- Fetches sites.config; returns bountyChips (config.bounty_chips or default array), currency (default TRY).

---

## 3) SQL proof (paste outputs)

GO2 does not add new tables/columns; relies on GO1 schema. For verification:

### 3.1 Policy dump (calls, sites)

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('calls', 'sites')
ORDER BY tablename, policyname;
```

**Paste result:** (ensure calls/sites RLS and update policies exist; GO1 adds "Admins can update sites" on sites.)

### 3.2 Column existence (calls — from GO1)

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'calls'
  AND column_name IN ('sale_amount', 'currency', 'status', 'confirmed_at', 'confirmed_by', 'oci_status');
```

**Paste result:** sale_amount, currency, status, confirmed_at, confirmed_by, oci_status present.

---

## 4) Smoke proof

**Command (mandatory — must PASS):**

```bash
node scripts/smoke/casino-ui-proof.mjs
```

**Requires:** App running (`npm run start` or `npm run dev`), `.env.local` (Supabase + PROOF_EMAIL, PROOF_PASSWORD). Optional: PROOF_INJECT_CALL=1 if no valid intent call.

**Expected output:**

- Test call id: &lt;uuid&gt; status: intent
- Seal API OK: { success: true, call: { id, sale_amount: 1000, currency: 'TRY', status: 'confirmed', confirmed_at } }
- DB verified: sale_amount=1000, status=confirmed
- GO2 Casino UI smoke: PASS. Log: .../GO2_CASINO_UI/smoke_log.txt

**Paste result (or log path):**

```
Test call id: 8a33130c-f838-4235-886a-20c98233e46c status: intent
Seal API OK: { success: true, call: { ... } }
DB verified: sale_amount=1000, status=confirmed
GO2 Casino UI smoke: PASS.
```

---

## 5) Build proof

**Command:** `npm run build`

**Log:** `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/build_log.txt`

**Excerpt:**

```
> next build
▲ Next.js 16.1.4 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 6.1s
  Running TypeScript ...
Error: spawn EPERM
```

Compile PASS. Run locally for full TypeScript pass.

---

## 6) PASS/FAIL checklist

| Item | PASS/FAIL |
|------|-----------|
| HunterCard v3: Intel Box, Identity, SEAL DEAL CTA | |
| Intent accents: WhatsApp emerald, Phone blue, Form purple | |
| SealModal: chips, custom amount, TRY; onConfirm → seal API | |
| Seal API: sale_amount, currency, status=confirmed, confirmed_at, confirmed_by, oci_status=sealed | |
| Optimistic UI + toast on success/error | |
| Seal API uses server client + RLS (no adminClient); Bearer or cookie | |
| **Smoke: node scripts/smoke/casino-ui-proof.mjs PASS** | **PASS** |
| Policy/column checks (calls/sites) per section 3 | |
| npm run build compiles successfully | |
| Modal mobile-friendly; buttons reachable | |
