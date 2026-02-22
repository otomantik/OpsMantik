-- GDPR: Audit triggers for low-volume tables (provider_credentials, site_members, site_plans, conversations, sales)
-- payload: NO PII; only table_name, record_id, operation, changed_columns (non-PII)
BEGIN;
CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid;
  v_rid text;
  v_sid uuid;
  v_row record;
BEGIN
  v_actor_id := auth.uid();
  v_row := COALESCE(NEW, OLD);
  v_rid := COALESCE(v_row.id::text, v_row.site_id::text);
  v_sid := v_row.site_id;

  INSERT INTO public.audit_log (actor_type, actor_id, action, resource_type, resource_id, site_id, payload)
  VALUES (
    CASE WHEN v_actor_id IS NOT NULL THEN 'user' ELSE 'service_role' END,
    v_actor_id,
    TG_OP,
    TG_TABLE_NAME,
    v_rid,
    v_sid,
    jsonb_build_object('table_name', TG_TABLE_NAME, 'record_id', v_rid, 'operation', TG_OP)
  );
  RETURN v_row;
END; $$;

-- provider_credentials (may not have site_id; check schema)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='provider_credentials') THEN
    DROP TRIGGER IF EXISTS audit_provider_credentials ON public.provider_credentials;
    CREATE TRIGGER audit_provider_credentials AFTER UPDATE OR DELETE ON public.provider_credentials
      FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
  END IF;
END; $$;

-- site_members
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='site_members') THEN
    DROP TRIGGER IF EXISTS audit_site_members ON public.site_members;
    CREATE TRIGGER audit_site_members AFTER UPDATE OR DELETE ON public.site_members
      FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
  END IF;
END; $$;

-- site_plans
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='site_plans') THEN
    DROP TRIGGER IF EXISTS audit_site_plans ON public.site_plans;
    CREATE TRIGGER audit_site_plans AFTER UPDATE OR DELETE ON public.site_plans
      FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
  END IF;
END; $$;

-- conversations
DROP TRIGGER IF EXISTS audit_conversations ON public.conversations;
CREATE TRIGGER audit_conversations AFTER UPDATE OR DELETE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- sales
DROP TRIGGER IF EXISTS audit_sales ON public.sales;
CREATE TRIGGER audit_sales AFTER UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

COMMIT;
