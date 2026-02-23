# Conversation Layer — Security Audit (SECURITY DEFINER RPCs)

**Scope:** `confirm_sale_and_enqueue`, `update_offline_conversion_queue_attribution`, `claim_offline_conversion_jobs`.  
**Assumptions:** RLS is bypassed inside SECURITY DEFINER; attackers can call RPCs from the client; no trust in route-level auth.

---

## A) Severity table

| Finding | Severity | Explanation | Fix |
|--------|----------|-------------|-----|
| **confirm_sale_and_enqueue** does not validate tenant access | **P0** | Any authenticated user can pass a guessed/leaked sale UUID and confirm another tenant's sale, enqueue conversions for another site, and corrupt data. | After locking the sale row, require `can_access_site(auth.uid(), v_sale.site_id)` when `auth.uid()` IS NOT NULL; reject with `access_denied` otherwise. Allow when `auth.uid()` IS NULL (service_role). |
| **update_offline_conversion_queue_attribution** does not validate tenant access | **P0** | Any authenticated user can backfill attribution (or overwrite gclid/wbraid/gbraid) for another tenant's sale by guessing `sale_id`. | Resolve sale by id, then require `can_access_site(auth.uid(), v_sale.site_id)` when `auth.uid()` IS NOT NULL. Allow service_role when `auth.uid()` IS NULL. |
| **update_offline_conversion_queue_attribution** no row locking | **P1** | Concurrent resolve calls for the same sale can interleave read/update; last write wins with no ordering. Low risk of corruption but non-deterministic. | Lock sale with `FOR UPDATE`, then lock the queue row by `sale_id` (e.g. select for update from queue where sale_id = p_sale_id) before updating. |
| **claim_offline_conversion_jobs** callable by authenticated if grant is widened | **P2** | Currently granted only to `service_role`; if EXECUTE is ever granted to `authenticated`, a user could claim and see other tenants' queue rows. | Enforce caller is service_role: if `auth.uid() IS NOT NULL` raise `access_denied` (or check role). No tenant filter needed when only service_role can run. |
| **confirm_sale_and_enqueue** conversation read without lock | **P2** | Reading `conversations.primary_source` without locking the conversation row; theoretical TOCTOU. Conversation is not updated by this RPC. | Optional: join conversations in the same transaction with FOR UPDATE. Hardening: lock conversation when conversation_id IS NOT NULL. |
| **search_path** | **P2** | Already set to `public` in all three; no injection risk. | Keep explicit `SET search_path = public` and fully qualify `public.*` in hardened versions. |
| **claim_offline_conversion_jobs** ordering | **P2** | Fair processing order. | Use explicit `ORDER BY created_at ASC` in the subquery. |
| **Idempotency** | — | confirm: ON CONFLICT DO NOTHING preserves idempotency. claim: FOR UPDATE SKIP LOCKED prevents double-claim. | Preserved in hardened versions. |

---

## B) Summary of hardened design

- **Tenant check:** Introduce `public.can_access_site(p_user_id uuid, p_site_id uuid) RETURNS boolean` (SECURITY DEFINER, `search_path = public`), matching RLS logic: site owner, site_members member, or `is_admin(p_user_id)`.
- **confirm_sale_and_enqueue:** Lock sale `FOR UPDATE`; if `auth.uid()` IS NOT NULL` then require `can_access_site(auth.uid(), v_sale.site_id)` else allow (service_role). Then confirm and enqueue as today. All table names fully qualified.
- **update_offline_conversion_queue_attribution:** Lock sale `FOR UPDATE`; if `auth.uid()` IS NOT NULL` require `can_access_site(auth.uid(), v_sale.site_id)` else allow. Lock queue row with `SELECT ... FOR UPDATE` where `sale_id = p_sale_id`, then update. Fully qualified names.
- **claim_offline_conversion_jobs:** If `auth.uid() IS NOT NULL` raise `access_denied` (service_role only). Otherwise keep current logic: subquery `ORDER BY created_at ASC`, `FOR UPDATE SKIP LOCKED`, update and return. Fully qualified.

---

## C) Concurrency (claim RPC)

- **FOR UPDATE SKIP LOCKED:** Already used; no double-claim of the same row.
- **ORDER BY created_at ASC:** Explicit in hardened version for FIFO.
- **Return claimed rows:** `RETURNING q.*` unchanged.
- **Phantom rows:** Subquery selects and locks a set of rows; outer UPDATE updates exactly those rows. Safe.

---

## D) Files

- **Audit (this file):** `docs/CONVERSATION_LAYER_SECURITY_AUDIT.md`
- **Hardened migration:** `supabase/migrations/20260218100000_conversation_layer_rpc_security_hardening.sql`
