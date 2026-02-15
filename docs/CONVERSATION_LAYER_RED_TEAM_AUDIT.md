# Conversation Layer — Red-Team Tenant Isolation Audit

**Role:** Offensive security; objective is to break tenant isolation.  
**Assumptions:** Authenticated user, NOT admin, belongs to site A only; can call RPCs directly; can inspect traffic and guess/leak UUIDs. SECURITY DEFINER RPCs and RLS in place.

---

## A) Exploit Matrix

| Attack | Possible? | Severity | Exploit Method | Fix |
|--------|-----------|----------|----------------|-----|
| **1. Direct RPC tenant escape (confirm)** | **No** (with hardening) | — | Call `confirm_sale_and_enqueue(sale_id_B)`. RPC runs as definer; **hardened** version loads sale, then enforces `can_access_site(auth.uid(), v_sale.site_id)`. For sale on site B, check fails → `access_denied`. | **Already mitigated** by migration `20260218100000`: RPC must validate tenant before any mutation. If hardening not applied: **P0** — apply RPC tenant check. |
| **2. Queue attribution hijack** | **No** (with hardening) | — | Call `update_offline_conversion_queue_attribution(sale_id_B)`. Hardened RPC loads sale (site B), then `can_access_site(uid, site_B)` → false → raises before UPDATE. | **Already mitigated** in same migration. Without it: **P0** — attacker could backfill/write queue row for another tenant. |
| **3. UUID enumeration / sale_id power** | **Partial** | P2 | Knowing `sale_id` alone: with hardened RPCs, mutation is blocked (access_denied). **Info leak:** `sale_not_found` vs `access_denied` may reveal whether a UUID is a valid sale (different site) vs invalid. Enumeration does not grant cross-tenant mutation. | Normalize error: return same message/code for “not found” and “access denied” (e.g. always `sale_not_found` or generic `access_denied`) so existence is not leaked. |
| **4. Conversation link injection (cross-site entity)** | **Yes** | P1 | Create conversation on site A. POST `/api/conversations/link` with `conversation_id=A_conv`, `entity_type=call`, `entity_id=call_id_from_site_B`. Route checks access to **conversation’s site** (A) only; **no check that entity_id belongs to A**. No FK from `conversation_links.entity_id` to `calls`/`sessions`. Insert succeeds. Site A’s conversation now references site B’s entity → attribution/reporting pollution. | **DB:** Optional FK (e.g. entity_id → calls.id when entity_type=call) only if schema allows. **API:** Before insert, resolve entity: ensure entity exists in `calls`/`sessions`/`events` and belongs to **same site** as conversation (e.g. call has site_id or is reachable via site). Reject 400 if entity missing or wrong site. |
| **5. Cross-site external ref abuse** | **No** | — | Uniqueness is `(site_id, external_ref)` with partial index `WHERE external_ref IS NOT NULL`. Sale on A with `external_ref='order-1'` and sale on B with `external_ref='order-1'` are different rows. No cross-tenant overwrite; no queue poisoning. | None. Document that external_ref is scoped per site. |
| **6. Cron secret abuse** | **Yes** (impact limited) | P2 | Replay POST `/api/cron/oci/enqueue-from-sales` with `Authorization: Bearer <CRON_SECRET>`. Cron uses **adminClient** (service_role); reads all CONFIRMED sales in window, inserts queue rows. Attacker can trigger heavy DB load, duplicate enqueue attempts (23505 handled), or exhaust hours=168. **No cross-tenant mutation** of sales; queue inserts are per sale_id (idempotent). | **API:** Rate limit by IP or by CRON_SECRET (e.g. 1 req/min per key). Optional: require `x-vercel-cron: 1` for production and restrict Bearer to internal/backup only. **Idempotency:** Already safe (ON CONFLICT / 23505). |
| **7. Service role escalation** | **No** | — | Client uses anon/authenticated key; backend uses service_role only in cron (adminClient). User’s `supabase.rpc()` carries user JWT → `auth.uid()` set in RPC. No way for client to force backend to call RPC as service_role. Grant to `authenticated` is required so route can call RPC with user context; RPC’s own `can_access_site` is the enforcement. | None. Keep RPC granted to authenticated + service_role; keep tenant check inside RPC. |

---

## B) Concrete Hardening Plan

### 1. Direct RPC tenant escape — already fixed

