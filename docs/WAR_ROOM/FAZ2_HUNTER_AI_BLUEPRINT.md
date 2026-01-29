# PHASE 2 — Hunter AI: Technical Design (Blueprint)

**Date:** 2026-01-29  
**Status:** Design (STEP 1)  
**Purpose:** Define when the AI runs, what data it reads, and exactly what it sends to OpenAI/Gemini. No coding from memory.

---

## 1. Objective

When a **High Intent** (phone click or WhatsApp click) is recorded in `calls`, the system shall:

1. **Trigger** an AI pipeline with the relevant session + intent + events.
2. **Call** OpenAI or Gemini with a structured prompt.
3. **Write back** into `sessions`: `ai_score` (0–100), `ai_summary` (short text), `ai_tags` (array).
4. **Surface** this intel on the Dashboard (e.g. HOT LEAD badge when `ai_score > 80`, Intel Box with `ai_summary`).

---

## 2. Data Model (Already in Place)

### 2.1 Sessions (write target)

| Column | Type | Purpose |
|--------|------|---------|
| `ai_score` | INTEGER DEFAULT 0 | AI-derived lead quality score (0–100). |
| `ai_summary` | TEXT | AI-generated session summary (e.g. one sentence in Turkish). |
| `ai_tags` | TEXT[] | AI tags (e.g. `high-intent`, `gümüş`, `fiyat-sayfası`). |
| `user_journey_path` | TEXT | Optional: simplified path (e.g. Home > Service > Contact). |

*Defined in:* `supabase/migrations/20260129100000_hunter_db_phase1.sql`

### 2.2 High-Intent Definition

A row in `calls` is **high intent** when:

- `source = 'click'`
- `status IN ('intent', NULL)`
- `intent_action IN ('phone', 'whatsapp')`

Each such row has `matched_session_id` → the session to enrich.

---

## 3. When the AI Runs (Trigger)

**Event:** A new row is inserted into `public.calls` with `source = 'click'` and `intent_action IN ('phone', 'whatsapp')` (and typically `status = 'intent'` or NULL).

**Options:**

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A** | Supabase **Database Webhooks** (Dashboard: Database → Webhooks) | No migration, UI config | Not in repo, manual per env |
| **B** | **pg_net** trigger: `AFTER INSERT ON calls` → `net.http_post` to Edge Function URL | Version-controlled, same for all envs | Requires pg_net, Vault for URL + key |

**Recommendation:** **Option B** (migration with pg_net trigger) for reproducibility. Option A remains valid for quick setup.

**Trigger payload (to Edge Function):**

- Webhook/trigger sends the **new row** (or a subset). Minimum needed:
  - `call_id` (calls.id)
  - `matched_session_id` (sessions.id)
  - `site_id` (sites.id)
  - `intent_action`, `intent_target`, `intent_page_url`, `created_at`

So the Edge Function receives e.g.:

```json
{
  "type": "INSERT",
  "table": "calls",
  "record": {
    "id": "uuid",
    "site_id": "uuid",
    "matched_session_id": "uuid",
    "intent_action": "whatsapp",
    "intent_target": "+905...",
    "intent_page_url": "https://...",
    "created_at": "..."
  }
}
```

---

## 4. What the AI Reads (Inputs)

The Edge Function must fetch:

1. **Session** (row from `sessions` for `matched_session_id`):
   - `id`, `site_id`, `entry_page`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `gclid`, `wbraid`, `gbraid`, `created_at`
   - (Optional: device, referrer if present.)

2. **Timeline** (events for that session):
   - Use existing `get_session_timeline(p_site_id, p_session_id)` or direct query to `events` for `session_id = matched_session_id`.
   - Fields: `event_category`, `event_action`, `event_label`, `url`, `created_at` (and optional `metadata`).

3. **Intent (call row)** — already in webhook payload:
   - `intent_action`, `intent_target`, `intent_page_url`, `created_at`, `click_id` if present.

**Aggregated context for the LLM:**

- A short **text blob** (or structured JSON) summarizing: entry point, UTM/campaign, list of page views/actions in order, and the final intent (phone/WhatsApp, target, page). No PII in the prompt beyond what’s necessary (e.g. “phone/WhatsApp” and “page URL path”); avoid logging full phone numbers in the prompt if possible.

---

## 5. Prompt Structure (What We Ask OpenAI/Gemini)

**Role:** You are a lead qualification assistant for a Turkish business (e.g. antiques / collectibles). Given a session summary and the user’s last action (phone or WhatsApp click), score the lead and summarize intent.

**Input (to be filled by Edge Function):**

- Session: entry page, UTM source/medium/campaign/term, click_id presence (yes/no).
- Timeline: ordered list of (event_action, url or label, timestamp).
- Intent: action (phone/WhatsApp), page URL where they clicked, timestamp.

**Output (strict JSON):**

```json
{
  "ai_score": 85,
  "ai_summary": "Kullanıcı gümüş aramasıyla geldi, fiyat sayfasını görüntüledi ve WhatsApp ile iletişime geçmek istiyor. Yüksek niyet.",
  "ai_tags": ["high-intent", "gümüş", "whatsapp", "fiyat-sayfası"]
}
```

