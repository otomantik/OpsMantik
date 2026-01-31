# HunterCard Schema & RPC Payload Audit

**Date:** 2026-01-30  
**Scope:** `public.sessions`, `public.calls`, RPC `get_recent_intents_v2`, HunterCard field mapping.

---

## 1. Session fields (relevant to HunterCard)

| Column | Exists | Migration / proof |
|--------|--------|--------------------|
| **utm_term** | ✅ | `20260130250000_sessions_utm_term_matchtype.sql` |
| **utm_campaign** | ✅ | `20260130250300_sessions_utm_source_medium_campaign_content.sql` |
| **matchtype** | ✅ | `20260130250000_sessions_utm_term_matchtype.sql` |
| **device_type** | ✅ | `20260125225000_add_sessions_attribution_columns.sql` |
| **device_os** | ✅ | `20260130250800_sessions_device_os.sql` |
| **gclid** | ✅ | `20260125000000_initial_schema.sql` |
| **wbraid** | ✅ | `20260125000000_initial_schema.sql` |
| **gbraid** | ✅ | `20260125000000_initial_schema.sql` |
| utm_source | ✅ | `20260130250300_sessions_utm_source_medium_campaign_content.sql` |
| utm_medium | ✅ | same |
| utm_content | ✅ | same |
| ads_network | ✅ | `20260130250500_sessions_ads_network_placement.sql` |
| ads_placement | ✅ | same |
| city, district | ✅ | `20260125225000_add_sessions_attribution_columns.sql` |
| attribution_source | ✅ | same |
| ai_score, ai_summary, ai_tags | ✅ | `20260129100000_hunter_db_phase1.sql` |
| entry_page, total_duration_sec, event_count | ✅ | initial_schema / attribution |

**No missing session columns** for HunterCard: `sessions.device_os` and all UTM/ads columns exist.

---

## 2. Calls fields (relevant to HunterCard)

| Column | Exists | Migration / proof |
|--------|--------|--------------------|
| **estimated_value** | ✅ | `20260130100000_casino_kasa_calls_sites.sql` |
| **sale_amount** | ✅ | same |
| **currency** | ✅ | same |
| **click_id** | ✅ | `20260128038000_calls_inbox_fields.sql` |
| intent_action | ✅ | `20260128036000_calls_intent_stamp.sql` |
| intent_target | ✅ | same |
| intent_stamp | ✅ | same |
| intent_page_url | ✅ | `20260128038000_calls_inbox_fields.sql` |
| lead_score, status | ✅ | initial / `20260125232000_add_call_intent_columns.sql` |
| oci_status, oci_status_updated_at, oci_uploaded_at, oci_batch_id, oci_error | ✅ | `20260129000000_p0_oci_feedback_autoapprove_gamification.sql` |

**No missing calls columns** for HunterCard. `sale_amount` exists but is **not** in the RPC output (see below).

---

## 3. RPC that returns the card payload

- **Function:** `public.get_recent_intents_v2`
- **Signature:** `(p_site_id uuid, p_date_from timestamptz, p_date_to timestamptz, p_limit int DEFAULT 200, p_ads_only boolean DEFAULT true)`
- **Returns:** `jsonb[]`
- **Defined in (latest):** `supabase/migrations/20260130250900_intents_v2_device_os.sql`

**Output keys (in order as in `jsonb_build_object`):**

| Key | Source |
|-----|--------|
| id | c.id |
| created_at | c.created_at |
| intent_action | c.intent_action |
| intent_target | c.intent_target |
| intent_stamp | c.intent_stamp |
| intent_page_url | COALESCE(c.intent_page_url, s.entry_page) |
| matched_session_id | c.matched_session_id |
| lead_score | c.lead_score |
| status | c.status |
| click_id | COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) |
| oci_status | c.oci_status |
| oci_status_updated_at | c.oci_status_updated_at |
| oci_uploaded_at | c.oci_uploaded_at |
| oci_batch_id | c.oci_batch_id |
| oci_error | c.oci_error |
| attribution_source | s.attribution_source |
| gclid | s.gclid |
| wbraid | s.wbraid |
| gbraid | s.gbraid |
| total_duration_sec | s.total_duration_sec |
| event_count | s.event_count |
| oci_matchable | (computed) |
| risk_reasons | (computed) |
| risk_level | (computed) |
| oci_stage | (computed) |
| ai_score | s.ai_score |
| ai_summary | s.ai_summary |
| ai_tags | s.ai_tags |
| utm_term | s.utm_term |
| matchtype | s.matchtype |
| utm_source | s.utm_source |
| utm_medium | s.utm_medium |
| utm_campaign | s.utm_campaign |
| utm_content | s.utm_content |
| city | s.city |
| district | s.district |
| device_type | s.device_type |
| device_os | s.device_os |
| ads_network | s.ads_network |
| ads_placement | s.ads_placement |
| estimated_value | c.estimated_value |
| currency | c.currency |

