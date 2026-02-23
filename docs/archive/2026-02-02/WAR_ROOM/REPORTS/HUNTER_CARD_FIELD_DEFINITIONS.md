# HunterCard Field Definitions

**Purpose:** Canonical definitions for HunterCard labels to avoid confusion between **estimated value** (Casino/Seal) and **AI score**.

---

## EST. VALUE (Estimated Value)

| Aspect | Definition |
|--------|-------------|
| **Source** | `calls.estimated_value` (and optional `calls.currency`) |
| **When set** | When you **seal a deal** — manual or ops (Seal modal / Casino chip). |
| **Not** | Not AI-derived. Not from the AI pipeline. |
| **UI** | Label: **💰 EST. VALUE:** with value (e.g. "5K", "20K ₺") or "—" if unset. |
| **Tooltip** | "Set when you seal a deal (manual/ops). Not AI." |

---

## SCORE (AI Score)

| Aspect | Definition |
|--------|-------------|
| **Source** | `sessions.ai_score` |
| **When set** | By the **AI pipeline** (hunter-ai Edge Function) when pipeline is enabled — after high-intent call (phone/whatsapp) insert, pg_net invokes hunter-ai, which calls OpenAI and updates `sessions.ai_score`, `ai_summary`, `ai_tags`. |
| **Not** | Not the same as estimated value. Not set by sealing a deal. |
| **UI** | Badge in card header: **Score: {value}** (0–100). Fallback logic when `ai_score` is null (e.g. exact match → 85, google source → 50, else 20). |
| **Tooltip** | "AI score (if pipeline enabled)." |

---

## Summary

| Label | Data | Set by | Tooltip (HunterCard) |
|-------|------|--------|----------------------|
| **EST. VALUE** | `calls.estimated_value` | Seal deal (manual/ops) | Set when you seal a deal (manual/ops). Not AI. |
| **SCORE** | `sessions.ai_score` | AI pipeline (if enabled) | AI score (if pipeline enabled). |

---

## References

- HunterCard tooltips: `components/dashboard-v2/HunterCard.tsx` (EST. VALUE bar, Score badge).
- AI pipeline gate: `docs/WAR_ROOM/REPORTS/AI_SCORE_PIPELINE_GATE.md`, `npm run smoke:ai-pipeline-gate`.
- Seal/Casino: GO2 Casino UI, Seal modal sets `calls.estimated_value`.

---

## Proof (screenshot)

To capture a HunterCard screenshot showing the tooltips (EST. VALUE, Score):

1. Ensure app is running (`npm run dev` or `npm run start`) and `.env.local` has Supabase + `PROOF_EMAIL` / `PROOF_PASSWORD`.
2. Run: `node scripts/smoke/go2-casino-screenshots.mjs`  
   (Requires `npx playwright install` once.)  
   Saves `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/hunter-card.png` when a card is visible in the queue.
