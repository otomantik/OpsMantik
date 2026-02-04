-- RPC: Paged customer invite audit for a site (admin/owner/member access).
-- Returns jsonb: { total: number, rows: [...] }

BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_invite_audit_v1(
  p_site_id uuid,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_email_query text DEFAULT NULL,
  p_outcome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_offset int;
  v_email_q text;
  v_outcome text;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'missing_site_id', ERRCODE = 'P0001';
  END IF;

  -- Auth: allow authenticated users with site access; service_role allowed for ops/scripts.
  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s0
      WHERE s0.id = p_site_id
        AND (
          s0.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s0.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));
  v_email_q := NULLIF(btrim(COALESCE(p_email_query, '')), '');
  v_outcome := NULLIF(btrim(COALESCE(p_outcome, '')), '');

  RETURN (
    WITH filtered AS (
      SELECT
        a.id,
        a.created_at,
        a.inviter_user_id,
        a.site_id,
        a.invitee_email,
        a.invitee_email_lc,
        a.role,
        a.outcome,
        a.details
      FROM public.customer_invite_audit a
      WHERE a.site_id = p_site_id
        AND (
          v_email_q IS NULL
          OR a.invitee_email_lc LIKE ('%' || lower(v_email_q) || '%')
        )
        AND (
          v_outcome IS NULL
          OR a.outcome = v_outcome
        )
    ),
    counted AS (
      SELECT COUNT(*)::int AS total FROM filtered
    ),
    page AS (
      SELECT *
      FROM filtered
      ORDER BY created_at DESC, id DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT total FROM counted),
      'limit', v_limit,
      'offset', v_offset,
      'rows', COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
    )
    FROM page
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_invite_audit_v1(uuid, int, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_invite_audit_v1(uuid, int, int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_invite_audit_v1(uuid, int, int, text, text) TO service_role;

COMMIT;

