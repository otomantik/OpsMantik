BEGIN;

-- Supabase linter: public tables exposed via PostgREST must have RLS + tenant-aware policies.

-- ── offline_conversion_queue ───────────────────────────────────────────────
ALTER TABLE public.offline_conversion_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_conversion_queue_select_site_members ON public.offline_conversion_queue;
CREATE POLICY offline_conversion_queue_select_site_members ON public.offline_conversion_queue FOR SELECT USING (
  public._can_access_site(site_id)
);

DROP POLICY IF EXISTS offline_conversion_queue_write_service_role ON public.offline_conversion_queue;
CREATE POLICY offline_conversion_queue_write_service_role ON public.offline_conversion_queue FOR ALL USING (
  auth.role() = 'service_role'
)
WITH CHECK (auth.role() = 'service_role');

-- ── marketing_signals ───────────────────────────────────────────────────────
ALTER TABLE public.marketing_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_signals_select_site_members ON public.marketing_signals;
CREATE POLICY marketing_signals_select_site_members ON public.marketing_signals FOR SELECT USING (
  public._can_access_site(site_id)
);

DROP POLICY IF EXISTS marketing_signals_write_service_role ON public.marketing_signals;
CREATE POLICY marketing_signals_write_service_role ON public.marketing_signals FOR ALL USING (
  auth.role() = 'service_role'
)
WITH CHECK (auth.role() = 'service_role');

-- ── session_intent_actions_ledger ───────────────────────────────────────────
ALTER TABLE public.session_intent_actions_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS session_intent_actions_ledger_select_site_members ON public.session_intent_actions_ledger;
CREATE POLICY session_intent_actions_ledger_select_site_members ON public.session_intent_actions_ledger FOR SELECT USING (
  public._can_access_site(site_id)
);

DROP POLICY IF EXISTS session_intent_actions_ledger_write_service_role ON public.session_intent_actions_ledger;
CREATE POLICY session_intent_actions_ledger_write_service_role ON public.session_intent_actions_ledger FOR ALL USING (
  auth.role() = 'service_role'
)
WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.offline_conversion_queue TO service_role;
GRANT ALL ON TABLE public.marketing_signals TO service_role;
GRANT ALL ON TABLE public.session_intent_actions_ledger TO service_role;

GRANT SELECT ON TABLE public.offline_conversion_queue TO authenticated;
GRANT SELECT ON TABLE public.marketing_signals TO authenticated;
GRANT SELECT ON TABLE public.session_intent_actions_ledger TO authenticated;

COMMIT;