- **DB:** Hardened RPCs use `can_access_site(auth.uid(), v_sale.site_id)` before any write. Ensure migration `20260218100000_conversation_layer_rpc_security_hardening.sql` is applied.
- **RLS:** RLS does not run inside SECURITY DEFINER; DB-level fix is the RPC check. No RLS change.
- **RPC:** No further change if hardening applied.
- **API:** Routes still validate site before calling RPC; defense in depth.
- **Constraint:** N/A.

### 2. Queue attribution hijack — already fixed

- Same as above: RPC-level tenant check blocks cross-tenant update.

### 3. UUID enumeration / info leak

- **DB:** No change.
- **RLS:** No change.
- **RPC:** In `confirm_sale_and_enqueue` and `update_offline_conversion_queue_attribution`, consider returning same error message for “sale not found” and “access denied” (e.g. always raise with message `access_denied` or `sale_not_found` and same ERRCODE) so response does not reveal whether UUID is a valid sale in another tenant.
- **API:** Map both to 403 or 404 with same body so client cannot distinguish.
- **Constraint:** N/A.

### 4. Conversation link injection (cross-site entity)

- **DB:** Option A — add FKs only if entity tables are single-tenant and you can add `CHECK (entity_type = 'call' AND entity_id IN (SELECT id FROM calls WHERE site_id = (SELECT site_id FROM conversations WHERE id = conversation_id)))` or equivalent (complex). Option B — no schema change; enforce in app.
- **RLS:** RLS already restricts who can insert into conversation_links (via conversation’s site). No change for cross-entity check.
- **RPC:** N/A (link is via API insert).
- **API:** In POST `/api/conversations/link`: after validating conversation and site access, **resolve entity:** for `entity_type=call` select from `calls` where `id = entity_id` and ensure that call’s site (or linked site) equals `conversation.site_id`; same for session/event. Reject with 400 if entity not found or site mismatch.
- **Constraint:** Optional composite FK or trigger; app check is minimum.

### 5. Cross-site external ref — no change

- Already safe.

### 6. Cron secret abuse

- **DB:** N/A.
- **RLS:** N/A.
- **RPC:** N/A.
- **API:** Rate limit cron route (e.g. by IP or by Bearer token identity): max N requests per minute. Reject 429 when exceeded. Optionally require `x-vercel-cron: 1` in production and use Bearer only for internal/backup.
- **Constraint:** N/A.

### 7. Service role escalation — no change

- No escalation path; RPC design is correct.

---

## C) Attack Confidence Score

| Vector | Confidence | Notes |
|--------|------------|--------|
| 1. Direct RPC tenant escape | **LOW** | With hardening applied, attack fails. Without hardening: HIGH. |
| 2. Queue attribution hijack | **LOW** | Same as above. |
| 3. UUID enumeration | **MEDIUM** | Cannot mutate cross-tenant; info leak (sale existence / wrong tenant) is realistic if errors differ. |
| 4. Conversation link injection | **HIGH** | No FK or site check on entity_id; one API call with leaked or guessed call_id from B succeeds from A. Realistic. |
| 5. Cross-site external ref | **LOW** | Uniqueness is per site; no exploit. |
| 6. Cron secret abuse | **MEDIUM** | If CRON_SECRET leaks, replay is trivial; impact is load/abuse, not cross-tenant mutation. |
| 7. Service role escalation | **LOW** | No path for client to get service_role context. |

---

## D) Final Verdict

**Is tenant isolation Strong, Fragile, or Critically vulnerable?**

**Fragile.**

- **With hardening migration applied:** Direct RPC-based tenant escape and queue attribution hijack are **blocked** at the DB. Sale and queue mutations are protected by `can_access_site` inside SECURITY DEFINER. Claim RPC is service_role-only. That gives **strong isolation for sales and queue writes** from direct RPC abuse.
- **Remaining weaknesses:**  
  - **Conversation link injection (cross-site entity_id)** is a real gap: any user with access to a site can link entities from another site, polluting attribution and breaking logical isolation. Confidence HIGH.  
  - **Cron secret replay** does not break tenant isolation but allows abuse of a privileged endpoint.  
  - **Enumeration** (sale_not_found vs access_denied) is a minor information leak, not a mutation flaw.

**Summary:** For **ad-spend and cross-tenant mutation**, the system is **not critically vulnerable** provided the RPC hardening migration is applied. It is **fragile** because one high-confidence attack (link injection) remains and cron is abuseable. To move to **strong**: (1) enforce same-site (or FK) validation for `entity_id` in conversation link, (2) normalize RPC/API error responses for enumeration, (3) add rate limiting (and optional header restriction) for the cron endpoint. Assume motivated attackers and treat link injection as P1 until fixed.
