-- 🛡️ Iron Protocol: Database Hardening & Lean Optimization
-- Created: 2026-05-06
-- Scope: Security (RLS), Permissions (RPC), Storage (DNA Purge)

BEGIN;

--------------------------------------------------------------------------------
-- 1. SECURITY: Enable RLS on vulnerable tables
--------------------------------------------------------------------------------

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- Basic site-id isolation policies for these tables (Service Role always bypasses RLS)
DO $$ 
BEGIN
    -- Conversations: Check via site_memberships
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversations' AND policyname = 'site_isolation_policy') THEN
        CREATE POLICY site_isolation_policy ON public.conversations
        USING (EXISTS (SELECT 1 FROM public.site_memberships m WHERE m.site_id = conversations.site_id AND m.user_id = auth.uid()));
    END IF;
    
    -- Conversation Links: Check via parent conversation's site
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_links' AND policyname = 'site_isolation_policy') THEN
        CREATE POLICY site_isolation_policy ON public.conversation_links
        USING (EXISTS (
            SELECT 1 FROM public.conversations c 
            JOIN public.site_memberships m ON m.site_id = c.site_id 
            WHERE c.id = conversation_links.conversation_id AND m.user_id = auth.uid()
        ));
    END IF;
    
    -- Sales: Check via site_memberships
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales' AND policyname = 'site_isolation_policy') THEN
        CREATE POLICY site_isolation_policy ON public.sales
        USING (EXISTS (SELECT 1 FROM public.site_memberships m WHERE m.site_id = sales.site_id AND m.user_id = auth.uid()));
    END IF;
END $$;


--------------------------------------------------------------------------------
-- 2. PERMISSIONS: Revoke EXECUTE from anon on sensitive RPCs
--------------------------------------------------------------------------------

-- Prevent anonymous callers from triggering system-level logic
REVOKE EXECUTE ON FUNCTION public.calls_merge_cross_session_burst_twin_v1() FROM anon;
REVOKE EXECUTE ON FUNCTION public.calls_normalize_tel_uri_phone_click_v1() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_marketing_signal_time_from_call_created_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_oci_queue_conversion_time_from_call_created_at() FROM anon;

-- Also revoke from authenticated if these are meant to be Service Role only
REVOKE EXECUTE ON FUNCTION public.calls_merge_cross_session_burst_twin_v1() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.calls_normalize_tel_uri_phone_click_v1() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_conversation_with_primary_entity(uuid, text, uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_entitlements_for_site(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_marketing_signal_time_from_call_created_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_oci_queue_conversion_time_from_call_created_at() FROM authenticated;


--------------------------------------------------------------------------------
-- 3. INTEGRITY: Fix Mutable Search Paths (Search Path Hardening)
--------------------------------------------------------------------------------

ALTER FUNCTION public.validate_conversion_value_policy_v1(text, jsonb) SET search_path = public;


--------------------------------------------------------------------------------
-- 4. LEAN & MEAN: Purge Causal DNA Bloat (The Big Cleanup)
--------------------------------------------------------------------------------

-- Drop the legacy DNA ledger appending function as it is no longer used by the code
DROP FUNCTION IF EXISTS public.append_causal_dna_ledger(uuid, text, uuid, jsonb);

-- Retroactive Full Purge: Nullify ALL causal DNA to reclaim maximum space
UPDATE public.marketing_signals 
SET causal_dna = '{}'::jsonb 
WHERE causal_dna != '{}'::jsonb;

UPDATE public.offline_conversion_queue 
SET causal_dna = '{}'::jsonb 
WHERE causal_dna != '{}'::jsonb;

-- 5. STORAGE: Drop the bulky legacy ledger table entirely
DROP TABLE IF EXISTS public.causal_dna_ledger CASCADE;
DROP TABLE IF EXISTS public.causal_dna_ledger_failures CASCADE;


--------------------------------------------------------------------------------
-- 5. MAINTENANCE: Automated Pruning (pg_cron or manual cleanup)
--------------------------------------------------------------------------------

-- Suggestion: If pg_cron is enabled, these should be scheduled.
-- For now, we perform a one-time pruning of processed events.
DELETE FROM public.outbox_events WHERE status = 'PROCESSED' AND created_at < NOW() - INTERVAL '7 days';

COMMIT;
