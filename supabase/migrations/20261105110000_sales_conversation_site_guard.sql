BEGIN;

CREATE OR REPLACE FUNCTION public.sales_conversation_site_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = NEW.conversation_id
      AND c.site_id = NEW.site_id
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION USING
      MESSAGE = 'sales: conversation_id must belong to the same site as sale.site_id',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sales_conversation_site_check() IS
  'Trigger: ensures sales.conversation_id references a conversation in the same site as sales.site_id.';

DROP TRIGGER IF EXISTS sales_conversation_site_trigger ON public.sales;
CREATE TRIGGER sales_conversation_site_trigger
  BEFORE INSERT OR UPDATE OF site_id, conversation_id
  ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.sales_conversation_site_check();

COMMIT;