**Not in RPC output:** `sale_amount` (exists on `calls` but not selected in `get_recent_intents_v2`). Add only if the card or exports need “actual sale amount” separately from `estimated_value`.

---

## 4. HunterCard field → source column → fallback rule

| HunterCard field | Source column | Fallback rule |
|------------------|---------------|---------------|
| **KEYWORD** | sessions.utm_term | None; if null show "—" (no path/campaign fallback for keyword). |
| **MATCH** | sessions.matchtype | Decode: e→Exact, p→Phrase, b→Broad; null → "—". |
| **CAMPAIGN** | sessions.utm_campaign | If null, use utm_campaign_id (from URL when name missing); if numeric long → "Campaign ID: X…"; else "—". |
| **Device** | sessions.device_type | sessions.device_os can enrich label (e.g. iOS→iPhone); currently `deviceLabel(deviceType)` only takes one arg so device_os is passed but unused. |
| **EST. VALUE** | calls.estimated_value | calls.currency for symbol (TRY→₺); null → empty. |
| **Click ID** | calls.click_id | COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) in RPC. |
| **Intent page** | c.intent_page_url | s.entry_page (RPC: COALESCE(c.intent_page_url, s.entry_page)). |
| **Location** | s.city, s.district | "district / city" or "Unknown Location" if both null. |
| **Risk / OCI** | (computed in RPC) | risk_level, risk_reasons, oci_stage from RPC. |
| **AI score/summary/tags** | s.ai_score, s.ai_summary, s.ai_tags | displayScore: ai_score if >0; else matchtype e→85, utm_source google→50, else 20. |

---

## 5. Missing or optional additions

- **sessions:** No missing columns. `device_os` exists (`20260130250800_sessions_device_os.sql`).
- **calls:** No missing columns. Optional: expose `sale_amount` in `get_recent_intents_v2` if UI or exports need “actual sale” vs “estimated value”.
- **Frontend mapping:** `QualificationQueue.tsx` `rows.map` from RPC does **not** pass to the intent object: `utm_term`, `matchtype`, `utm_campaign`, `utm_source`, `utm_medium`, `utm_content`, `city`, `district`, `device_type`, `estimated_value`, `currency`. Only `intent_page_url`, `ads_network`, `ads_placement`, `device_os`, and risk/OCI/AI fields are mapped. So for deck cards (except top with sessionEvidence merge), Keyword, Match, Campaign, Device, EST. VALUE will be empty unless these RPC keys are added to the mapping.
- **Device label:** `device_os` is passed to `deviceLabel(intent.device_type, intent.device_os)` but the implementation only uses the first parameter; using `device_os` (e.g. "iOS" → "iPhone") would improve the Device label without schema change.

---

## 6. Proof: SQL snippets

**Sessions columns (names only):**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sessions'
ORDER BY ordinal_position;
```

**Calls columns (names only):**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'calls'
ORDER BY ordinal_position;
```

**RPC definition (function name + file):**

- Function: `public.get_recent_intents_v2`
- File: `supabase/migrations/20260130250900_intents_v2_device_os.sql` (full `CREATE OR REPLACE FUNCTION` and `jsonb_build_object` list).

---

## 7. File references summary

| Item | Exact reference |
|------|-----------------|
| Sessions initial | `supabase/migrations/20260125000000_initial_schema.sql` (sessions CREATE TABLE) |
| Sessions UTM / device / ads | `20260130250000_sessions_utm_term_matchtype.sql`, `20260130250300_sessions_utm_source_medium_campaign_content.sql`, `20260130250500_sessions_ads_network_placement.sql`, `20260130250800_sessions_device_os.sql`, `20260125225000_add_sessions_attribution_columns.sql` |
| Calls initial + intent + casino | `20260125000000_initial_schema.sql`, `20260125232000_add_call_intent_columns.sql`, `20260128036000_calls_intent_stamp.sql`, `20260128038000_calls_inbox_fields.sql`, `20260130100000_casino_kasa_calls_sites.sql`, `20260129000000_p0_oci_feedback_autoapprove_gamification.sql` |
| RPC get_recent_intents_v2 | `supabase/migrations/20260130250900_intents_v2_device_os.sql` |
| HunterCard types & display | `components/dashboard-v2/HunterCard.tsx` (HunterIntent, keywordDisplay, getPrimaryIntent, deviceLabel, formatEstimatedValue, campaignDisplay) |
| RPC → queue mapping | `components/dashboard-v2/QualificationQueue.tsx` (rows.map after get_recent_intents_v2, sessionEvidence merge) |
