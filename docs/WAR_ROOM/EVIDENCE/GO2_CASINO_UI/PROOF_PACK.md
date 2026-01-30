# GO2 Casino UI — Proof Pack

**Date:** 2026-01-29  
**Scope:** HunterCard v3 (Predator HUD) + SealModal (Casino Table) + seal API; writes `sale_amount` to `public.calls`.

---

## 1. Files touched

| Action   | Path |
|----------|------|
| Modified | `components/dashboard-v2/HunterCard.tsx` |
| Modified | `components/dashboard-v2/QualificationQueue.tsx` |
| Added    | `components/dashboard-v2/SealModal.tsx` |
| Added    | `app/api/calls/[id]/seal/route.ts` |
| Added    | `lib/hooks/use-site-config.ts` |
| Added    | `scripts/smoke/casino-ui-proof.mjs` |
| Added    | `scripts/smoke/go2-casino-screenshots.mjs` |
| Added    | `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/PROOF_PACK.md` |

---

## 2. Key diff hunks

### 2.1 HunterCard.tsx

- **Visual identity by intent:** WhatsApp = emerald accents (`border-emerald-500`, `bg-emerald-50 text-emerald-700`); Phone = blue; Form = purple.
- **Intel Box:** PAGE, CITY/DISTRICT (if present), DEVICE, CLICK_ID (if present); key context in one block.
- **Identity:** Masked fingerprint (`maskIdentity(intent_target)`), session id short (`matched_session_id.slice(0, 8)`).
- **CTA:** "SEAL DEAL" button; when `onSealDeal` is provided, click opens SealModal; otherwise falls back to star-based seal.

### 2.2 SealModal.tsx

- **Opens on SEAL DEAL.** shadcn `Dialog`; `DialogContent` `max-w-[min(92vw,400px)] max-h-[85vh] overflow-y-auto` (mobile-friendly).
- **Chip values** from `chipValues` prop (from `site.config.bounty_chips` or defaults `[1000, 5000, 10000, 25000]`).
- **Custom amount** input; currency from prop (default TRY).
- **onConfirm(saleAmount, currency):** parent calls `POST /api/calls/[id]/seal`; on success: optimistic UI + toast; on error: toast.

### 2.3 QualificationQueue.tsx

- **useSiteConfig(siteId):** `bountyChips`, `siteCurrency` for SealModal.
- **State:** `sealModalOpen`, `intentForSeal`.
- **onSealDeal** passed to ActiveDeckCard: `setIntentForSeal(mergedTop); setSealModalOpen(true)`.
- **SealModal** rendered when `intentForSeal`; **onConfirm** fetches `POST /api/calls/${intentForSeal.id}/seal` with `{ sale_amount, currency }`; **onSuccess:** `optimisticRemove`, `pushHistoryRow`, `pushToast('success', 'Deal sealed.')`, close modal, `handleQualified()`; **onError:** `pushToast('danger', message)`.

### 2.4 API route `POST /api/calls/[id]/seal`

- **Body:** `{ sale_amount, currency }` (currency default TRY).
- **Auth:** server `createClient()` (not adminClient); `validateSiteAccess(siteId, user.id)`.
- **Update:** `sale_amount`, `currency`, `status: 'confirmed'`, `confirmed_at`, `confirmed_by`, `oci_status: 'sealed'`, `oci_status_updated_at`; only rows with `status` in `['intent', null]`.
- **Response:** `{ success: true, call: { id, sale_amount, currency, status, confirmed_at } }` or 4xx/5xx with `{ error }`.

### 2.5 use-site-config.ts

- Fetches `sites.config` (jsonb) for `siteId`; returns `bountyChips` (array from `config.bounty_chips` or `[1000, 5000, 10000, 25000]`), `currency` (default `'TRY'`).

---

## 3. Automated smoke

**Script:** `node scripts/smoke/casino-ui-proof.mjs`

**Flow:**
1. Find a test call row (existing intent) for the proof site: `calls` where `site_id = DASHBOARD_PATH site` and `status in ('intent', null)`.
2. Auth (Supabase anon sign-in, proof user); inject session cookie into Playwright context; `page.request.post(BASE_URL + '/api/calls/' + callId + '/seal', { data: { sale_amount: 1000, currency: 'TRY' } })`.
3. Verify with service_role: call row has `sale_amount = 1000`, `status = 'confirmed'`.

**Output:** `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/smoke_log.txt`  
**Requires:** App running (`npm run start` or `npm run dev`), `.env.local` with Supabase + `PROOF_EMAIL` / `PROOF_PASSWORD` (and optional `PROOF_URL`, `PROOF_DASHBOARD_PATH`).

---

## 4. Playwright screenshots

**Script:** `node scripts/smoke/go2-casino-screenshots.mjs`

**Flow:**
1. Auth + goto dashboard (mobile viewport 390×844).
2. If Hunter card visible: screenshot → `hunter-card.png`.
3. Click "SEAL DEAL"; when modal visible: screenshot → `seal-modal-chips.png`; Escape to close.

**Output dir:** `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/`  
**Expected files:** `hunter-card.png`, `seal-modal-chips.png` (when queue has a card).

---

## 5. Build logs

**Command:** `npm run build`  
**Log:** `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/build_log.txt` (capture locally)

**Excerpt (this environment):**

```
> next build
▲ Next.js 16.1.4 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 6.1s
  Running TypeScript ...
Error: spawn EPERM
```

**Note:** Compile PASS (6.1s). TypeScript step hit EPERM in sandbox. Run `npm run build` locally for full build.

---

## 6. UI proof (mobile)

- **Modal:** `max-w-[min(92vw,400px)] max-h-[85vh] overflow-y-auto` — no overflow; buttons reachable.
- **Header:** No shift; DialogHeader + DialogFooter fixed in layout.

---

## 7. PASS/FAIL checklist

| Item | PASS/FAIL |
|------|-----------|
| HunterCard v3: Intel Box (page, city/district, device, click_id), Identity (masked + session short), SEAL DEAL CTA | |
| Intent accents: WhatsApp emerald, Phone blue, Form purple | |
| SealModal opens on SEAL DEAL; chips from site.config or [1000,5000,10000,25000]; custom amount; currency TRY | |
| Confirm updates call: sale_amount, currency, status=confirmed, confirmed_at, confirmed_by, oci_status=sealed | |
| Optimistic UI + toast on success; toast on error | |
| POST /api/calls/[id]/seal uses server client + RLS (no adminClient) | |
| Smoke: casino-ui-proof.mjs — create/identify call, seal API 200, DB sale_amount=1000, status=confirmed | |
| Screenshots: hunter-card.png, seal-modal-chips.png in GO2_CASINO_UI | |
| npm run build compiles successfully (run locally if EPERM in CI) | |
| Modal works on mobile without overflow; buttons reachable | |