- **ai_score:** 0–100 integer. High intent + relevant pages + ads source → higher score.
- **ai_summary:** One or two sentences in Turkish. No PII (no phone numbers).
- **ai_tags:** Array of lowercase, hyphenated tags (e.g. `high-intent`, `gümüş`, `fiyat-sayfası`, `whatsapp`). Used for filtering and badges.

**Model:** Prefer a fast, cheap model for latency and cost (e.g. GPT-4o-mini or Gemini Flash). Fallback to a stronger model only if needed.

---

## 6. What the AI Writes Back (Output)

**Single UPDATE:**

```sql
UPDATE public.sessions
SET
  ai_score = :ai_score,
  ai_summary = :ai_summary,
  ai_tags = :ai_tags,
  updated_at = NOW()  -- if column exists
WHERE id = :matched_session_id;
```

- **Idempotency:** Each high-intent insert triggers one run. Each run **overwrites** that session’s `ai_score`, `ai_summary`, `ai_tags`. (No merge logic in v1.)
- **Failure:** If the LLM or UPDATE fails, log and optionally retry (e.g. one retry with backoff). Do not block the Sync API or the webhook sender.

---

## 7. Edge Function Architecture

| Component | Responsibility |
|-----------|----------------|
| **Name** | `hunter-ai` (e.g. `supabase/functions/hunter-ai/index.ts`) |
| **Invocation** | HTTP POST. Called by Database Webhook (Option A) or pg_net trigger (Option B). |
| **Auth** | `verify_jwt = false` for webhook/trigger; validate secret header or body token so only our trigger can call. |
| **Input** | Webhook payload with `record` (call row). Function reads `matched_session_id`, `site_id`, and fetches session + timeline. |
| **LLM** | Build prompt from session + timeline + intent → call OpenAI or Gemini API → parse JSON. |
| **Output** | UPDATE `sessions` with `ai_score`, `ai_summary`, `ai_tags` for `matched_session_id`. |
| **Secrets** | `OPENAI_API_KEY` or `GEMINI_API_KEY` (Supabase Edge Function secrets). |

**Flow:**

1. Receive POST with webhook payload (inserted call row).
2. Extract `matched_session_id`, `site_id`, call fields.
3. Fetch session row (Supabase client, service role).
4. Fetch timeline (RPC `get_session_timeline` or direct `events` query).
5. Build prompt text (or structured message) from session + timeline + intent.
6. Call OpenAI (e.g. chat.completions) or Gemini (e.g. generateContent) with output format = JSON.
7. Parse response; validate `ai_score` in 0–100, `ai_summary` string, `ai_tags` array.
8. UPDATE `sessions` for `matched_session_id`.
9. Return 200 and minimal body (e.g. `{ "ok": true, "session_id": "..." }`). On error return 500 and log.

---

## 8. Dashboard Integration (Reference for STEP 4)

- **Component:** `HunterCard` (e.g. `components/dashboard-v2/HunterCard.tsx`).
- **Data:** Intent payload already has or can be extended with `session` (or session id). If not, fetch session by `matched_session_id`; session now includes `ai_score`, `ai_summary`, `ai_tags`.
- **UI:**
  - If `ai_score > 80`: show **HOT LEAD** badge on the card.
  - **Intel Box:** Show `ai_summary` (and optionally `ai_tags` as chips).
- **Realtime:** When session is updated (e.g. Realtime on `sessions` or refetch after intent list update), card can refresh to show new AI fields.

---

## 9. Security and Privacy

- **PII:** Do not send full phone numbers or identity strings into the LLM prompt if avoidable; use “phone/WhatsApp clicked” and page paths. If included, ensure provider policy and logging are acceptable.
- **Secrets:** API keys only in Supabase Edge Function secrets (or env); never in client or repo.
- **Webhook protection:** Shared secret header (e.g. `X-Webhook-Secret`) or signed payload so only our trigger can invoke the function.

---

## 10. Out of Scope (v1)

- **user_journey_path:** Optional; can be derived later from timeline (e.g. path of URLs).
- **Batch / cron:** Only “on high-intent insert” trigger in v1. No nightly batch reprocessing.
- **A/B model:** Single model (OpenAI or Gemini) per deployment.

---

## 11. Summary Table

| Item | Decision |
|------|----------|
| **Trigger** | On INSERT into `calls` with `source = 'click'` and `intent_action IN ('phone','whatsapp')`. Option B: pg_net trigger → POST to Edge Function. |
| **Input** | Webhook payload (call row) + fetched session + get_session_timeline (or events). |
| **Prompt** | Structured prompt → JSON with `ai_score`, `ai_summary`, `ai_tags`. Turkish summary, no PII. |
| **Output** | UPDATE `sessions` SET ai_score, ai_summary, ai_tags WHERE id = matched_session_id. |
| **API** | OpenAI (e.g. GPT-4o-mini) or Gemini (e.g. Gemini Flash). Key in Edge Function secrets. |
| **Dashboard** | HunterCard: ai_score > 80 → HOT LEAD badge; Intel Box shows ai_summary (and ai_tags). |

---

**Next (STEP 2):** Blueprint approved → prepare migration SQL (pg_net trigger or webhook config) and any RPC needed for the Edge Function.  
**Next (STEP 3):** Implement `supabase/functions/hunter-ai/index.ts`.  
**Next (STEP 4):** Update HunterCard for HOT LEAD badge and Intel Box.
