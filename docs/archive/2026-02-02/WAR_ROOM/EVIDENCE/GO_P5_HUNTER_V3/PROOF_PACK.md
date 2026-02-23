# GO P5 — HunterCard v3 (Predator HUD) — PROOF PACK

**Date:** 2026-01-30  
**Scope:** `components/dashboard-v2/HunterCard.tsx` refactor to Predator HUD design.

---

## Build Check

- [x] `npm run build` — **PASS** (TypeScript + Next.js build successful).

---

## Screenshot Checklist (Manual)

Capture a screenshot of the new card rendering a **High Intent** user:

1. **Environment:** Dashboard → Qualification Queue (Today or Yesterday).
2. **Data:** Use an intent that has:
   - **Keyword (utm_term):** e.g. "gümüş obje alanlar" or "antique silver price".
   - **Match type:** Exact (`matchtype === 'e'`) so the card shows **🔥 Exact Match (High Intent)**.
   - **District + City:** e.g. Kadıköy, Istanbul (district bold in TARGET HUD).
3. **Expected UI:**
   - **Header strip:** Green (Emerald) — WhatsApp / High Score (>80) / Exact Match.
   - **Top bar:** Source icon + Time ago + HOT LEAD badge (if ai_score > 80) + **💰 Est. X ₺** (if `estimated_value` set) + Safe/High Risk.
   - **INTEL BOX (left):** Keyword highlighted (amber ring/bg), Match Type badge, Path.
   - **TARGET HUD (right):** 📍 **Kadıköy**, Istanbul; Device; Identity (masked).
   - **Footer:** JUNK, SKIP, SEAL DEAL.

Save screenshot as:  
`docs/WAR_ROOM/EVIDENCE/GO_P5_HUNTER_V3/hunter_card_v3_high_intent.png`

---

## Technical Summary

| Item | Status |
|------|--------|
| Types (`HunterIntent`) | `utm_term`, `matchtype`, `utm_campaign`, `district`, `estimated_value`, `currency` included |
| Header colors | Green: WhatsApp / High Score >80 / Exact Match; Blue: Phone; Purple: Form |
| Badges | 🔥 Exact Match (High Intent) when `matchtype === 'e'`; 💰 Est. {value} ₺ when `estimated_value` |
| Location | "📍 **District**, City" (district bold) |
| Layout | Top bar → 2-column grid (INTEL BOX left, TARGET HUD right) → AI summary → Rating → Footer |
| Handlers | `onSeal`, `onJunk`, `onSkip`, `onSealDeal` unchanged |
| RPC | `get_recent_intents_v2` returns `estimated_value`, `currency` (migration `20260130250200_intents_v2_estimated_value.sql`) |
