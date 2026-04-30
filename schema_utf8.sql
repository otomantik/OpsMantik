


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."billing_state" AS ENUM (
    'ACCEPTED',
    'OVERAGE',
    'DEGRADED_CAPTURE',
    'RECOVERED'
);


ALTER TYPE "public"."billing_state" OWNER TO "postgres";


COMMENT ON TYPE "public"."billing_state" IS 'Revenue Kernel: billable row classification. ACCEPTED=normal ingest; OVERAGE=soft limit exceeded; DEGRADED_CAPTURE=fallback buffer; RECOVERED=recovered from buffer.';



CREATE TYPE "public"."google_action_type" AS ENUM (
    'SEND',
    'RESTATE',
    'RETRACT'
);


ALTER TYPE "public"."google_action_type" OWNER TO "postgres";


CREATE TYPE "public"."ingest_fallback_status" AS ENUM (
    'PENDING',
    'PROCESSING',
    'RECOVERED',
    'FAILED',
    'QUARANTINE'
);


ALTER TYPE "public"."ingest_fallback_status" OWNER TO "postgres";


CREATE TYPE "public"."oci_sync_method" AS ENUM (
    'api',
    'script'
);


ALTER TYPE "public"."oci_sync_method" OWNER TO "postgres";


CREATE TYPE "public"."provider_circuit_state" AS ENUM (
    'CLOSED',
    'OPEN',
    'HALF_OPEN'
);


ALTER TYPE "public"."provider_circuit_state" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_site_secrets"("p_site_id" "uuid") RETURNS TABLE("current_secret" "text", "next_secret" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  SELECT s.current_secret, s.next_secret
  FROM private.site_secrets s
  WHERE s.site_id = p_site_id;
$$;


ALTER FUNCTION "private"."get_site_secrets"("p_site_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_site_secrets_v1"("p_site_id" "uuid", "p_current_secret" "text", "p_next_secret" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
BEGIN
  IF p_site_id IS NULL THEN
    RAISE EXCEPTION 'site_id is required';
  END IF;
  IF p_current_secret IS NULL OR length(trim(p_current_secret)) < 16 THEN
    RAISE EXCEPTION 'current_secret too short';
  END IF;

  INSERT INTO private.site_secrets (site_id, current_secret, next_secret, rotated_at)
  VALUES (p_site_id, p_current_secret, p_next_secret, CASE WHEN p_next_secret IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (site_id) DO UPDATE SET
    current_secret = EXCLUDED.current_secret,
    next_secret = EXCLUDED.next_secret,
    rotated_at = CASE
      WHEN EXCLUDED.next_secret IS NULL THEN private.site_secrets.rotated_at
      ELSE now()
    END;
END;
$$;


ALTER FUNCTION "private"."set_site_secrets_v1"("p_site_id" "uuid", "p_current_secret" "text", "p_next_secret" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_conversions_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_conversions_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_entitlements_for_tier"("p_tier" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN CASE p_tier
    WHEN 'FREE' THEN jsonb_build_object(
      'tier', 'FREE',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', false,
        'google_ads_sync', false,
        'full_attribution_history', false,
        'ai_cro_insights', false,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 10,
        'history_days', 7,
        'monthly_revenue_events', 100,
        'monthly_conversion_sends', 0
      )
    )
    WHEN 'STARTER' THEN jsonb_build_object(
      'tier', 'STARTER',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', false,
        'full_attribution_history', false,
        'ai_cro_insights', false,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000,
        'history_days', 30,
        'monthly_revenue_events', 5000,
        'monthly_conversion_sends', 0
      )
    )
    WHEN 'PRO' THEN jsonb_build_object(
      'tier', 'PRO',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', false,
        'agency_portfolio', false
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000000,
        'history_days', 3650,
        'monthly_revenue_events', 25000,
        'monthly_conversion_sends', 25000
      )
    )
    WHEN 'AGENCY' THEN jsonb_build_object(
      'tier', 'AGENCY',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', false,
        'agency_portfolio', true
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', 1000000,
        'history_days', 3650,
        'monthly_revenue_events', 100000,
        'monthly_conversion_sends', 100000
      )
    )
    WHEN 'SUPER_ADMIN' THEN jsonb_build_object(
      'tier', 'SUPER_ADMIN',
      'capabilities', jsonb_build_object(
        'dashboard_live_queue', true,
        'dashboard_traffic_widget', true,
        'csv_export', true,
        'google_ads_sync', true,
        'full_attribution_history', true,
        'ai_cro_insights', true,
        'superadmin_god_mode', true,
        'agency_portfolio', true
      ),
      'limits', jsonb_build_object(
        'visible_queue_items', -1,
        'history_days', -1,
        'monthly_revenue_events', -1,
        'monthly_conversion_sends', -1
      )
    )
    ELSE public._entitlements_no_access()
  END;
END;
$$;


ALTER FUNCTION "public"."_entitlements_for_tier"("p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_entitlements_no_access"() RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'tier', 'FREE',
    'capabilities', jsonb_build_object(
      'dashboard_live_queue', false,
      'dashboard_traffic_widget', false,
      'csv_export', false,
      'google_ads_sync', false,
      'full_attribution_history', false,
      'ai_cro_insights', false,
      'superadmin_god_mode', false,
      'agency_portfolio', false
    ),
    'limits', jsonb_build_object(
      'visible_queue_items', 0,
      'history_days', 0,
      'monthly_revenue_events', 0,
      'monthly_conversion_sends', 0
    )
  );
$$;


ALTER FUNCTION "public"."_entitlements_no_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_jwt_role"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role text;
  v_claims text;
BEGIN
  v_role := current_setting('request.jwt.claim.role', true);
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL AND v_claims <> '' THEN
    RETURN (v_claims::jsonb ->> 'role');
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."_jwt_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_marketing_signals_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.opsmantik_reset_mode', true) = 'on' THEN
      RETURN OLD;
    END IF;
    IF OLD.dispatch_status = 'SENT' AND OLD.created_at < (now() - interval '60 days') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'marketing_signals: DELETE not allowed (append-only). SENT rows older than 60 days may be purged via cleanup RPC.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.site_id != OLD.site_id OR NEW.signal_type != OLD.signal_type OR NEW.google_conversion_name != OLD.google_conversion_name THEN
      RAISE EXCEPTION 'marketing_signals: signal content immutable. Only dispatch_status and google_sent_at may be updated.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_marketing_signals_append_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_provider_dispatches_no_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF current_setting('app.opsmantik_reset_mode', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'provider_dispatches: deletes not allowed (audit trail)';
END;
$$;


ALTER FUNCTION "public"."_provider_dispatches_no_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_provider_dispatches_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_provider_dispatches_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_revenue_snapshots_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF current_setting('app.opsmantik_reset_mode', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'revenue_snapshots is immutable: updates not allowed';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'revenue_snapshots is immutable: deletes not allowed';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_revenue_snapshots_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_sites_list"("search" "text" DEFAULT NULL::"text", "limit_count" integer DEFAULT 50, "offset_count" integer DEFAULT 0) RETURNS TABLE("site_id" "uuid", "name" "text", "domain" "text", "public_id" "text", "owner_user_id" "uuid", "owner_email" "text", "last_event_at" timestamp with time zone, "last_category" "text", "last_label" "text", "minutes_ago" integer, "status" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    current_month_date date;
    prev_month_date date;
BEGIN
    -- Security: Only admins can call this function
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'admin'
    ) THEN
        RAISE EXCEPTION 'not_admin' USING MESSAGE = 'Only admins can call this function';
    END IF;

    -- Calculate month boundaries for partition queries
    current_month_date := DATE_TRUNC('month', CURRENT_DATE);
    prev_month_date := current_month_date - INTERVAL '1 month';

    -- Single query strategy:
    -- 1. Get all sites (with optional search filter)
    -- 2. UNION events from current and previous month partitions
    -- 3. Use DISTINCT ON to get latest event per site
    -- 4. Calculate status based on 10-minute threshold
    RETURN QUERY
    WITH site_base AS (
        SELECT 
            s.id,
            s.name,
            s.domain,
            s.public_id,
            s.user_id,
            s.created_at
        FROM public.sites s
        WHERE (search IS NULL OR search = '' OR 
               s.name ILIKE '%' || search || '%' OR
               s.domain ILIKE '%' || search || '%' OR
               s.public_id ILIKE '%' || search || '%')
        ORDER BY s.created_at DESC
        LIMIT limit_count
        OFFSET offset_count
    ),
    all_events AS (
        -- Get events from current month partition
        SELECT 
            s.id as site_id,
            e.created_at as event_created_at,
            e.event_category,
            e.event_label
        FROM site_base s
        INNER JOIN public.sessions sess ON sess.site_id = s.id 
            AND sess.created_month = current_month_date
        INNER JOIN public.events e ON e.session_id = sess.id 
            AND e.session_month = current_month_date
        
        UNION ALL
        
        -- Get events from previous month partition
        SELECT 
            s.id as site_id,
            e.created_at as event_created_at,
            e.event_category,
            e.event_label
        FROM site_base s
        INNER JOIN public.sessions sess ON sess.site_id = s.id 
            AND sess.created_month = prev_month_date
        INNER JOIN public.events e ON e.session_id = sess.id 
            AND e.session_month = prev_month_date
    ),
    latest_events AS (
        -- Get most recent event per site
        SELECT DISTINCT ON (site_id)
            site_id,
            event_created_at,
            event_category,
            event_label
        FROM all_events
        ORDER BY site_id, event_created_at DESC
    )
    SELECT 
        sb.id as site_id,
        sb.name,
        sb.domain,
        sb.public_id,
        sb.user_id as owner_user_id,
        -- Try to get email from auth.users (may be null if RLS blocks)
        (SELECT email FROM auth.users WHERE id = sb.user_id LIMIT 1) as owner_email,
        le.event_created_at as last_event_at,
        le.event_category as last_category,
        le.event_label as last_label,
        CASE 
            WHEN le.event_created_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (NOW() - le.event_created_at)) / 60::int
            ELSE NULL
        END as minutes_ago,
        CASE
            WHEN le.event_created_at IS NOT NULL AND 
                 EXTRACT(EPOCH FROM (NOW() - le.event_created_at)) / 60 <= 10 THEN
                'RECEIVING'
            ELSE
                'NO_TRAFFIC'
        END as status
    FROM site_base sb
    LEFT JOIN latest_events le ON le.site_id = sb.id
    ORDER BY sb.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) IS 'Admin-only RPC to list all sites with status. Returns RECEIVING if last event within 10 minutes, else NO_TRAFFIC. Single query eliminates N+1.';



CREATE OR REPLACE FUNCTION "public"."ai_pipeline_gate_checks"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'pg_catalog'
    AS $$
DECLARE
  v_pg_net boolean;
  v_trigger boolean;
  v_api_keys int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO v_pg_net;
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'calls' AND t.tgname = 'calls_notify_hunter_ai'
  ) INTO v_trigger;
  SELECT count(*) INTO v_api_keys
  FROM private.api_keys
  WHERE key_name IN ('project_url', 'service_role_key');

  RETURN jsonb_build_object(
    'pg_net_enabled', v_pg_net,
    'trigger_exists', v_trigger,
    'api_keys_configured', (v_api_keys = 2)
  );
END;
$$;


ALTER FUNCTION "public"."ai_pipeline_gate_checks"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ai_pipeline_gate_checks"() IS 'Diagnostic: AI pipeline gate (pg_net, trigger, api_keys). No secrets. Used by ai-pipeline-gate smoke.';



CREATE OR REPLACE FUNCTION "public"."analyze_gumus_alanlar_funnel"("target_site_id" "uuid") RETURNS TABLE("peak_call_hour" integer, "avg_gclid_session_duration" numeric, "total_calls" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH call_metrics AS (
        -- En ├ğok ├ğa─şr─▒ niyetinin oldu─şu saati bul (UTC+3)
        SELECT 
            EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul'))::INT as call_hour,
            COUNT(*) as call_count
        FROM events
        WHERE site_id = target_site_id 
          AND event_category = 'conversion' 
          AND event_action IN ('phone_click', 'whatsapp', 'call_click')
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 1
    ),
    ad_metrics AS (
        -- GCLID i├ğeren oturumlar─▒n ortalama s├╝resini sessions tablosundan al
        SELECT 
            AVG(total_duration_sec) as avg_duration
        FROM sessions
        WHERE site_id = target_site_id 
          AND (gclid IS NOT NULL OR wbraid IS NOT NULL OR gbraid IS NOT NULL)
          AND total_duration_sec > 0
    )
    SELECT 
        COALESCE(cm.call_hour, 0),
        ROUND(COALESCE(am.avg_duration, 0)::numeric, 2),
        COALESCE(cm.call_count, 0)
    FROM ad_metrics am
    LEFT JOIN call_metrics cm ON true;
END;
$$;


ALTER FUNCTION "public"."analyze_gumus_alanlar_funnel"("target_site_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anonymize_consent_less_data"("p_days" integer DEFAULT 90) RETURNS TABLE("sessions_affected" bigint, "events_affected" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_sessions bigint := 0;
  v_events bigint := 0;
BEGIN
  v_cutoff := now() - (COALESCE(NULLIF(p_days, 0), 90) || ' days')::interval;

  WITH upds AS (
    UPDATE public.sessions SET
      ip_address = NULL, entry_page = NULL, exit_page = NULL,
      gclid = NULL, wbraid = NULL, gbraid = NULL, fingerprint = NULL,
      ai_summary = NULL, ai_tags = NULL, user_journey_path = NULL
    WHERE consent_at IS NULL AND (consent_scopes IS NULL OR consent_scopes = '{}')
      AND created_at < v_cutoff
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_sessions FROM upds;

  WITH upds AS (
    UPDATE public.events SET metadata = '{}'
    WHERE consent_at IS NULL AND (consent_scopes IS NULL OR consent_scopes = '{}')
      AND created_at < v_cutoff
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_events FROM upds;

  RETURN QUERY SELECT v_sessions, v_events;
END; $$;


ALTER FUNCTION "public"."anonymize_consent_less_data"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."append_causal_dna_ledger"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_causal_dna" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'append_causal_dna_ledger may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_aggregate_type NOT IN ('conversion', 'signal', 'pv') THEN
    RAISE EXCEPTION 'aggregate_type must be conversion, signal, or pv' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.causal_dna_ledger (site_id, aggregate_type, aggregate_id, causal_dna)
  VALUES (p_site_id, p_aggregate_type, p_aggregate_id, COALESCE(p_causal_dna, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."append_causal_dna_ledger"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_causal_dna" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_causal_dna_ledger"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_causal_dna" "jsonb") IS 'Singularity: Append one causal_dna to ledger for Merkle heartbeat. Returns ledger id.';



CREATE OR REPLACE FUNCTION "public"."append_manual_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone DEFAULT "now"(), "p_clear_errors" boolean DEFAULT false, "p_error_code" "text" DEFAULT NULL::"text", "p_error_category" "text" DEFAULT NULL::"text", "p_reason" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
  v_clear_fields text[] := ARRAY[]::text[];
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_manual_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('QUEUED', 'FAILED') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  v_clear_fields := ARRAY['claimed_at', 'next_retry_at'];
  IF p_clear_errors THEN
    v_clear_fields := v_clear_fields || ARRAY['last_error', 'provider_error_code', 'provider_error_category'];
  END IF;

  IF p_new_status = 'FAILED' THEN
    v_payload := jsonb_strip_nulls(
      jsonb_build_object(
        'last_error', left(COALESCE(p_reason, 'MANUALLY_MARKED_FAILED'), 1024),
        'provider_error_code', left(COALESCE(p_error_code, 'MANUAL_FAIL'), 64),
        'provider_error_category', COALESCE(p_error_category, 'PERMANENT')
      )
    );
  ELSE
    v_payload := '{}'::jsonb;
  END IF;

  IF array_length(v_clear_fields, 1) IS NOT NULL AND array_length(v_clear_fields, 1) > 0 THEN
    v_payload := v_payload || jsonb_build_object('clear_fields', to_jsonb(v_clear_fields));
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'MANUAL',
    p_created_at,
    NULLIF(v_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_manual_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_manual_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") IS 'Phase 23C manual queue mutation path. Actor is hardcoded to MANUAL and snapshot apply happens in the same transaction.';



CREATE OR REPLACE FUNCTION "public"."append_rpc_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_rpc_claim_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    'PROCESSING',
    'RPC_CLAIM',
    p_claimed_at,
    jsonb_build_object('claimed_at', p_claimed_at),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_rpc_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_rpc_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) IS 'Phase 23B atomic batch claim append/apply RPC. Actor is hardcoded to RPC_CLAIM, current typed scores are sealed into the ledger row, and snapshot apply happens in the same transaction.';



CREATE OR REPLACE FUNCTION "public"."append_script_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_script_claim_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    'PROCESSING',
    'SCRIPT',
    p_claimed_at,
    jsonb_build_object(
      'claimed_at', p_claimed_at,
      'attempt_count', q.attempt_count + 1
    ),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  WHERE q.status IN ('QUEUED', 'RETRY')
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_script_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_script_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) IS 'Phase 23C script export claim path. Actor is hardcoded to SCRIPT, attempt_count increments in the ledger payload, and snapshot apply happens in the same transaction.';



CREATE OR REPLACE FUNCTION "public"."append_script_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone DEFAULT "now"(), "p_error_payload" "jsonb" DEFAULT NULL::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_script_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED', 'VOIDED_BY_REVERSAL') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'SCRIPT',
    p_created_at,
    p_error_payload,
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_script_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_script_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") IS 'Phase 23C generic script-owned batch append/apply path for terminal or retry transitions. Caller provides a shared error_payload JSONB including clear_fields metadata.';



CREATE OR REPLACE FUNCTION "public"."append_sweeper_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone DEFAULT "now"(), "p_last_error" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_sweeper_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'QUEUED', 'COMPLETED_UNVERIFIED') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  IF p_new_status = 'RETRY' THEN
    v_payload := jsonb_build_object('next_retry_at', NULL, 'clear_fields', to_jsonb(ARRAY['next_retry_at']::text[]));
  ELSIF p_new_status = 'FAILED' AND p_last_error IS NOT NULL THEN
    v_payload := jsonb_build_object('last_error', left(p_last_error, 1024));
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'SWEEPER',
    p_created_at,
    NULLIF(v_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_sweeper_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_sweeper_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text") IS 'Phase 23C sweeper-owned batch append/apply path for zombie recovery and cleanup transitions.';



CREATE OR REPLACE FUNCTION "public"."append_worker_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone DEFAULT "now"(), "p_last_error" "text" DEFAULT NULL::"text", "p_error_code" "text" DEFAULT NULL::"text", "p_error_category" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_worker_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'WORKER',
    p_created_at,
    NULLIF(
      jsonb_strip_nulls(
        jsonb_build_object(
          'last_error', p_last_error,
          'provider_error_code', p_error_code,
          'provider_error_category', p_error_category
        )
      ),
      '{}'::jsonb
    ),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_worker_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text", "p_error_code" "text", "p_error_category" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_worker_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text", "p_error_code" "text", "p_error_category" "text") IS 'Phase 23C generic worker-owned batch append/apply path for terminal or retry transitions with actor hardcoded to WORKER.';



CREATE OR REPLACE FUNCTION "public"."append_worker_transition_batch_v2"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone DEFAULT "now"(), "p_error_payload" "jsonb" DEFAULT NULL::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_worker_transition_batch_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED', 'VOIDED_BY_REVERSAL') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'WORKER',
    p_created_at,
    NULLIF(p_error_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."append_worker_transition_batch_v2"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."append_worker_transition_batch_v2"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") IS 'Phase 23C generic worker-owned batch append/apply path with full JSONB snapshot payload support.';



CREATE OR REPLACE FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_type" "text" DEFAULT 'user'::"text", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_site_id uuid;
  v_prev_status text;
  v_new_status text;
  v_now timestamptz := now();
  v_actor_type text;
  v_actor_id uuid;
  v_revert jsonb;
  v_updated public.calls%ROWTYPE;
  v_sale_amount numeric;
  v_currency text;
  v_lead_score integer;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_action_type IS NULL OR btrim(p_action_type) = '' THEN
    RAISE EXCEPTION 'action_type_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type NOT IN ('user','system') THEN
    RAISE EXCEPTION 'invalid_actor_type' USING ERRCODE = '22023';
  END IF;

  -- Prevent actor spoofing: user actor_id must be auth.uid().
  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    -- system actor: allow explicit actor_id only if provided; otherwise NULL.
    v_actor_id := p_actor_id;
  END IF;

  -- Lock calls row (transaction-safe)
  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  v_site_id := v_call.site_id;
  v_prev_status := v_call.status;
  v_revert := to_jsonb(v_call);

  -- Parse commonly-used payload fields safely
  v_sale_amount := NULL;
  IF (p_payload ? 'sale_amount') THEN
    BEGIN
      v_sale_amount := NULLIF(btrim((p_payload->>'sale_amount')), '')::numeric;
    EXCEPTION WHEN others THEN
      v_sale_amount := NULL;
    END;
  END IF;

  v_currency := NULLIF(btrim(COALESCE(p_payload->>'currency', '')), '');
  v_lead_score := NULL;
  IF (p_payload ? 'lead_score') THEN
    BEGIN
      v_lead_score := NULLIF(btrim((p_payload->>'lead_score')), '')::int;
    EXCEPTION WHEN others THEN
      v_lead_score := NULL;
    END;
  END IF;

  -- Apply action (only touches allowed columns; enforced by calls_enforce_update_columns trigger)
  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    v_new_status := 'confirmed';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = v_sale_amount,
      currency = COALESCE(v_currency, public.calls.currency),
      confirmed_at = v_now,
      confirmed_by = CASE WHEN v_actor_type = 'user' THEN v_actor_id ELSE NULL END,
      cancelled_at = NULL,
      lead_score = COALESCE(v_lead_score, public.calls.lead_score),
      oci_status = 'sealed',
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('junk','ai_junk') THEN
    v_new_status := 'junk';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = NULL,
      estimated_value = NULL,
      confirmed_at = NULL,
      confirmed_by = NULL,
      cancelled_at = NULL,
      lead_score = COALESCE(v_lead_score, public.calls.lead_score),
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('cancel','cancelled') THEN
    v_new_status := 'cancelled';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = NULL,
      estimated_value = NULL,
      confirmed_at = NULL,
      confirmed_by = NULL,
      cancelled_at = v_now,
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('restore','undo_restore','intent') THEN
    v_new_status := 'intent';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = NULL,
      estimated_value = NULL,
      confirmed_at = NULL,
      confirmed_by = NULL,
      cancelled_at = NULL,
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSE
    RAISE EXCEPTION 'unknown_action_type: %', p_action_type USING ERRCODE = '22023';
  END IF;

  -- Insert audit log row (append-only)
  INSERT INTO public.call_actions (
    call_id,
    site_id,
    action_type,
    actor_type,
    actor_id,
    previous_status,
    new_status,
    revert_snapshot,
    metadata
  ) VALUES (
    p_call_id,
    v_site_id,
    lower(p_action_type),
    v_actor_type,
    v_actor_id,
    v_prev_status,
    v_new_status,
    v_revert,
    jsonb_build_object(
      'payload', COALESCE(p_payload, '{}'::jsonb),
      'meta', COALESCE(p_metadata, '{}'::jsonb)
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;


ALTER FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") IS 'Event-Sourcing Lite: applies a state transition to calls (RLS) and writes an audit record to call_actions with revert_snapshot for safe Undo.';



CREATE OR REPLACE FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_type" "text" DEFAULT 'user'::"text", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_version" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_site_id uuid;
  v_prev_status text;
  v_new_status text;
  v_now timestamptz := now();
  v_actor_type text;
  v_actor_id uuid;
  v_revert jsonb;
  v_updated public.calls%ROWTYPE;
  v_sale_amount numeric;
  v_currency text;
  v_lead_score integer;
  v_oci_status text;
  v_has_caller_phone boolean;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    v_actor_type := 'system';
    v_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'concurrency_conflict: version mismatch' USING ERRCODE = 'P0002';
  END IF;

  v_site_id := v_call.site_id;
  v_prev_status := v_call.status;
  v_revert := to_jsonb(v_call);

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    IF v_prev_status IN ('junk', 'cancelled') THEN
      RAISE EXCEPTION 'cannot_seal_from_junk_or_cancelled' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF (p_payload ? 'sale_amount') THEN
    v_sale_amount := (p_payload->>'sale_amount')::numeric;
  END IF;
  v_currency := COALESCE(p_payload->>'currency', v_call.currency);
  IF (p_payload ? 'lead_score') THEN
    v_lead_score := (p_payload->>'lead_score')::int;
  END IF;
  IF (p_payload ? 'oci_status') THEN
    v_oci_status := p_payload->>'oci_status';
  END IF;

  v_has_caller_phone := (p_payload ? 'caller_phone_raw') OR (p_payload ? 'caller_phone_e164') OR (p_payload ? 'caller_phone_hash_sha256');

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    v_new_status := 'confirmed';
    IF v_has_caller_phone THEN
      PERFORM set_config('app.allow_caller_phone', '1', true);
    END IF;

    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = v_sale_amount,
      currency = v_currency,
      confirmed_at = v_now,
      confirmed_by = CASE WHEN v_actor_type = 'user' THEN v_actor_id ELSE NULL END,
      version = version + 1,
      lead_score = COALESCE(v_lead_score, lead_score),
      oci_status = COALESCE(v_oci_status, 'sealed'),
      oci_status_updated_at = v_now,
      caller_phone_raw = CASE WHEN (p_payload ? 'caller_phone_raw') THEN NULLIF(btrim(p_payload->>'caller_phone_raw'), '') ELSE caller_phone_raw END,
      caller_phone_e164 = CASE WHEN (p_payload ? 'caller_phone_e164') THEN NULLIF(btrim(p_payload->>'caller_phone_e164'), '') ELSE caller_phone_e164 END,
      caller_phone_hash_sha256 = CASE WHEN (p_payload ? 'caller_phone_hash_sha256') THEN NULLIF(btrim(p_payload->>'caller_phone_hash_sha256'), '') ELSE caller_phone_hash_sha256 END,
      phone_source_type = CASE WHEN v_has_caller_phone THEN 'operator_verified' ELSE phone_source_type END,
      sale_occurred_at = CASE WHEN (p_payload ? 'sale_occurred_at') THEN (p_payload->>'sale_occurred_at')::timestamptz ELSE sale_occurred_at END,
      sale_source_timestamp = CASE WHEN (p_payload ? 'sale_source_timestamp') THEN NULLIF(btrim(p_payload->>'sale_source_timestamp'), '')::timestamptz ELSE sale_source_timestamp END,
      sale_time_confidence = CASE WHEN (p_payload ? 'sale_time_confidence') THEN NULLIF(btrim(p_payload->>'sale_time_confidence'), '') ELSE sale_time_confidence END,
      sale_occurred_at_source = CASE WHEN (p_payload ? 'sale_occurred_at_source') THEN NULLIF(btrim(p_payload->>'sale_occurred_at_source'), '') ELSE sale_occurred_at_source END,
      sale_entry_reason = CASE WHEN (p_payload ? 'sale_entry_reason') THEN NULLIF(btrim(p_payload->>'sale_entry_reason'), '') ELSE sale_entry_reason END,
      sale_is_backdated = CASE WHEN (p_payload ? 'sale_is_backdated') THEN COALESCE((p_payload->>'sale_is_backdated')::boolean, false) ELSE sale_is_backdated END,
      sale_backdated_seconds = CASE WHEN (p_payload ? 'sale_backdated_seconds') THEN NULLIF(btrim(p_payload->>'sale_backdated_seconds'), '')::integer ELSE sale_backdated_seconds END,
      sale_review_status = CASE WHEN (p_payload ? 'sale_review_status') THEN NULLIF(btrim(p_payload->>'sale_review_status'), '') ELSE sale_review_status END,
      sale_review_requested_at = CASE WHEN (p_payload ? 'sale_review_requested_at') THEN NULLIF(btrim(p_payload->>'sale_review_requested_at'), '')::timestamptz ELSE sale_review_requested_at END
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

    IF COALESCE(v_updated.oci_status, '') NOT IN ('skipped', 'pending_approval') THEN
      INSERT INTO public.outbox_events (event_type, payload, call_id, site_id, status)
      VALUES (
        'IntentSealed',
        jsonb_build_object(
          'call_id', p_call_id,
          'site_id', v_site_id,
          'lead_score', v_updated.lead_score,
          'confirmed_at', v_updated.confirmed_at,
          'created_at', v_updated.created_at,
          'sale_amount', v_updated.sale_amount,
          'currency', COALESCE(v_currency, v_updated.currency),
          'oci_status', v_updated.oci_status,
          'sale_occurred_at', v_updated.sale_occurred_at,
          'sale_source_timestamp', v_updated.sale_source_timestamp,
          'sale_time_confidence', v_updated.sale_time_confidence,
          'sale_occurred_at_source', v_updated.sale_occurred_at_source,
          'sale_entry_reason', v_updated.sale_entry_reason
        ),
        p_call_id,
        v_site_id,
        'PENDING'
      );
    END IF;

  ELSIF lower(p_action_type) IN ('junk','ai_junk') THEN
    v_new_status := 'junk';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = NULL,
      oci_status = COALESCE(v_oci_status, NULL),
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('cancel','cancelled') THEN
    v_new_status := 'cancelled';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = v_now,
      oci_status = COALESCE(v_oci_status, NULL),
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSE
    UPDATE public.calls
    SET
      status = COALESCE(v_new_status, status),
      version = version + 1,
      updated_at = v_now,
      oci_status = COALESCE(v_oci_status, oci_status)
    WHERE id = p_call_id
    RETURNING * INTO v_updated;
  END IF;

  INSERT INTO public.call_actions (call_id, site_id, action_type, actor_type, actor_id, previous_status, new_status, revert_snapshot, metadata)
  VALUES (p_call_id, v_site_id, lower(p_action_type), v_actor_type, v_actor_id, v_prev_status, v_new_status, v_revert, p_metadata);

  RETURN to_jsonb(v_updated);
END;
$$;


ALTER FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb", "p_version" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb", "p_version" integer) IS 'Seal/confirm branch persists caller phone and sale governance metadata; non-user actors are normalized to system before call_actions append.';



CREATE OR REPLACE FUNCTION "public"."apply_oci_queue_transition_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF current_setting('opsmantik.skip_snapshot_trigger', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_snapshot_batch(ARRAY[NEW.queue_id]);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."apply_oci_queue_transition_snapshot"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_oci_queue_transition_snapshot"() IS 'Phase 23B compat bridge: old paths still rely on trigger-driven snapshot apply, while batch paths can skip it via session-local GUC.';



CREATE OR REPLACE FUNCTION "public"."apply_snapshot_batch"("p_queue_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_invalid_transition_id uuid;
  v_invalid_queue_id uuid;
  v_invalid_clear_field text;
  v_noop_transition_id uuid;
  v_noop_queue_id uuid;
  v_updated integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'apply_snapshot_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM 1
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(v_queue_ids)
  ORDER BY q.id
  FOR UPDATE;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.actor,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_invalid_transition_id, v_invalid_queue_id
  FROM latest AS l
  WHERE l.error_payload IS NOT NULL
    AND jsonb_typeof(l.error_payload) <> 'object'
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload must be a JSON object or null for transition % queue %', v_invalid_transition_id, v_invalid_queue_id;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.error_payload
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_invalid_transition_id, v_invalid_queue_id
  FROM latest AS l
  WHERE l.error_payload ? 'clear_fields'
    AND jsonb_typeof(l.error_payload->'clear_fields') <> 'array'
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL
     AND v_invalid_queue_id IS NOT NULL THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload.clear_fields must be an array for transition % queue %', v_invalid_transition_id, v_invalid_queue_id;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      public.queue_transition_clear_fields(t.error_payload) AS clear_fields
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id, field_name
  INTO v_invalid_transition_id, v_invalid_queue_id, v_invalid_clear_field
  FROM latest AS l
  CROSS JOIN LATERAL unnest(l.clear_fields) AS field_name
  WHERE field_name NOT IN (
    'last_error',
    'provider_error_code',
    'provider_error_category',
    'next_retry_at',
    'uploaded_at',
    'claimed_at',
    'provider_request_id',
    'provider_ref'
  )
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported clear_fields value in oci_queue_transitions.error_payload for transition % queue %: %',
      v_invalid_transition_id, v_invalid_queue_id, v_invalid_clear_field;
  END IF;

  PERFORM public.log_oci_payload_validation_event(
    latest.actor,
    latest.queue_id,
    q.site_id,
    latest.new_status,
    latest.error_payload,
    public.oci_transition_payload_unknown_keys(latest.error_payload),
    public.oci_transition_payload_missing_required(latest.new_status, latest.error_payload),
    'phase23b_warning_mode'
  )
  FROM (
    SELECT DISTINCT ON (t.queue_id)
      t.queue_id,
      t.actor,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.id
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ) AS latest
  JOIN public.offline_conversion_queue AS q
    ON q.id = latest.queue_id
  WHERE COALESCE(array_length(public.oci_transition_payload_unknown_keys(latest.error_payload), 1), 0) > 0
     OR COALESCE(array_length(public.oci_transition_payload_missing_required(latest.new_status, latest.error_payload), 1), 0) > 0;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_noop_transition_id, v_noop_queue_id
  FROM latest AS l
  JOIN public.offline_conversion_queue AS q
    ON q.id = l.queue_id
  WHERE l.new_status = q.status
    AND NOT public.queue_transition_payload_has_meaningful_patch(l.error_payload)
  LIMIT 1;

  IF v_noop_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOOP_TRANSITION: transition % queue % already in status %',
      v_noop_transition_id, v_noop_queue_id,
      (SELECT q.status FROM public.offline_conversion_queue AS q WHERE q.id = v_noop_queue_id);
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ),
  prepared AS (
    SELECT
      l.*,
      public.queue_transition_clear_fields(l.error_payload) AS clear_fields
    FROM latest AS l
  )
  UPDATE public.offline_conversion_queue AS q
  SET
    status = p.new_status,
    updated_at = p.created_at,
    last_error = CASE
      WHEN 'last_error' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'last_error' AND p.error_payload->>'last_error' IS NOT NULL THEN p.error_payload->>'last_error'
      ELSE q.last_error
    END,
    provider_error_code = CASE
      WHEN 'provider_error_code' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_error_code' AND p.error_payload->>'provider_error_code' IS NOT NULL THEN p.error_payload->>'provider_error_code'
      ELSE q.provider_error_code
    END,
    provider_error_category = CASE
      WHEN 'provider_error_category' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_error_category' AND p.error_payload->>'provider_error_category' IS NOT NULL THEN p.error_payload->>'provider_error_category'
      ELSE q.provider_error_category
    END,
    attempt_count = CASE
      WHEN p.error_payload ? 'attempt_count' AND p.error_payload->>'attempt_count' IS NOT NULL THEN (p.error_payload->>'attempt_count')::int
      ELSE q.attempt_count
    END,
    retry_count = CASE
      WHEN p.error_payload ? 'retry_count' AND p.error_payload->>'retry_count' IS NOT NULL THEN (p.error_payload->>'retry_count')::int
      ELSE q.retry_count
    END,
    next_retry_at = CASE
      WHEN 'next_retry_at' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'next_retry_at' AND p.error_payload->>'next_retry_at' IS NOT NULL THEN (p.error_payload->>'next_retry_at')::timestamptz
      ELSE q.next_retry_at
    END,
    uploaded_at = CASE
      WHEN 'uploaded_at' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'uploaded_at' AND p.error_payload->>'uploaded_at' IS NOT NULL THEN (p.error_payload->>'uploaded_at')::timestamptz
      ELSE q.uploaded_at
    END,
    claimed_at = CASE
      WHEN 'claimed_at' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'claimed_at' AND p.error_payload->>'claimed_at' IS NOT NULL THEN (p.error_payload->>'claimed_at')::timestamptz
      ELSE q.claimed_at
    END,
    provider_request_id = CASE
      WHEN 'provider_request_id' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_request_id' AND p.error_payload->>'provider_request_id' IS NOT NULL THEN p.error_payload->>'provider_request_id'
      ELSE q.provider_request_id
    END,
    provider_ref = CASE
      WHEN 'provider_ref' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_ref' AND p.error_payload->>'provider_ref' IS NOT NULL THEN p.error_payload->>'provider_ref'
      ELSE q.provider_ref
    END,
    brain_score = COALESCE(p.brain_score, q.brain_score),
    match_score = COALESCE(p.match_score, q.match_score),
    queue_priority = COALESCE(p.queue_priority, q.queue_priority),
    score_version = COALESCE(p.score_version, q.score_version),
    score_flags = COALESCE(p.score_flags, q.score_flags),
    score_explain_jsonb = COALESCE(p.score_explain_jsonb, q.score_explain_jsonb)
  FROM prepared AS p
  WHERE q.id = p.queue_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."apply_snapshot_batch"("p_queue_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_snapshot_batch"("p_queue_ids" "uuid"[]) IS 'Phase 23B set-based snapshot application for the latest transition per queue_id with warning-mode payload telemetry.';



CREATE OR REPLACE FUNCTION "public"."archive_failed_conversions_batch"("p_days_old" integer DEFAULT 30, "p_limit" integer DEFAULT 5000) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_archived int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'archive_failed_conversions_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_archive AS (
    SELECT q.id, q.site_id, q.provider_key, q.payload,
           jsonb_build_object(
             'conversion_time', q.conversion_time,
             'value_cents', q.value_cents,
             'currency', q.currency,
             'gclid', q.gclid,
             'wbraid', q.wbraid,
             'gbraid', q.gbraid,
             'call_id', q.call_id,
             'sale_id', q.sale_id,
             'order_id', q.payload->>'order_id'
           ) AS queue_snapshot,
           jsonb_build_object(
             'retry_count', q.retry_count,
             'attempt_count', q.attempt_count,
             'last_error', q.last_error,
             'provider_error_code', q.provider_error_code,
             'provider_error_category', q.provider_error_category,
             'created_at', q.created_at,
             'updated_at', q.updated_at,
             'failed_at', q.updated_at
           ) AS failure_summary
    FROM public.offline_conversion_queue q
    WHERE q.status = 'FAILED'
      AND q.updated_at < v_cutoff
    ORDER BY q.updated_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
    FOR UPDATE SKIP LOCKED
  ),
  inserted AS (
    INSERT INTO public.offline_conversion_tombstones (source_queue_id, site_id, provider_key, payload, queue_snapshot, failure_summary)
    SELECT id, site_id, provider_key, payload, queue_snapshot, failure_summary FROM to_archive
    ON CONFLICT (source_queue_id) DO NOTHING
    RETURNING source_queue_id
  ),
  deleted AS (
    DELETE FROM public.offline_conversion_queue
    WHERE id IN (SELECT source_queue_id FROM inserted)
    RETURNING id
  )
  SELECT count(*)::int INTO v_archived FROM deleted;

  IF v_archived > 0 THEN
    EXECUTE 'ANALYZE public.offline_conversion_queue';
  END IF;

  RETURN v_archived;
END;
$$;


ALTER FUNCTION "public"."archive_failed_conversions_batch"("p_days_old" integer, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."archive_failed_conversions_batch"("p_days_old" integer, "p_limit" integer) IS 'Archive FAILED conversions older than p_days_old to tombstones. FOR UPDATE SKIP LOCKED. ANALYZE on success. service_role only.';



CREATE OR REPLACE FUNCTION "public"."assert_latest_ledger_matches_snapshot"("p_queue_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_mismatch record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'assert_latest_ledger_matches_snapshot may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ),
  prepared AS (
    SELECT
      l.*,
      public.queue_transition_clear_fields(l.error_payload) AS clear_fields
    FROM latest AS l
  ),
  comparison AS (
    SELECT
      q.id AS queue_id,
      p.id AS transition_id,
      CASE
        WHEN q.status IS DISTINCT FROM p.new_status THEN 'status'
        WHEN 'last_error' = ANY(p.clear_fields) AND q.last_error IS NOT NULL THEN 'last_error'
        WHEN p.error_payload ? 'last_error' AND p.error_payload->>'last_error' IS NOT NULL AND q.last_error IS DISTINCT FROM p.error_payload->>'last_error' THEN 'last_error'
        WHEN 'provider_error_code' = ANY(p.clear_fields) AND q.provider_error_code IS NOT NULL THEN 'provider_error_code'
        WHEN p.error_payload ? 'provider_error_code' AND p.error_payload->>'provider_error_code' IS NOT NULL AND q.provider_error_code IS DISTINCT FROM p.error_payload->>'provider_error_code' THEN 'provider_error_code'
        WHEN 'provider_error_category' = ANY(p.clear_fields) AND q.provider_error_category IS NOT NULL THEN 'provider_error_category'
        WHEN p.error_payload ? 'provider_error_category' AND p.error_payload->>'provider_error_category' IS NOT NULL AND q.provider_error_category IS DISTINCT FROM p.error_payload->>'provider_error_category' THEN 'provider_error_category'
        WHEN p.error_payload ? 'attempt_count' AND p.error_payload->>'attempt_count' IS NOT NULL AND q.attempt_count IS DISTINCT FROM (p.error_payload->>'attempt_count')::int THEN 'attempt_count'
        WHEN p.error_payload ? 'retry_count' AND p.error_payload->>'retry_count' IS NOT NULL AND q.retry_count IS DISTINCT FROM (p.error_payload->>'retry_count')::int THEN 'retry_count'
        WHEN 'next_retry_at' = ANY(p.clear_fields) AND q.next_retry_at IS NOT NULL THEN 'next_retry_at'
        WHEN p.error_payload ? 'next_retry_at' AND p.error_payload->>'next_retry_at' IS NOT NULL AND q.next_retry_at IS DISTINCT FROM (p.error_payload->>'next_retry_at')::timestamptz THEN 'next_retry_at'
        WHEN 'uploaded_at' = ANY(p.clear_fields) AND q.uploaded_at IS NOT NULL THEN 'uploaded_at'
        WHEN p.error_payload ? 'uploaded_at' AND p.error_payload->>'uploaded_at' IS NOT NULL AND q.uploaded_at IS DISTINCT FROM (p.error_payload->>'uploaded_at')::timestamptz THEN 'uploaded_at'
        WHEN 'claimed_at' = ANY(p.clear_fields) AND q.claimed_at IS NOT NULL THEN 'claimed_at'
        WHEN p.error_payload ? 'claimed_at' AND p.error_payload->>'claimed_at' IS NOT NULL AND q.claimed_at IS DISTINCT FROM (p.error_payload->>'claimed_at')::timestamptz THEN 'claimed_at'
        WHEN 'provider_request_id' = ANY(p.clear_fields) AND q.provider_request_id IS NOT NULL THEN 'provider_request_id'
        WHEN p.error_payload ? 'provider_request_id' AND p.error_payload->>'provider_request_id' IS NOT NULL AND q.provider_request_id IS DISTINCT FROM p.error_payload->>'provider_request_id' THEN 'provider_request_id'
        WHEN 'provider_ref' = ANY(p.clear_fields) AND q.provider_ref IS NOT NULL THEN 'provider_ref'
        WHEN p.error_payload ? 'provider_ref' AND p.error_payload->>'provider_ref' IS NOT NULL AND q.provider_ref IS DISTINCT FROM p.error_payload->>'provider_ref' THEN 'provider_ref'
        WHEN p.brain_score IS NOT NULL AND q.brain_score IS DISTINCT FROM p.brain_score THEN 'brain_score'
        WHEN p.match_score IS NOT NULL AND q.match_score IS DISTINCT FROM p.match_score THEN 'match_score'
        WHEN p.queue_priority IS NOT NULL AND q.queue_priority IS DISTINCT FROM p.queue_priority THEN 'queue_priority'
        WHEN p.score_version IS NOT NULL AND q.score_version IS DISTINCT FROM p.score_version THEN 'score_version'
        WHEN p.score_flags IS NOT NULL AND q.score_flags IS DISTINCT FROM p.score_flags THEN 'score_flags'
        WHEN p.score_explain_jsonb IS NOT NULL AND q.score_explain_jsonb IS DISTINCT FROM p.score_explain_jsonb THEN 'score_explain_jsonb'
        ELSE NULL
      END AS mismatch_field
    FROM prepared AS p
    JOIN public.offline_conversion_queue AS q
      ON q.id = p.queue_id
  )
  SELECT *
  INTO v_mismatch
  FROM comparison
  WHERE mismatch_field IS NOT NULL
  ORDER BY queue_id
  LIMIT 1;

  IF v_mismatch.queue_id IS NOT NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_ASSERT_FAILED: queue % transition % mismatch on field %',
      v_mismatch.queue_id, v_mismatch.transition_id, v_mismatch.mismatch_field;
  END IF;
END;
$$;


ALTER FUNCTION "public"."assert_latest_ledger_matches_snapshot"("p_queue_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assert_latest_ledger_matches_snapshot"("p_queue_ids" "uuid"[]) IS 'Phase 23B runtime guard that asserts the latest ledger row matches the queue snapshot for selected queue ids.';



CREATE OR REPLACE FUNCTION "public"."assign_offline_conversion_queue_external_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.external_id := public.compute_offline_conversion_external_id(
    NEW.provider_key,
    NEW.action,
    NEW.sale_id,
    NEW.call_id,
    NEW.session_id
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assign_offline_conversion_queue_external_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_offline_conversion_queue_external_id"() IS 'Before-write trigger that keeps offline_conversion_queue.external_id authoritative at the DB boundary.';



CREATE OR REPLACE FUNCTION "public"."audit_table_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_actor_id uuid;
  v_rid text;
  v_sid uuid;
  v_row record;
BEGIN
  v_actor_id := auth.uid();
  v_row := COALESCE(NEW, OLD);
  IF TG_TABLE_NAME = 'site_plans' THEN
    v_rid := v_row.site_id::text;
    v_sid := v_row.site_id;
  ELSE
    v_rid := COALESCE(v_row.id::text, v_row.site_id::text);
    v_sid := v_row.site_id;
  END IF;

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


ALTER FUNCTION "public"."audit_table_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer DEFAULT 24, "p_limit" integer DEFAULT 200) RETURNS TABLE("call_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_cutoff timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_cutoff := now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(p_min_age_hours, 24), 168)));

  RETURN QUERY
  WITH candidates AS (
    SELECT c.id
    FROM public.calls c
    JOIN public.sessions s
      ON s.id = c.matched_session_id
     AND s.site_id = p_site_id
    WHERE c.site_id = p_site_id
      AND c.source = 'click'
      AND (c.status = 'intent' OR c.status IS NULL)
      AND c.created_at < v_cutoff
      AND public.is_ads_session(s)
      AND (
        COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
        OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
        OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
      )
      AND COALESCE(s.total_duration_sec, 0) >= 10
      AND COALESCE(s.event_count, 0) >= 2
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.calls c
    SET
      status = 'confirmed',
      lead_score = GREATEST(COALESCE(c.lead_score, 0), 60),
      confirmed_at = now(),
      confirmed_by = NULL,
      note = COALESCE(NULLIF(c.note, ''), 'auto-approved after 24h (low-risk)'),
      score_breakdown = COALESCE(c.score_breakdown, '{}'::jsonb) || jsonb_build_object(
        'qualified_by', 'auto',
        'auto_approved', true,
        'min_age_hours', COALESCE(p_min_age_hours, 24),
        'timestamp', now()
      ),
      oci_status = 'sealed',
      oci_status_updated_at = now()
    FROM candidates x
    WHERE c.id = x.id
    RETURNING c.id
  )
  SELECT id FROM updated;
END;
$$;


ALTER FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer, "p_limit" integer) IS 'Auto-approve stale click intents after N hours (low-risk only). Sets lead_score to at least 60 (3 stars). Never junks.';



CREATE OR REPLACE FUNCTION "public"."backfill_one_session_utm_from_entry_page"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_entry_page text;
  v_utm_term text;
  v_utm_campaign text;
  v_matchtype text;
  v_utm_source text;
  v_utm_medium text;
BEGIN
  -- 1. Get the entry_page for the session
  SELECT entry_page INTO v_entry_page
  FROM public.sessions
  WHERE id = p_id;

  -- If no entry page, exit
  IF v_entry_page IS NULL THEN
    RETURN;
  END IF;

  -- 2. Extract params using regex (simple extraction)
  -- captures value after param= until & or end of string
  v_utm_term := substring(v_entry_page from 'utm_term=([^&]+)');
  v_utm_campaign := substring(v_entry_page from 'utm_campaign=([^&]+)');
  v_matchtype := substring(v_entry_page from 'matchtype=([^&]+)');
  v_utm_source := substring(v_entry_page from 'utm_source=([^&]+)');
  v_utm_medium := substring(v_entry_page from 'utm_medium=([^&]+)');

  -- 3. Update the session ONLY where fields are currently NULL
  UPDATE public.sessions
  SET
    utm_term = COALESCE(utm_term, v_utm_term),
    utm_campaign = COALESCE(utm_campaign, v_utm_campaign),
    matchtype = COALESCE(matchtype, v_matchtype),
    utm_source = COALESCE(utm_source, v_utm_source),
    utm_medium = COALESCE(utm_medium, v_utm_medium)
  WHERE id = p_id;

END;
$$;


ALTER FUNCTION "public"."backfill_one_session_utm_from_entry_page"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."backfill_one_session_utm_from_entry_page"("p_id" "uuid") IS 'Extract UTM from session entry_page and update session columns ONLY where currently NULL. Used by smoke proof.';



CREATE OR REPLACE FUNCTION "public"."backfill_one_session_utm_from_events"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_month date;
  v_url text;
  v_utm_term text;
  v_utm_campaign text;
  v_matchtype text;
  v_utm_source text;
  v_utm_medium text;
BEGIN
  SELECT s.created_month INTO v_month
  FROM public.sessions s
  WHERE s.id = p_id
  LIMIT 1;
  IF v_month IS NULL THEN
    RETURN;
  END IF;

  SELECT e.url INTO v_url
  FROM public.events e
  WHERE e.session_id = p_id AND e.session_month = v_month
    AND e.url IS NOT NULL AND e.url LIKE '%?%'
  ORDER BY e.created_at ASC
  LIMIT 1;
  IF v_url IS NULL THEN
    RETURN;
  END IF;

  v_utm_term     := substring(v_url from 'utm_term=([^&]+)');
  v_utm_campaign := substring(v_url from 'utm_campaign=([^&]+)');
  v_matchtype    := substring(v_url from 'matchtype=([^&]+)');
  v_utm_source   := substring(v_url from 'utm_source=([^&]+)');
  v_utm_medium   := substring(v_url from 'utm_medium=([^&]+)');

  UPDATE public.sessions s
  SET
    utm_term     = COALESCE(s.utm_term,     v_utm_term),
    utm_campaign = COALESCE(s.utm_campaign, v_utm_campaign),
    matchtype    = COALESCE(s.matchtype,    v_matchtype),
    utm_source   = COALESCE(s.utm_source,   v_utm_source),
    utm_medium   = COALESCE(s.utm_medium,   v_utm_medium)
  WHERE s.id = p_id AND s.created_month = v_month;
END;
$$;


ALTER FUNCTION "public"."backfill_one_session_utm_from_events"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."backfill_one_session_utm_from_events"("p_id" "uuid") IS 'Backfill session UTM from earliest event URL (partition-safe). Only fills null/empty. Used by smoke proof.';



CREATE OR REPLACE FUNCTION "public"."calls_enforce_update_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Allowed columns: sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, cancelled_at,
  -- note, lead_score, oci_status, oci_status_updated_at, updated_at, VERSION, and SCORE_BREAKDOWN.
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.site_id IS DISTINCT FROM NEW.site_id
     OR OLD.phone_number IS DISTINCT FROM NEW.phone_number
     OR OLD.matched_session_id IS DISTINCT FROM NEW.matched_session_id
     OR OLD.matched_fingerprint IS DISTINCT FROM NEW.matched_fingerprint
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.intent_page_url IS DISTINCT FROM NEW.intent_page_url
     OR OLD.click_id IS DISTINCT FROM NEW.click_id
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.intent_action IS DISTINCT FROM NEW.intent_action
     OR OLD.intent_target IS DISTINCT FROM NEW.intent_target
     OR OLD.intent_stamp IS DISTINCT FROM NEW.intent_stamp
     OR OLD.oci_uploaded_at IS DISTINCT FROM NEW.oci_uploaded_at
     OR OLD.oci_matched_at IS DISTINCT FROM NEW.oci_matched_at
     OR OLD.oci_batch_id IS DISTINCT FROM NEW.oci_batch_id
     OR OLD.oci_error IS DISTINCT FROM NEW.oci_error
  THEN
    RAISE EXCEPTION 'calls: only UI fields, version and score_breakdown are updatable by app'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calls_enforce_update_columns"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calls_enforce_update_columns"() IS 'RLS helper: immutable columns for authenticated app users. service_role bypass. Includes ads enrichment and location_source as immutable.';



CREATE OR REPLACE FUNCTION "public"."calls_updated_at_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calls_updated_at_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_site"("p_user_id" "uuid", "p_site_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p_user_id IS NOT NULL
    AND p_site_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = p_site_id
        AND (s.user_id = p_user_id
             OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s.id AND sm.user_id = p_user_id)
             OR public.is_admin(p_user_id))
    );
$$;


ALTER FUNCTION "public"."can_access_site"("p_user_id" "uuid", "p_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_access_site"("p_user_id" "uuid", "p_site_id" "uuid") IS 'Tenant check: true if user is site owner, site_member, or admin. Used by SECURITY DEFINER RPCs to enforce tenant isolation.';



CREATE OR REPLACE FUNCTION "public"."can_manage_site_members"("_site_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.id = _site_id
      AND (
        s.user_id = auth.uid()
        OR public.is_admin(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.site_members sm
          WHERE sm.site_id = s.id
            AND sm.user_id = auth.uid()
            AND sm.role = 'admin'
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_manage_site_members"("_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_manage_site_members"("_site_id" "uuid") IS 'RBAC v2: True if current user can manage site_members for the site (owner, site admin, or platform admin). SECURITY DEFINER to avoid RLS recursion.';



CREATE OR REPLACE FUNCTION "public"."check_caller_phone_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- service_role (scripts, admin) can update any column
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF (NEW.caller_phone_raw IS DISTINCT FROM OLD.caller_phone_raw
      OR NEW.caller_phone_e164 IS DISTINCT FROM OLD.caller_phone_e164
      OR NEW.caller_phone_hash_sha256 IS DISTINCT FROM OLD.caller_phone_hash_sha256)
     AND current_setting('app.allow_caller_phone', true) IS DISTINCT FROM '1'
  THEN
    RAISE EXCEPTION 'Direct update to caller_phone columns is restricted.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_caller_phone_update"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_caller_phone_update"() IS 'Blocks caller_phone_* updates unless app.allow_caller_phone=1 (set by RPC before seal UPDATE).';



CREATE OR REPLACE FUNCTION "public"."check_site_access"("target_site_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Bu fonksiyonu 'security definer' ile olu┼şturup RLS i├ğinde ├ğa─ş─▒r
  RETURN EXISTS (SELECT 1 FROM site_permissions WHERE site_id = target_site_id AND user_id = auth.uid());
END;
$$;


ALTER FUNCTION "public"."check_site_access"("target_site_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."billing_reconciliation_jobs" (
    "id" bigint NOT NULL,
    "site_id" "uuid" NOT NULL,
    "year_month" "text" NOT NULL,
    "status" "text" DEFAULT 'QUEUED'::"text" NOT NULL,
    "locked_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "last_drift_pct" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_reconciliation_jobs_status_check" CHECK (("status" = ANY (ARRAY['QUEUED'::"text", 'PROCESSING'::"text", 'COMPLETED'::"text", 'FAILED'::"text"]))),
    CONSTRAINT "billing_reconciliation_jobs_year_month_format" CHECK (("year_month" ~ '^\d{4}-\d{2}$'::"text"))
);


ALTER TABLE "public"."billing_reconciliation_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_reconciliation_jobs" IS 'Revenue Kernel PR-4: Queue for reconciliation cron. Worker claims with FOR UPDATE SKIP LOCKED.';



COMMENT ON COLUMN "public"."billing_reconciliation_jobs"."last_drift_pct" IS 'Drift % (|redis - pg|/pg*100) at last run; used for Watchtower billingReconciliationDriftLast1h.';



CREATE OR REPLACE FUNCTION "public"."claim_billing_reconciliation_jobs"("p_limit" integer) RETURNS SETOF "public"."billing_reconciliation_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  row RECORD;
BEGIN
  FOR row IN
    SELECT b.id, b.site_id, b.year_month, b.status, b.locked_at, b.attempt_count,
           b.last_error, b.last_drift_pct, b.created_at, b.updated_at
    FROM public.billing_reconciliation_jobs b
    WHERE b.status IN ('QUEUED', 'FAILED')
    ORDER BY b.updated_at ASC
    LIMIT p_limit
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE public.billing_reconciliation_jobs
    SET status = 'PROCESSING',
        locked_at = NOW(),
        attempt_count = attempt_count + 1,
        updated_at = NOW()
    WHERE id = row.id;
    RETURN NEXT row;
  END LOOP;
  RETURN;
END;
$$;


ALTER FUNCTION "public"."claim_billing_reconciliation_jobs"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_billing_reconciliation_jobs"("p_limit" integer) IS 'Revenue Kernel PR-4: Claim jobs for reconciliation worker. Concurrency-safe via FOR UPDATE SKIP LOCKED.';



CREATE TABLE IF NOT EXISTS "public"."offline_conversion_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "sale_id" "uuid",
    "provider" "text" DEFAULT 'google_ads'::"text" NOT NULL,
    "action" "text" DEFAULT 'purchase'::"text" NOT NULL,
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "conversion_time" timestamp with time zone NOT NULL,
    "value_cents" bigint NOT NULL,
    "currency" "text" DEFAULT 'TRY'::"text" NOT NULL,
    "status" "text" DEFAULT 'QUEUED'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_key" "text" DEFAULT 'google_ads'::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "next_retry_at" timestamp with time zone DEFAULT "now"(),
    "provider_ref" "text",
    "claimed_at" timestamp with time zone,
    "uploaded_at" timestamp with time zone,
    "provider_request_id" "text",
    "provider_error_code" "text",
    "provider_error_category" "text",
    "call_id" "uuid",
    "session_id" "uuid",
    "causal_dna" "jsonb" DEFAULT '{}'::"jsonb",
    "entropy_score" numeric(5,4) DEFAULT 0,
    "uncertainty_bit" boolean DEFAULT false,
    "discovery_method" "text",
    "discovery_confidence" numeric(3,2),
    "brain_score" smallint,
    "match_score" smallint,
    "queue_priority" smallint DEFAULT 0 NOT NULL,
    "score_version" smallint,
    "score_flags" integer DEFAULT 0 NOT NULL,
    "score_explain_jsonb" "jsonb",
    "external_id" "text" NOT NULL,
    "occurred_at" timestamp with time zone,
    "recorded_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "source_timestamp" timestamp with time zone,
    "time_confidence" "text",
    "occurred_at_source" "text",
    "entry_reason" "text",
    CONSTRAINT "offline_conversion_queue_entropy_score_check" CHECK ((("entropy_score" >= (0)::numeric) AND ("entropy_score" <= (1)::numeric))),
    CONSTRAINT "offline_conversion_queue_occurred_at_source_check" CHECK ((("occurred_at_source" IS NULL) OR ("occurred_at_source" = ANY (ARRAY['sale'::"text", 'fallback_confirmed'::"text", 'legacy_migrated'::"text"])))),
    CONSTRAINT "offline_conversion_queue_sale_or_call_check" CHECK (((("sale_id" IS NOT NULL) AND ("call_id" IS NULL)) OR (("sale_id" IS NULL) AND ("call_id" IS NOT NULL)))),
    CONSTRAINT "offline_conversion_queue_status_check" CHECK (("status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text", 'PROCESSING'::"text", 'UPLOADED'::"text", 'COMPLETED'::"text", 'COMPLETED_UNVERIFIED'::"text", 'FAILED'::"text", 'DEAD_LETTER_QUARANTINE'::"text", 'VOIDED_BY_REVERSAL'::"text"]))),
    CONSTRAINT "offline_conversion_queue_time_confidence_check" CHECK ((("time_confidence" IS NULL) OR ("time_confidence" = ANY (ARRAY['observed'::"text", 'operator_entered'::"text", 'inferred'::"text", 'legacy_migrated'::"text"]))))
);


ALTER TABLE "public"."offline_conversion_queue" OWNER TO "postgres";


COMMENT ON COLUMN "public"."offline_conversion_queue"."claimed_at" IS 'Set when row is claimed by worker (PR6).';



COMMENT ON COLUMN "public"."offline_conversion_queue"."uploaded_at" IS 'PR9: When the conversion was successfully uploaded to the provider (set on COMPLETED).';



COMMENT ON COLUMN "public"."offline_conversion_queue"."provider_request_id" IS 'PR9: Provider correlation/request id if returned (e.g. from response headers).';



COMMENT ON COLUMN "public"."offline_conversion_queue"."provider_error_code" IS 'PR9: Standardized provider error code on FAILED/RETRY (e.g. INVALID_ARGUMENT, RATE_LIMIT).';



COMMENT ON COLUMN "public"."offline_conversion_queue"."provider_error_category" IS 'PR9: Error category on FAILED/RETRY: VALIDATION, AUTH, TRANSIENT, RATE_LIMIT.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."call_id" IS 'Seal bridge: call-originated conversion (no sale). One of sale_id or call_id must be set.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."session_id" IS 'matched_session_id from the call (call-originated rows). Used for 1 conversion per session deduplication.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."causal_dna" IS 'Singularity: Decision path taken. input, gates_passed, logic_branch, math_version, original_state, transformed_state.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."entropy_score" IS 'Singularity: Historical failure probability for this fingerprint/IP. 0=high confidence, 1=speculative.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."uncertainty_bit" IS 'Singularity: True when entropy_score above threshold; flag for internal analytics, does not block upload.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."discovery_method" IS 'How GCLID was found: DIRECT, PHONE_STITCH, FINGERPRINT_STITCH';



COMMENT ON COLUMN "public"."offline_conversion_queue"."discovery_confidence" IS '0-1 confidence for stitched discovery. 1.0 for DIRECT.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."brain_score" IS 'Phase 23A typed routing score snapshot. Nullable until score-on-insert cutover.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."match_score" IS 'Phase 23A immutable match-quality snapshot copied from ingest/match pipeline when available.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."queue_priority" IS 'Phase 23A hot-path claim priority. Claim ORDER BY cutover happens in Phase 23C.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."score_version" IS 'Phase 23A typed score schema version.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."score_flags" IS 'Phase 23A bit flags for score/routing decisions.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."score_explain_jsonb" IS 'Phase 23A cold explainability payload kept out of the hot claim path.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."external_id" IS 'DB-authoritative logical OCI identity. Deterministic across retries so duplicate inserts collide before export.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."occurred_at" IS 'Canonical business-event time for V5 export. Prefer over conversion_time.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."recorded_at" IS 'Physical queue row-write time for audit. Never export this to Google Ads.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."source_timestamp" IS 'Raw upstream timestamp used to derive occurred_at.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."time_confidence" IS 'Queue timestamp provenance: observed, operator_entered, inferred, legacy_migrated.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."occurred_at_source" IS 'Source of queue business-event time: sale, fallback_confirmed, legacy_migrated.';



COMMENT ON COLUMN "public"."offline_conversion_queue"."entry_reason" IS 'Optional human-entered reason for delayed or corrected business-event time.';



CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_jobs"("p_limit" integer) RETURNS SETOF "public"."offline_conversion_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit int;
BEGIN
  -- Only service_role (no user context) may claim jobs; prevents tenant exposure if grant is widened
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 500));

  RETURN QUERY
  UPDATE public.offline_conversion_queue q
  SET status = 'PROCESSING', updated_at = now()
  FROM (
    SELECT oq.id
    FROM public.offline_conversion_queue oq
    WHERE oq.status = 'QUEUED'
    ORDER BY oq.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;


ALTER FUNCTION "public"."claim_offline_conversion_jobs"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_offline_conversion_jobs"("p_limit" integer) IS 'Claim up to p_limit QUEUED jobs for processing. Service_role only. Concurrency-safe via FOR UPDATE SKIP LOCKED; ORDER BY created_at ASC.';



CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_limit" integer DEFAULT 50, "p_provider_key" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."offline_conversion_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  RETURN QUERY
  UPDATE public.offline_conversion_queue q
  SET status = 'PROCESSING', updated_at = now()
  FROM (
    SELECT oq.id
    FROM public.offline_conversion_queue oq
    WHERE oq.status IN ('QUEUED', 'RETRY')
      AND oq.next_retry_at <= now()
      AND (p_provider_key IS NULL OR oq.provider_key = p_provider_key)
    ORDER BY oq.next_retry_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;


ALTER FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_limit" integer, "p_provider_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_limit" integer, "p_provider_key" "text") IS 'PR-G4: Claim jobs for worker. status IN (QUEUED,RETRY), next_retry_at <= now(). Optional provider_key filter. Service_role only.';



CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer DEFAULT 50) RETURNS SETOF "public"."offline_conversion_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit int;
  v_claimed_at timestamptz := now();
  v_candidate_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  WITH candidates AS (
    SELECT oq.id, oq.created_at
    FROM public.offline_conversion_queue AS oq
    JOIN public.sites AS s ON s.id = oq.site_id
    WHERE oq.site_id = p_site_id
      AND oq.provider_key = p_provider_key
      AND oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
      AND s.oci_sync_method = 'api'
    ORDER BY oq.next_retry_at ASC NULLS FIRST, oq.created_at ASC, oq.id ASC
    LIMIT v_limit
    FOR UPDATE OF oq SKIP LOCKED
  )
  SELECT COALESCE(array_agg(id ORDER BY created_at ASC, id ASC), ARRAY[]::uuid[])
  INTO v_candidate_queue_ids
  FROM candidates;

  PERFORM public.append_rpc_claim_transition_batch(v_candidate_queue_ids, v_claimed_at);

  RETURN QUERY
  SELECT q.*
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(v_candidate_queue_ids)
  ORDER BY q.created_at ASC, q.id ASC
  FOR UPDATE;
END;
$$;


ALTER FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) IS 'Phase 23B claim path. Locks candidates with SKIP LOCKED, appends PROCESSING transitions via append_rpc_claim_transition_batch, and returns snapped queue rows.';



CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_jobs_v3"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer DEFAULT 50) RETURNS SETOF "public"."offline_conversion_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit int;
  v_claimed_at timestamptz := now();
  v_candidate_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v3 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  WITH candidates AS (
    SELECT oq.id, oq.queue_priority, oq.next_retry_at, oq.created_at
    FROM public.offline_conversion_queue AS oq
    JOIN public.sites AS s ON s.id = oq.site_id
    WHERE oq.site_id = p_site_id
      AND oq.provider_key = p_provider_key
      AND oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= v_claimed_at)
      AND s.oci_sync_method = 'api'
    ORDER BY oq.queue_priority DESC, oq.next_retry_at ASC NULLS FIRST, oq.created_at ASC, oq.id ASC
    LIMIT v_limit
    FOR UPDATE OF oq SKIP LOCKED
  )
  SELECT COALESCE(
    array_agg(id ORDER BY queue_priority DESC, next_retry_at ASC NULLS FIRST, created_at ASC, id ASC),
    ARRAY[]::uuid[]
  )
  INTO v_candidate_queue_ids
  FROM candidates;

  PERFORM public.append_rpc_claim_transition_batch(v_candidate_queue_ids, v_claimed_at);

  RETURN QUERY
  SELECT q.*
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(v_candidate_queue_ids)
  ORDER BY q.queue_priority DESC, q.next_retry_at ASC NULLS FIRST, q.created_at ASC, q.id ASC
  FOR UPDATE;
END;
$$;


ALTER FUNCTION "public"."claim_offline_conversion_jobs_v3"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_offline_conversion_jobs_v3"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) IS 'Phase 23C priority-first claim path. Orders by queue_priority DESC, then retry time, then creation time, then id, appends PROCESSING transitions via append_rpc_claim_transition_batch, and returns snapped queue rows.';



CREATE OR REPLACE FUNCTION "public"."claim_offline_conversion_rows_for_script_export"("p_ids" "uuid"[], "p_site_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_rows_for_script_export may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(COALESCE(p_ids, ARRAY[]::uuid[]))
    AND q.site_id = p_site_id
    AND q.status IN ('QUEUED', 'RETRY');

  RETURN public.append_script_claim_transition_batch(v_queue_ids, now());
END;
$$;


ALTER FUNCTION "public"."claim_offline_conversion_rows_for_script_export"("p_ids" "uuid"[], "p_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_offline_conversion_rows_for_script_export"("p_ids" "uuid"[], "p_site_id" "uuid") IS 'Phase 23C compat wrapper for script export claim. Delegates to append_script_claim_transition_batch.';



CREATE OR REPLACE FUNCTION "public"."claim_outbox_events"("p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "payload" "jsonb", "call_id" "uuid", "site_id" "uuid", "created_at" timestamp with time zone, "attempt_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'claim_outbox_events may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH locked AS (
    SELECT o.id
    FROM public.outbox_events o
    WHERE o.status = 'PENDING'
    ORDER BY o.created_at ASC
    LIMIT greatest(1, least(p_limit, 200))
    FOR UPDATE OF o SKIP LOCKED
  ),
  updated AS (
    UPDATE public.outbox_events o
    SET
      status = 'PROCESSING',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
    FROM locked l
    WHERE o.id = l.id
    RETURNING o.id, o.payload, o.call_id, o.site_id, o.created_at, o.attempt_count
  )
  SELECT u.id, u.payload, u.call_id, u.site_id, u.created_at, u.attempt_count
  FROM updated u
  ORDER BY u.created_at ASC, u.id ASC;
END;
$$;


ALTER FUNCTION "public"."claim_outbox_events"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_outbox_events"("p_limit" integer) IS 'OCI outbox worker: claim PENDING rows (FOR UPDATE SKIP LOCKED), set PROCESSING + updated_at, return for app to handle.';



CREATE OR REPLACE FUNCTION "public"."cleanup_auto_junk_stale_intents"("p_days_old" integer DEFAULT 7, "p_limit" integer DEFAULT 5000) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_updated int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_auto_junk_stale_intents may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_junk AS (
    SELECT id
    FROM public.calls
    WHERE (status = 'intent' OR status IS NULL)
      AND created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  UPDATE public.calls
  SET status = 'junk', updated_at = now()
  WHERE id IN (SELECT id FROM to_junk);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."cleanup_auto_junk_stale_intents"("p_days_old" integer, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_auto_junk_stale_intents"("p_days_old" integer, "p_limit" integer) IS 'Sprint 2: Auto-junk leads with status intent/NULL older than p_days_old. Batch size p_limit. Service_role only.';



CREATE OR REPLACE FUNCTION "public"."cleanup_marketing_signals_batch"("p_days_old" integer DEFAULT 60, "p_limit" integer DEFAULT 5000) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'cleanup_marketing_signals_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_delete AS (
    SELECT id FROM public.marketing_signals
    WHERE dispatch_status = 'SENT'
      AND created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  DELETE FROM public.marketing_signals
  WHERE id IN (SELECT id FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_marketing_signals_batch"("p_days_old" integer, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_marketing_signals_batch"("p_days_old" integer, "p_limit" integer) IS 'Delete SENT marketing_signals older than p_days_old. service_role only.';



CREATE OR REPLACE FUNCTION "public"."cleanup_oci_queue_batch"("p_days_to_keep" integer DEFAULT 90, "p_limit" integer DEFAULT 5000) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_oci_queue_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_to_keep, 1), 365) || ' days')::interval;

  WITH to_delete AS (
    SELECT id
    FROM public.offline_conversion_queue
    WHERE status IN ('COMPLETED', 'FATAL', 'FAILED')
      AND updated_at < v_cutoff
    ORDER BY updated_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  DELETE FROM public.offline_conversion_queue
  WHERE id IN (SELECT id FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_oci_queue_batch"("p_days_to_keep" integer, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_oci_queue_batch"("p_days_to_keep" integer, "p_limit" integer) IS 'Sprint 2: Delete terminal OCI queue rows (COMPLETED/FATAL/FAILED) older than p_days_to_keep. Batch size p_limit. Service_role only.';



CREATE OR REPLACE FUNCTION "public"."close_stale_uploaded_conversions"("p_min_age_hours" integer DEFAULT 48) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
  v_cutoff timestamptz;
  v_now    timestamptz;
begin
  v_now    := now();
  v_cutoff := v_now - (p_min_age_hours || ' hours')::interval;

  with closed as (
    update public.offline_conversion_queue
    set
      status     = 'COMPLETED_UNVERIFIED',
      updated_at = v_now,
      last_error = 'Closed by zombie sweeper: UPLOADED for > ' || p_min_age_hours || 'h without verification'
    where
      status     = 'UPLOADED'
      and updated_at < v_cutoff
    returning id
  )
  select count(*) into v_count from closed;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."close_stale_uploaded_conversions"("p_min_age_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_offline_conversion_external_id"("p_provider_key" "text" DEFAULT 'google_ads'::"text", "p_action" "text" DEFAULT 'purchase'::"text", "p_sale_id" "uuid" DEFAULT NULL::"uuid", "p_call_id" "uuid" DEFAULT NULL::"uuid", "p_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    'oci_' || left(
      encode(
        sha256(
          (
            lower(COALESCE(NULLIF(btrim(p_provider_key), ''), 'google_ads'))
            || '|'
            || lower(COALESCE(NULLIF(btrim(p_action), ''), 'purchase'))
            || '|'
            || COALESCE(p_sale_id::text, '')
            || '|'
            || COALESCE(p_call_id::text, '')
            || '|'
            || COALESCE(p_session_id::text, '')
          )::bytea
        ),
        'hex'
      ),
      32
    );
$$;


ALTER FUNCTION "public"."compute_offline_conversion_external_id"("p_provider_key" "text", "p_action" "text", "p_sale_id" "uuid", "p_call_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."compute_offline_conversion_external_id"("p_provider_key" "text", "p_action" "text", "p_sale_id" "uuid", "p_call_id" "uuid", "p_session_id" "uuid") IS 'Deterministically derives the logical OCI external_id (SHA-256, first 128 bits). Replaces the previous MD5-based implementation. App-side: computeOfflineConversionExternalId().';



CREATE OR REPLACE FUNCTION "public"."confirm_sale_and_enqueue"("p_sale_id" "uuid") RETURNS TABLE("sale_id" "uuid", "new_status" "text", "enqueued" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_primary_session_id uuid;
  v_consent_scopes text[];
  v_queue_id uuid;
  v_uid uuid;
  v_external_id text;
BEGIN
  v_uid := auth.uid();
  SELECT * INTO v_sale FROM public.sales WHERE public.sales.id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001'; END IF;
  IF v_uid IS NOT NULL AND NOT public.can_access_site(v_uid, v_sale.site_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
  END IF;
  IF v_sale.status = 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_pending_approval', ERRCODE = 'P0001';
  END IF;
  IF v_sale.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_already_confirmed_or_canceled', ERRCODE = 'P0001';
  END IF;

  UPDATE public.sales SET status = 'CONFIRMED', updated_at = now() WHERE public.sales.id = p_sale_id;

  IF v_sale.amount_cents IS NULL OR v_sale.amount_cents <= 0 THEN
    RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, false;
    RETURN;
  END IF;

  IF v_sale.conversation_id IS NOT NULL THEN
    SELECT c.primary_source, c.primary_session_id INTO v_primary_source, v_primary_session_id
    FROM public.conversations c WHERE c.id = v_sale.conversation_id LIMIT 1;

    IF v_primary_session_id IS NOT NULL THEN
      SELECT s.consent_scopes INTO v_consent_scopes FROM public.sessions s
      WHERE s.id = v_primary_session_id AND s.site_id = v_sale.site_id LIMIT 1;
      IF v_consent_scopes IS NOT NULL AND 'marketing' = ANY(v_consent_scopes) THEN
        v_external_id := public.compute_offline_conversion_external_id(
          'google_ads',
          'purchase',
          v_sale.id,
          NULL,
          v_primary_session_id
        );

        INSERT INTO public.offline_conversion_queue (
          site_id,
          sale_id,
          session_id,
          provider_key,
          external_id,
          conversion_time,
          occurred_at,
          source_timestamp,
          time_confidence,
          occurred_at_source,
          entry_reason,
          value_cents,
          currency,
          gclid,
          wbraid,
          gbraid,
          status
        )
        VALUES (
          v_sale.site_id,
          v_sale.id,
          v_primary_session_id,
          'google_ads',
          v_external_id,
          v_sale.occurred_at,
          v_sale.occurred_at,
          v_sale.occurred_at,
          'observed',
          'sale',
          v_sale.entry_reason,
          v_sale.amount_cents,
          v_sale.currency,
          v_primary_source->>'gclid',
          v_primary_source->>'wbraid',
          v_primary_source->>'gbraid',
          'QUEUED'
        )
        ON CONFLICT ON CONSTRAINT offline_conversion_queue_sale_id_key DO NOTHING
        RETURNING public.offline_conversion_queue.id INTO v_queue_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, (v_queue_id IS NOT NULL);
END;
$$;


ALTER FUNCTION "public"."confirm_sale_and_enqueue"("p_sale_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_sale_and_enqueue"("p_sale_id" "uuid") IS 'Confirm sale and enqueue OCI row. Enforces tenant access via can_access_site when called as authenticated.';



CREATE OR REPLACE FUNCTION "public"."conversation_links_entity_site_check"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_site_id uuid;
  v_ok boolean := false;
BEGIN
  SELECT c.site_id INTO v_site_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id
  LIMIT 1;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: conversation not found', ERRCODE = 'P0001';
  END IF;

  CASE NEW.entity_type
    WHEN 'call' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.calls
        WHERE id = NEW.entity_id AND site_id = v_site_id
      ) INTO v_ok;
    WHEN 'session' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.sessions
        WHERE id = NEW.entity_id AND site_id = v_site_id
      ) INTO v_ok;
    WHEN 'event' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.events
        WHERE id = NEW.entity_id AND site_id = v_site_id
      ) INTO v_ok;
    ELSE
      RAISE EXCEPTION USING MESSAGE = 'conversation_links: invalid entity_type', ERRCODE = 'P0001';
  END CASE;

  IF NOT v_ok THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_links: entity must belong to the same site as the conversation',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."conversation_links_entity_site_check"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."conversation_links_entity_site_check"() IS 'Trigger: ensures conversation_links.entity_id references a call/session/event in the same site as the conversation.';



CREATE OR REPLACE FUNCTION "public"."conversations_primary_entity_site_check"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_call_ok boolean := true;
  v_session_ok boolean := true;
BEGIN
  IF NEW.primary_call_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.calls ca
      WHERE ca.id = NEW.primary_call_id
        AND ca.site_id = NEW.site_id
    ) INTO v_call_ok;
  END IF;

  IF NEW.primary_session_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = NEW.primary_session_id
        AND s.site_id = NEW.site_id
    ) INTO v_session_ok;
  END IF;

  IF NOT v_call_ok OR NOT v_session_ok THEN
    RAISE EXCEPTION USING
      MESSAGE = 'conversations: primary entity must belong to the same site as conversation.site_id',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."conversations_primary_entity_site_check"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."conversations_primary_entity_site_check"() IS 'Trigger: ensures conversations.primary_call_id and primary_session_id belong to the same site as conversations.site_id.';



CREATE OR REPLACE FUNCTION "public"."create_conversation_with_primary_entity"("p_site_id" "uuid", "p_primary_entity_type" "text", "p_primary_entity_id" "uuid", "p_primary_source" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid;
  v_is_service boolean := false;
  v_call_id uuid := NULL;
  v_session_id uuid := NULL;
  v_entity_ok boolean := false;
  v_conversation public.conversations%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  v_is_service := (v_uid IS NULL AND auth.role() = 'service_role');

  IF NOT v_is_service THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, p_site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_primary_entity_type = 'call' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.calls ca
      WHERE ca.id = p_primary_entity_id
        AND ca.site_id = p_site_id
    ) INTO v_entity_ok;
    v_call_id := p_primary_entity_id;
  ELSIF p_primary_entity_type = 'session' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = p_primary_entity_id
        AND s.site_id = p_site_id
    ) INTO v_entity_ok;
    v_session_id := p_primary_entity_id;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'invalid_primary_entity_type', ERRCODE = 'P0001';
  END IF;

  IF NOT v_entity_ok THEN
    RAISE EXCEPTION USING MESSAGE = 'primary_entity_site_mismatch', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversations (
    site_id,
    status,
    primary_call_id,
    primary_session_id,
    primary_source
  )
  VALUES (
    p_site_id,
    'OPEN',
    v_call_id,
    v_session_id,
    NULLIF(p_primary_source, '{}'::jsonb)
  )
  RETURNING * INTO v_conversation;

  INSERT INTO public.conversation_links (
    conversation_id,
    entity_type,
    entity_id
  )
  VALUES (
    v_conversation.id,
    p_primary_entity_type,
    p_primary_entity_id
  );

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'site_id', v_conversation.site_id,
    'status', v_conversation.status,
    'primary_call_id', v_conversation.primary_call_id,
    'primary_session_id', v_conversation.primary_session_id,
    'primary_source', v_conversation.primary_source,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;


ALTER FUNCTION "public"."create_conversation_with_primary_entity"("p_site_id" "uuid", "p_primary_entity_type" "text", "p_primary_entity_id" "uuid", "p_primary_source" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_conversation_with_primary_entity"("p_site_id" "uuid", "p_primary_entity_type" "text", "p_primary_entity_id" "uuid", "p_primary_source" "jsonb") IS 'Atomically creates a conversation and its first conversation_links row after validating the primary entity belongs to the same site.';



CREATE OR REPLACE FUNCTION "public"."create_next_month_partitions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    next_month DATE := DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month';
    partition_name_sessions TEXT;
    partition_name_events TEXT;
    start_date TEXT;
    end_date TEXT;
BEGIN
    partition_name_sessions := 'sessions_' || TO_CHAR(next_month, 'YYYY_MM');
    partition_name_events := 'events_' || TO_CHAR(next_month, 'YYYY_MM');
    start_date := TO_CHAR(next_month, 'YYYY-MM-DD');
    end_date := TO_CHAR(next_month + INTERVAL '1 month', 'YYYY-MM-DD');

    -- Create Sessions partition if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = partition_name_sessions
    ) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.sessions FOR VALUES FROM (%L) TO (%L)',
            partition_name_sessions, start_date, end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name_sessions;
    END IF;

    -- Create Events partition if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = partition_name_events
    ) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.events FOR VALUES FROM (%L) TO (%L)',
            partition_name_events, start_date, end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name_events;
    END IF;
END;
$$;


ALTER FUNCTION "public"."create_next_month_partitions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_next_month_partitions"() IS 'Creates sessions_YYYY_MM and events_YYYY_MM for next month; run daily or monthly.';



CREATE OR REPLACE FUNCTION "public"."decrement_usage_compensation"("p_site_id" "uuid", "p_month" "date", "p_kind" "text" DEFAULT 'revenue_events'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_service boolean;
  v_row public.usage_counters%ROWTYPE;
  v_new int;
BEGIN
  v_is_service := (auth.uid() IS NULL AND public._jwt_role() = 'service_role');
  IF NOT v_is_service THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF p_kind NOT IN ('revenue_events', 'oci_uploads') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_KIND');
  END IF;

  SELECT * INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id AND month = p_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'new_count', 0, 'skipped', true);
  END IF;

  IF p_kind = 'revenue_events' THEN
    v_new := GREATEST(0, v_row.revenue_events_count - 1);
    UPDATE public.usage_counters
    SET revenue_events_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  ELSE
    v_new := GREATEST(0, v_row.conversion_sends_count - 1);
    UPDATE public.usage_counters
    SET conversion_sends_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_count', v_new);
END;
$$;


ALTER FUNCTION "public"."decrement_usage_compensation"("p_site_id" "uuid", "p_month" "date", "p_kind" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."decrement_usage_compensation"("p_site_id" "uuid", "p_month" "date", "p_kind" "text") IS 'Compensation: decrement usage counter by 1 (floor 0). Used when processSyncEvent fails after idempotency+usage commit. Service_role only.';



CREATE OR REPLACE FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer DEFAULT 10000) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted INT;
  v_keep_after_year_month TEXT;
BEGIN
  -- Never delete current or previous UTC month (dispute/invoice safety)
  v_keep_after_year_month := to_char(
    (date_trunc('month', (now() AT TIME ZONE 'UTC'))::date - interval '2 months'),
    'YYYY-MM'
  );

  WITH to_delete AS (
    SELECT site_id, idempotency_key
    FROM public.ingest_idempotency
    WHERE created_at < p_cutoff_iso
      AND year_month <= v_keep_after_year_month
    LIMIT p_batch_size
  )
  DELETE FROM public.ingest_idempotency
  WHERE (site_id, idempotency_key) IN (SELECT site_id, idempotency_key FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer) IS 'Revenue Kernel: Batch delete ingest_idempotency rows older than cutoff, never current/previous month. Returns deleted count. Call from cron; max p_batch_size per run.';



CREATE OR REPLACE FUNCTION "public"."enforce_marketing_signals_state_machine"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.dispatch_status IS NOT DISTINCT FROM OLD.dispatch_status THEN
    RETURN NEW;
  END IF;

  IF (
    (
      OLD.dispatch_status = 'PENDING'
      AND NEW.dispatch_status IN (
        'PROCESSING',
        'JUNK_ABORTED',
        'SKIPPED_NO_CLICK_ID',
        'STALLED_FOR_HUMAN_AUDIT'
      )
    )
    OR (
      OLD.dispatch_status = 'PROCESSING'
      AND NEW.dispatch_status IN (
        'SENT',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'JUNK_ABORTED',
        'PENDING'
      )
    )
    OR (OLD.dispatch_status = 'STALLED_FOR_HUMAN_AUDIT' AND NEW.dispatch_status = 'PENDING')  -- Recovery: human release stalled
    OR (OLD.dispatch_status = 'FAILED' AND NEW.dispatch_status = 'PENDING')  -- Recovery: manual retry failed signal
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal signal transition: % -> %', OLD.dispatch_status, NEW.dispatch_status;
END;
$$;


ALTER FUNCTION "public"."enforce_marketing_signals_state_machine"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_marketing_signals_state_machine"() IS 'Phase 21 strict signal transition matrix. Preserves PENDING terminalization to SKIPPED_NO_CLICK_ID/STALLED_FOR_HUMAN_AUDIT for existing vacuum flows.';



CREATE OR REPLACE FUNCTION "public"."enforce_offline_conversion_queue_state_machine"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (
    (OLD.status = 'QUEUED' AND NEW.status IN ('PROCESSING', 'RETRY', 'VOIDED_BY_REVERSAL'))
    OR (OLD.status = 'RETRY' AND NEW.status IN ('PROCESSING', 'QUEUED', 'VOIDED_BY_REVERSAL'))
    OR (
      OLD.status = 'PROCESSING'
      AND NEW.status IN (
        'UPLOADED',
        'COMPLETED',
        'RETRY',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'QUEUED'
      )
    )
    OR (OLD.status = 'UPLOADED' AND NEW.status IN ('COMPLETED', 'COMPLETED_UNVERIFIED'))
    OR (OLD.status = 'FAILED' AND NEW.status = 'RETRY')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal queue transition: % -> %', OLD.status, NEW.status;
END;
$$;


ALTER FUNCTION "public"."enforce_offline_conversion_queue_state_machine"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_offline_conversion_queue_state_machine"() IS 'Phase 21 strict queue transition matrix. Rejects illegal status moves before UPDATE.';



CREATE OR REPLACE FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text" DEFAULT NULL::"text", "p_form_summary" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stamp text;
  v_id uuid;
  v_action text;
  v_form_state text;
BEGIN
  IF p_site_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  v_stamp := 'session:' || p_session_id::text;
  v_action := lower(coalesce(p_intent_action, ''));
  IF v_action NOT IN ('phone', 'whatsapp', 'form') THEN
    v_action := 'other';
  END IF;

  v_form_state := lower(nullif(btrim(coalesce(p_form_state, '')), ''));
  IF v_form_state NOT IN ('started', 'attempted', 'validation_failed', 'network_failed', 'success') THEN
    v_form_state := NULL;
  END IF;

  INSERT INTO public.calls (
    site_id,
    phone_number,
    matched_session_id,
    matched_fingerprint,
    lead_score,
    lead_score_at_match,
    status,
    source,
    intent_stamp,
    intent_action,
    intent_target,
    intent_page_url,
    click_id,
    intent_phone_clicks,
    intent_whatsapp_clicks,
    intent_last_at,
    form_state,
    form_summary,
    form_last_event_at
  )
  VALUES (
    p_site_id,
    COALESCE(NULLIF(BTRIM(p_intent_target), ''), 'Unknown'),
    p_session_id,
    NULLIF(BTRIM(p_fingerprint), ''),
    COALESCE(p_lead_score, 0),
    COALESCE(p_lead_score, 0),
    'intent',
    'click',
    v_stamp,
    v_action,
    NULLIF(BTRIM(p_intent_target), ''),
    NULLIF(BTRIM(p_intent_page_url), ''),
    NULLIF(BTRIM(p_click_id), ''),
    CASE WHEN v_action = 'phone' THEN 1 ELSE 0 END,
    CASE WHEN v_action = 'whatsapp' THEN 1 ELSE 0 END,
    now(),
    v_form_state,
    CASE WHEN jsonb_typeof(p_form_summary) = 'object' THEN p_form_summary ELSE NULL END,
    CASE
      WHEN v_form_state IS NOT NULL OR jsonb_typeof(p_form_summary) = 'object' THEN now()
      ELSE NULL
    END
  )
  ON CONFLICT (site_id, intent_stamp) DO UPDATE
  SET
    status = CASE
      WHEN public.calls.status IS NULL OR public.calls.status = 'intent' THEN 'intent'
      ELSE public.calls.status
    END,
    matched_session_id = COALESCE(public.calls.matched_session_id, EXCLUDED.matched_session_id),
    matched_fingerprint = COALESCE(public.calls.matched_fingerprint, EXCLUDED.matched_fingerprint),
    lead_score = GREATEST(COALESCE(public.calls.lead_score, 0), COALESCE(EXCLUDED.lead_score, 0)),
    lead_score_at_match = GREATEST(COALESCE(public.calls.lead_score_at_match, 0), COALESCE(EXCLUDED.lead_score_at_match, 0)),
    intent_action = CASE
      WHEN EXCLUDED.intent_action = 'form' AND public.calls.intent_action IN ('phone', 'whatsapp') THEN public.calls.intent_action
      ELSE EXCLUDED.intent_action
    END,
    intent_target = CASE
      WHEN EXCLUDED.intent_action = 'form' AND public.calls.intent_action IN ('phone', 'whatsapp')
        THEN public.calls.intent_target
      ELSE COALESCE(EXCLUDED.intent_target, public.calls.intent_target)
    END,
    intent_page_url = COALESCE(EXCLUDED.intent_page_url, public.calls.intent_page_url),
    click_id = COALESCE(EXCLUDED.click_id, public.calls.click_id),
    intent_phone_clicks = COALESCE(public.calls.intent_phone_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'phone' THEN 1 ELSE 0 END,
    intent_whatsapp_clicks = COALESCE(public.calls.intent_whatsapp_clicks, 0) + CASE WHEN EXCLUDED.intent_action = 'whatsapp' THEN 1 ELSE 0 END,
    intent_last_at = now(),
    form_state = COALESCE(EXCLUDED.form_state, public.calls.form_state),
    form_summary = COALESCE(EXCLUDED.form_summary, public.calls.form_summary),
    form_last_event_at = CASE
      WHEN EXCLUDED.form_state IS NOT NULL OR EXCLUDED.form_summary IS NOT NULL THEN now()
      ELSE public.calls.form_last_event_at
    END
  RETURNING public.calls.id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text", "p_form_summary" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text", "p_form_summary" "jsonb") IS 'Single session-head click intent with form lifecycle truth. Form updates never downgrade phone or whatsapp heads.';



CREATE OR REPLACE FUNCTION "public"."erase_pii_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") RETURNS TABLE("sessions_affected" bigint, "events_affected" bigint, "calls_affected" bigint, "conversations_affected" bigint, "sales_affected" bigint, "ociq_affected" bigint, "sync_dlq_affected" bigint, "ingest_fallback_affected" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session_ids uuid[] := '{}';
  v_sessions bigint := 0;
  v_events bigint := 0;
  v_calls bigint := 0;
  v_conversations bigint := 0;
  v_sales bigint := 0;
  v_ociq bigint := 0;
  v_dlq bigint := 0;
  v_fallback bigint := 0;
  v_redacted jsonb;
  v_conversation_ids uuid[];
  v_sale_ids uuid[];
BEGIN
  IF p_identifier_type IS NULL OR NULLIF(TRIM(p_identifier_value), '') IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  v_redacted := jsonb_build_object(
    'redacted', true,
    'redacted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reason', 'gdpr_erase'
  );

  IF p_identifier_type NOT IN ('session_id', 'fingerprint', 'email') THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Resolve v_session_ids for email BEFORE any updates (events.metadata gets cleared later)
  IF p_identifier_type = 'email' THEN
    SELECT ARRAY_AGG(DISTINCT session_id) INTO v_session_ids
    FROM public.events
    WHERE site_id = p_site_id
      AND ((metadata->>'email')::text ILIKE p_identifier_value OR (metadata->>'email_lc')::text = lower(p_identifier_value));
    v_session_ids := COALESCE(v_session_ids, '{}');
  END IF;

  -- Resolve conversation_ids and sale_ids BEFORE any updates (data needed for fingerprint/call lookups)
  SELECT ARRAY_AGG(DISTINCT c.id) INTO v_conversation_ids
  FROM public.conversations c
  LEFT JOIN public.calls ca ON ca.id = c.primary_call_id AND ca.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND (
      (p_identifier_type = 'session_id' AND (c.primary_session_id::text = p_identifier_value))
      OR (p_identifier_type = 'session_id' AND ca.matched_session_id::text = p_identifier_value)
      OR (p_identifier_type = 'fingerprint' AND ca.matched_fingerprint = p_identifier_value)
      OR (p_identifier_type = 'email' AND EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.session_id = c.primary_session_id AND e.site_id = p_site_id
          AND ((e.metadata->>'email')::text ILIKE p_identifier_value OR (e.metadata->>'email_lc')::text = lower(p_identifier_value))
      ))
    );

  IF v_conversation_ids IS NOT NULL AND array_length(v_conversation_ids, 1) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT s.id) INTO v_sale_ids FROM public.sales s WHERE s.conversation_id = ANY(v_conversation_ids);
  END IF;

  -- 1) Sessions: NULL PII columns
  WITH upds AS (
    UPDATE public.sessions
    SET
      ip_address = NULL,
      entry_page = NULL,
      exit_page = NULL,
      gclid = NULL,
      wbraid = NULL,
      gbraid = NULL,
      fingerprint = NULL,
      ai_summary = NULL,
      ai_tags = NULL,
      user_journey_path = NULL
    WHERE site_id = p_site_id
      AND (
        (p_identifier_type = 'session_id' AND id::text = p_identifier_value)
        OR (p_identifier_type = 'fingerprint' AND fingerprint = p_identifier_value)
        OR (p_identifier_type = 'email' AND id = ANY(v_session_ids))
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_sessions FROM upds;

  -- 2) Events: NULL metadata (v1: full clear for safety)
  WITH upds AS (
    UPDATE public.events
    SET metadata = '{}'
    WHERE site_id = p_site_id
      AND (
        (p_identifier_type = 'session_id' AND session_id::text = p_identifier_value)
        OR (p_identifier_type = 'fingerprint' AND (metadata->>'fingerprint' = p_identifier_value OR metadata->>'fp' = p_identifier_value))
        OR (p_identifier_type = 'email' AND session_id = ANY(v_session_ids))
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_events FROM upds;

  -- 3) Calls: redact phone_number (NOT NULL), NULL matched_fingerprint
  WITH upds AS (
    UPDATE public.calls
    SET phone_number = '[REDACTED]', matched_fingerprint = NULL
    WHERE site_id = p_site_id
      AND (
        (p_identifier_type = 'session_id' AND matched_session_id::text = p_identifier_value)
        OR (p_identifier_type = 'fingerprint' AND matched_fingerprint = p_identifier_value)
        OR (p_identifier_type = 'email' AND matched_session_id = ANY(v_session_ids))
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_calls FROM upds;

  -- 5) Conversations: NULL note, primary_source (v_conversation_ids resolved at start)
  IF v_conversation_ids IS NOT NULL AND array_length(v_conversation_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.conversations SET note = NULL, primary_source = NULL WHERE id = ANY(v_conversation_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_conversations FROM upds;
  END IF;

  -- 6) Sales: NULL customer_hash, notes (v_sale_ids from conversations)
  IF v_sale_ids IS NOT NULL AND array_length(v_sale_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.sales SET customer_hash = NULL, notes = NULL WHERE id = ANY(v_sale_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_sales FROM upds;
  END IF;

  -- 7) offline_conversion_queue: NULL gclid, wbraid, gbraid for affected sales
  IF v_sale_ids IS NOT NULL AND array_length(v_sale_ids, 1) > 0 THEN
    WITH upds AS (
      UPDATE public.offline_conversion_queue SET gclid = NULL, wbraid = NULL, gbraid = NULL WHERE sale_id = ANY(v_sale_ids) RETURNING 1
    )
    SELECT count(*)::bigint INTO v_ociq FROM upds;
  END IF;

  -- 8) sync_dlq: full payload replace where payload contains identifier
  WITH upds AS (
    UPDATE public.sync_dlq
    SET payload = v_redacted
    WHERE (site_id = p_site_id OR site_id IS NULL)
      AND (
        (payload->>'sid' = p_identifier_value)
        OR (payload->'meta'->>'fp' = p_identifier_value)
        OR (payload->'meta'->>'fingerprint' = p_identifier_value)
        OR (payload->'meta'->>'email')::text ILIKE p_identifier_value
        OR (payload->>'email')::text ILIKE p_identifier_value
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_dlq FROM upds;

  -- 9) ingest_fallback_buffer: full payload replace
  WITH upds AS (
    UPDATE public.ingest_fallback_buffer
    SET payload = v_redacted
    WHERE site_id = p_site_id
      AND (
        (payload->>'sid' = p_identifier_value)
        OR (payload->'meta'->>'fp' = p_identifier_value)
        OR (payload->'meta'->>'fingerprint' = p_identifier_value)
        OR (payload->'meta'->>'email')::text ILIKE p_identifier_value
        OR (payload->>'email')::text ILIKE p_identifier_value
      )
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_fallback FROM upds;

  RETURN QUERY SELECT v_sessions, v_events, v_calls, v_conversations, v_sales, v_ociq, v_dlq, v_fallback;
END;
$$;


ALTER FUNCTION "public"."erase_pii_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."erase_pii_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") IS 'KVKK/GDPR: PII anonymization by identifier. session_id|fingerprint|email. sync_dlq/ingest_fallback: payload full replace.';



CREATE OR REPLACE FUNCTION "public"."export_data_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session_ids uuid[] := '{}';
  v_result jsonb := '{}'::jsonb;
  v_sessions jsonb; v_events jsonb; v_calls jsonb;
BEGIN
  IF p_identifier_type IS NULL OR NULLIF(TRIM(p_identifier_value), '') IS NULL THEN RETURN v_result; END IF;
  IF p_identifier_type NOT IN ('session_id', 'fingerprint', 'email') THEN RETURN v_result; END IF;
  IF p_identifier_type = 'email' THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT session_id), '{}') INTO v_session_ids FROM public.events
    WHERE site_id = p_site_id AND ((metadata->>'email')::text ILIKE p_identifier_value OR (metadata->>'email_lc')::text = lower(p_identifier_value));
  END IF;
  IF p_identifier_type = 'session_id' THEN SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sessions FROM public.sessions s WHERE s.site_id = p_site_id AND s.id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sessions FROM public.sessions s WHERE s.site_id = p_site_id AND s.fingerprint = p_identifier_value;
  ELSE SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO v_sessions FROM public.sessions s WHERE s.site_id = p_site_id AND s.id = ANY(v_session_ids); END IF;
  v_result := v_result || jsonb_build_object('sessions', COALESCE(v_sessions, '[]'::jsonb));
  IF p_identifier_type = 'session_id' THEN SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO v_events FROM public.events e WHERE e.site_id = p_site_id AND e.session_id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO v_events FROM public.events e WHERE e.site_id = p_site_id AND (e.metadata->>'fingerprint' = p_identifier_value OR e.metadata->>'fp' = p_identifier_value);
  ELSE SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO v_events FROM public.events e WHERE e.site_id = p_site_id AND e.session_id = ANY(v_session_ids); END IF;
  v_result := v_result || jsonb_build_object('events', COALESCE(v_events, '[]'::jsonb));
  IF p_identifier_type = 'session_id' THEN SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_calls FROM public.calls c WHERE c.site_id = p_site_id AND c.matched_session_id::text = p_identifier_value;
  ELSIF p_identifier_type = 'fingerprint' THEN SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_calls FROM public.calls c WHERE c.site_id = p_site_id AND c.matched_fingerprint = p_identifier_value;
  ELSE SELECT COALESCE(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) INTO v_calls FROM public.calls c WHERE c.site_id = p_site_id AND c.matched_session_id = ANY(v_session_ids); END IF;
  v_result := v_result || jsonb_build_object('calls', COALESCE(v_calls, '[]'::jsonb));
  RETURN v_result;
END; $$;


ALTER FUNCTION "public"."export_data_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."export_data_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") IS 'GDPR export: sessions, events, calls only. Conversations/sales excluded (subject binding not defined).';



CREATE OR REPLACE FUNCTION "public"."fn_increment_calls_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Only increment if the application hasn't already manually incremented it
    -- or if we want to enforce it always. Enforcing it always is safer for "Global SaaS".
    IF NEW.version <= OLD.version THEN
        NEW.version = OLD.version + 1;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_increment_calls_version"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_increment_calls_version"() IS 'Automatically increments the version column for optimistic locking on update.';



CREATE OR REPLACE FUNCTION "public"."fn_set_standard_expires_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Authoritative 7-day TTL if not provided
    IF NEW.expires_at IS NULL THEN
        NEW.expires_at = NOW() + INTERVAL '7 days';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_standard_expires_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_last_status_change_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        NEW.last_status_change_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_update_last_status_change_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer DEFAULT 24, "p_limit" integer DEFAULT 50, "p_action_types" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_from timestamptz;
  v_rows jsonb;
  v_limit int;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_from := now() - (COALESCE(p_hours_back, 24) || ' hours')::interval;

  WITH base AS (
    SELECT
      a.id,
      a.call_id,
      a.action_type,
      a.actor_type,
      a.actor_id,
      a.previous_status,
      a.new_status,
      a.metadata,
      a.created_at,
      c.intent_action,
      c.intent_target,
      c.lead_score,
      c.sale_amount,
      c.currency,
      COALESCE(a.metadata->'meta'->>'reason', a.metadata->>'reason') AS reason,
      (a.id = (
        SELECT a2.id
        FROM public.call_actions a2
        WHERE a2.call_id = a.call_id
        ORDER BY a2.created_at DESC, a2.id DESC
        LIMIT 1
      )) AS is_latest_for_call
    FROM public.call_actions a
    JOIN public.calls c ON c.id = a.call_id
    WHERE a.site_id = p_site_id
      AND a.created_at >= v_from
      AND (p_action_types IS NULL OR a.action_type = ANY(p_action_types))
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT v_limit
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'call_id', call_id,
      'action_type', action_type,
      'actor_type', actor_type,
      'actor_id', actor_id,
      'previous_status', previous_status,
      'new_status', new_status,
      'created_at', created_at,
      'intent_action', intent_action,
      'intent_target', intent_target,
      'lead_score', lead_score,
      'sale_amount', sale_amount,
      'currency', currency,
      'reason', reason,
      'is_latest_for_call', is_latest_for_call
    )
    ORDER BY created_at DESC
  )
  INTO v_rows
  FROM base;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer, "p_action_types" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer, "p_action_types" "text"[]) IS 'Returns recent call_actions for a site to power Activity Log / Kill Feed module (manual + automation).';



CREATE OR REPLACE FUNCTION "public"."get_and_claim_fallback_batch"("p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "site_id" "uuid", "payload" "jsonb", "error_reason" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT b.id
    FROM public.ingest_fallback_buffer b
    JOIN public.sites s ON s.id = b.site_id
    WHERE b.status = 'PENDING'
      AND s.oci_sync_method = 'api'
    ORDER BY b.created_at
    LIMIT p_limit
    FOR UPDATE OF b SKIP LOCKED
  ),
  updated AS (
    UPDATE public.ingest_fallback_buffer b
    SET status = 'PROCESSING', updated_at = now()
    FROM locked
    WHERE b.id = locked.id
    RETURNING b.id, b.site_id, b.payload, b.error_reason, b.created_at
  )
  SELECT updated.id, updated.site_id, updated.payload, updated.error_reason, updated.created_at
  FROM updated;
END;
$$;


ALTER FUNCTION "public"."get_and_claim_fallback_batch"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_and_claim_fallback_batch"("p_limit" integer) IS 'Recovery worker: claim PENDING rows (oci_sync_method = api). Sets updated_at for zombie recovery.';



CREATE OR REPLACE FUNCTION "public"."get_attribution_forensic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") RETURNS TABLE("raw_phone_string" "text", "phone_source_type" "text", "detected_country_iso" "text", "event_timestamp_utc_ms" bigint, "first_fingerprint_touch_utc_ms" bigint, "user_agent_raw" "text", "historical_gclid_presence" boolean, "identity_resolution_score" numeric, "touchpoint_entropy" "jsonb", "cross_device_fingerprint_link" "text", "pre_normalization_snapshot" "jsonb", "failure_mode" "text", "clids_discarded_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH c AS (
    SELECT
      c.phone_number,
      c.caller_phone_e164,
      c.caller_phone_raw,
      c.phone_source_type,
      c.user_agent,
      c.matched_fingerprint,
      c.site_id,
      c.confirmed_at,
      c.matched_at,
      c.session_created_month
    FROM public.calls c
    WHERE c.id = p_call_id AND c.site_id = p_site_id
    LIMIT 1
  ),
  conv_time AS (
    SELECT COALESCE(c.confirmed_at, c.matched_at) AS t FROM c
  ),
  site_country AS (
    SELECT s.default_country_iso
    FROM public.sites s
    INNER JOIN c ON c.site_id = s.id
    LIMIT 1
  ),
  first_touch AS (
    SELECT MIN(s2.created_at) AS first_at
    FROM public.sessions s2
    INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
    WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '90 days'
  ),
  gclid_90d AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s2
      INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
      WHERE s2.gclid IS NOT NULL
        AND s2.created_at >= (SELECT t FROM conv_time) - interval '90 days'
    ) AS has_gclid
  ),
  touchpoints_14d AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_agent', s2.user_agent,
        'ip_address', s2.ip_address,
        'created_at', s2.created_at
      ) ORDER BY s2.created_at
    ) AS chain
    FROM public.sessions s2
    INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
    WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '14 days'
  ),
  fingerprint_variation AS (
    SELECT
      (SELECT count(DISTINCT c2.matched_fingerprint) FROM public.calls c2
       WHERE c2.site_id = c.site_id AND c2.phone_number = c.phone_number
         AND c2.matched_at >= (SELECT t FROM conv_time) - interval '14 days'
         AND c2.matched_fingerprint IS NOT NULL) AS distinct_fp_for_phone,
      (SELECT count(DISTINCT s2.ip_address) FROM public.sessions s2
       INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
       WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '14 days' AND s2.ip_address IS NOT NULL) AS distinct_ips,
      (SELECT count(DISTINCT s2.user_agent) FROM public.sessions s2
       INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
       WHERE s2.created_at >= (SELECT t FROM conv_time) - interval '14 days' AND s2.user_agent IS NOT NULL) AS distinct_uas
    FROM c
  ),
  link_reason AS (
    SELECT
      CASE
        WHEN (SELECT distinct_fp_for_phone FROM fingerprint_variation) > 1 THEN 'multiple_fingerprints'
        WHEN (SELECT distinct_ips FROM fingerprint_variation) > 1 THEN 'ip_change'
        WHEN (SELECT distinct_uas FROM fingerprint_variation) > 1 THEN 'browser_update'
        ELSE NULL
      END AS reason
    FROM c
    LIMIT 1
  ),
  failure_bucket AS (
    SELECT
      CASE
        WHEN c.matched_fingerprint IS NULL THEN 'ORPHANED_CONVERSION'
        WHEN (SELECT first_at FROM first_touch) IS NULL THEN 'ORPHANED_CONVERSION'
        WHEN (SELECT t FROM conv_time) - (SELECT first_at FROM first_touch) > interval '30 days' THEN 'SIGNAL_STALE'
        ELSE NULL
      END AS mode
    FROM c
    LIMIT 1
  ),
  discarded_clids AS (
    SELECT count(*)::bigint AS cnt
    FROM public.offline_conversion_queue oq
    WHERE oq.call_id = p_call_id AND oq.site_id = p_site_id
      AND oq.status = 'FAILED'
      AND (
        oq.provider_error_code IN ('INVALID_GCLID', 'UNPARSEABLE_GCLID')
        OR oq.last_error ILIKE '%decode%'
        OR oq.last_error ILIKE '%├ğ├Âz├╝lemedi%'
        OR oq.last_error ILIKE '%GCLID%'
      )
  )
  SELECT
    COALESCE(c.caller_phone_e164, c.phone_number) AS raw_phone_string,
    c.phone_source_type,
    (SELECT default_country_iso FROM site_country) AS detected_country_iso,
    (EXTRACT(EPOCH FROM (SELECT t FROM conv_time)) * 1000)::bigint AS event_timestamp_utc_ms,
    (EXTRACT(EPOCH FROM (SELECT first_at FROM first_touch)) * 1000)::bigint AS first_fingerprint_touch_utc_ms,
    c.user_agent AS user_agent_raw,
    (SELECT has_gclid FROM gclid_90d) AS historical_gclid_presence,
    CASE
      WHEN c.caller_phone_e164 IS NOT NULL THEN 1.0
      WHEN length(regexp_replace(COALESCE(c.phone_number, ''), '\D', '', 'g')) BETWEEN 10 AND 15 THEN 1.0
      WHEN length(regexp_replace(COALESCE(c.phone_number, ''), '\D', '', 'g')) >= 7 THEN 0.5
      ELSE 0.3
    END::numeric AS identity_resolution_score,
    (SELECT chain FROM touchpoints_14d) AS touchpoint_entropy,
    (SELECT reason FROM link_reason) AS cross_device_fingerprint_link,
    jsonb_build_object('raw_phone_string', COALESCE(c.caller_phone_raw, c.phone_number), 'raw_user_agent', c.user_agent) AS pre_normalization_snapshot,
    (SELECT mode FROM failure_bucket) AS failure_mode,
    (SELECT cnt FROM discarded_clids) AS clids_discarded_count
  FROM c;
$$;


ALTER FUNCTION "public"."get_attribution_forensic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_attribution_forensic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") IS 'Forensic: raw_phone_string=COALESCE(caller_phone_e164,phone_number). identity_resolution_score=1 when operator-verified. pre_normalization_snapshot uses caller_phone_raw when set.';



CREATE OR REPLACE FUNCTION "public"."get_call_session_for_oci"("p_call_id" "uuid", "p_site_id" "uuid") RETURNS TABLE("matched_session_id" "uuid", "gclid" "text", "wbraid" "text", "gbraid" "text", "utm_source" "text", "utm_medium" "text", "utm_campaign" "text", "utm_content" "text", "utm_term" "text", "referrer_host" "text", "consent_scopes" "text"[], "conversion_time_formatted" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    c.matched_session_id,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.utm_source,
    s.utm_medium,
    s.utm_campaign,
    s.utm_content,
    s.utm_term,
    s.referrer_host,
    s.consent_scopes,
    to_char(
      COALESCE(c.confirmed_at, c.created_at, oq.created_at) AT TIME ZONE COALESCE(st.timezone, 'Europe/Istanbul'),
      'YYYYMMDD HH24MISS'
    ) AS conversion_time_formatted
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id
    AND s.site_id = c.site_id
    AND s.created_month = c.session_created_month
  LEFT JOIN public.sites st ON st.id = c.site_id
  LEFT JOIN public.offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_call_session_for_oci"("p_call_id" "uuid", "p_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_call_session_for_oci"("p_call_id" "uuid", "p_site_id" "uuid") IS 'OCI: partition pruning via session_created_month. No COALESCE. conversion_time_formatted included.';



CREATE OR REPLACE FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_pending int;
  v_sealed int;
  v_junk int;
  v_auto_approved int;
  v_oci_uploaded int;
  v_oci_failed int;
  v_oci_matchable_sealed int;
  v_assumed_cpc numeric;
  v_currency text;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT COALESCE(s.assumed_cpc, 0), COALESCE(s.currency, 'TRY')
  INTO v_assumed_cpc, v_currency
  FROM public.sites s
  WHERE s.id = p_site_id;

  -- Pending queue (unqualified intents)
  SELECT COUNT(*)::int INTO v_pending
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Sealed today (manual or auto)
  SELECT COUNT(*)::int INTO v_sealed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Junk today
  SELECT COUNT(*)::int INTO v_junk
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'junk'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Auto-approved today (heuristic: score_breakdown.auto_approved = true)
  SELECT COUNT(*)::int INTO v_auto_approved
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'confirmed'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (c.score_breakdown->>'auto_approved')::boolean IS TRUE;

  -- OCI pipeline counts
  SELECT
    COUNT(*) FILTER (WHERE c.oci_status = 'uploaded')::int,
    COUNT(*) FILTER (WHERE c.oci_status = 'failed')::int
  INTO v_oci_uploaded, v_oci_failed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to;

  -- Matchable sealed (ready to upload / matchable)
  SELECT COUNT(*)::int INTO v_oci_matchable_sealed
  FROM public.calls c
  JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public.is_ads_session(s)
    AND (
      COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    );

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,

    'queue_pending', COALESCE(v_pending, 0),
    'sealed', COALESCE(v_sealed, 0),
    'junk', COALESCE(v_junk, 0),
    'auto_approved', COALESCE(v_auto_approved, 0),

    'oci_uploaded', COALESCE(v_oci_uploaded, 0),
    'oci_failed', COALESCE(v_oci_failed, 0),
    'oci_matchable_sealed', COALESCE(v_oci_matchable_sealed, 0),

    'assumed_cpc', COALESCE(v_assumed_cpc, 0),
    'currency', v_currency,
    'estimated_budget_saved', ROUND(COALESCE(v_junk, 0)::numeric * COALESCE(v_assumed_cpc, 0), 2),

    'inbox_zero_now', (COALESCE(v_pending, 0) = 0)
  );
END;
$$;


ALTER FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) IS 'Command Center P0 stats: queue/gamification + OCI pipeline counters (caller provides date range).';



CREATE OR REPLACE FUNCTION "public"."get_command_center_p0_stats_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_total_sessions int;
  v_pending int;
  v_sealed int;
  v_junk int;
  v_auto_approved int;
  v_oci_uploaded int;
  v_oci_failed int;
  v_oci_matchable_sealed int;
  v_assumed_cpc numeric;
  v_currency text;
  v_revenue numeric;

  -- Enterprise Metrics (funnel)
  v_total_leads int;
  v_gclid_leads int;
  v_avg_scroll numeric;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := (DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month')::date;

  SELECT COALESCE(s.assumed_cpc, 0), COALESCE(s.currency, 'TRY')
  INTO v_assumed_cpc, v_currency
  FROM public.sites s
  WHERE s.id = p_site_id;

  -- Valid sessions: exclude zombie traffic (0 events OR <2 seconds)
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_total_sessions FROM valid_sessions;

  -- Incoming intents (Total Leads): count intents tied to valid sessions.
  -- Edge-case protection: if a call is sealed, count it even if session is zombie.
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_total_leads
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      EXISTS (SELECT 1 FROM valid_sessions vs WHERE vs.id = c.matched_session_id)
      OR c.status IN ('confirmed','qualified','real')
    )
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- GCLID Leads (Ads-verified leads): same validity rule as total_leads
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_gclid_leads
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    )
    AND (
      EXISTS (SELECT 1 FROM valid_sessions vs WHERE vs.id = c.matched_session_id)
      OR c.status IN ('confirmed','qualified','real')
    )
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Avg Scroll Depth: compute over valid sessions
  SELECT COALESCE(AVG(s.max_scroll_percentage), 0)::numeric INTO v_avg_scroll
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND COALESCE(s.event_count, 0) > 0
    AND COALESCE(s.total_duration_sec, 0) >= 2
    AND (
      p_ads_only = false
      OR public.is_ads_session(s)
    );

  -- Pending queue: only intents tied to valid sessions
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_pending
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND EXISTS (SELECT 1 FROM valid_sessions vs WHERE vs.id = c.matched_session_id)
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Sealed count (created_at basis; not filtered by session validity)
  SELECT COUNT(*)::int
  INTO v_sealed
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Revenue projection (accrual basis): created_at within [from, to)
  -- Intent date (when lead came in) determines which day's kasa it belongs to.
  -- Sealing a yesterday intent today keeps its revenue in yesterday.
  SELECT SUM(COALESCE(c.sale_amount, 0))::numeric
  INTO v_revenue
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Junk: keep as-is (not validity-filtered; it's an operator action)
  SELECT COUNT(*)::int INTO v_junk
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'junk'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Auto-approved (subset of sealed): keep as-is
  SELECT COUNT(*)::int INTO v_auto_approved
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'confirmed'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (c.score_breakdown->>'auto_approved')::boolean IS TRUE;

  -- OCI pipeline counts (unchanged)
  SELECT
    COUNT(*) FILTER (WHERE c.oci_status = 'uploaded')::int,
    COUNT(*) FILTER (WHERE c.oci_status = 'failed')::int
  INTO v_oci_uploaded, v_oci_failed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to;

  -- Matchable sealed (unchanged)
  SELECT COUNT(*)::int INTO v_oci_matchable_sealed
  FROM public.calls c
  JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public.is_ads_session(s)
    AND (
      COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    );

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,

    'total_sessions', COALESCE(v_total_sessions, 0),
    'queue_pending', COALESCE(v_pending, 0),
    'sealed', COALESCE(v_sealed, 0),
    'junk', COALESCE(v_junk, 0),
    'auto_approved', COALESCE(v_auto_approved, 0),

    'oci_uploaded', COALESCE(v_oci_uploaded, 0),
    'oci_failed', COALESCE(v_oci_failed, 0),
    'oci_matchable_sealed', COALESCE(v_oci_matchable_sealed, 0),

    'assumed_cpc', COALESCE(v_assumed_cpc, 0),
    'currency', v_currency,
    'estimated_budget_saved', ROUND(COALESCE(v_junk, 0)::numeric * COALESCE(v_assumed_cpc, 0), 2),
    'projected_revenue', COALESCE(v_revenue, 0),

    -- Leads came in (created_at basis)
    'total_leads', COALESCE(v_total_leads, 0),
    'incoming_intents', COALESCE(v_total_leads, 0),
    'gclid_leads', COALESCE(v_gclid_leads, 0),
    'avg_scroll_depth', ROUND(COALESCE(v_avg_scroll, 0), 1),

    'inbox_zero_now', (COALESCE(v_pending, 0) = 0)
  );
END;
$$;


ALTER FUNCTION "public"."get_command_center_p0_stats_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customer_invite_audit_v1"("p_site_id" "uuid", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_email_query" "text" DEFAULT NULL::"text", "p_outcome" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_customer_invite_audit_v1"("p_site_id" "uuid", "p_limit" integer, "p_offset" integer, "p_email_query" "text", "p_outcome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text") RETURNS "jsonb"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_total_count bigint;
  v_result jsonb[];
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Validate dimension
  IF p_dimension NOT IN ('source', 'device', 'city') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be source, device, or city', p_dimension;
  END IF;
  
  -- Calculate month boundaries
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  -- Get total count for percentage calculation
  SELECT COUNT(*) INTO v_total_count
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at <= p_date_to;
  
  -- Aggregate by dimension
  CASE p_dimension
    WHEN 'source' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(attribution_source, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT attribution_source, COUNT(*) as count
        FROM public.sessions
        WHERE site_id = p_site_id
          AND created_month >= v_start_month
          AND created_month < v_end_month
          AND created_at >= p_date_from
          AND created_at <= p_date_to
        GROUP BY attribution_source
      ) breakdown;
    
    WHEN 'device' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(device_type, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT device_type, COUNT(*) as count
        FROM public.sessions
        WHERE site_id = p_site_id
          AND created_month >= v_start_month
          AND created_month < v_end_month
          AND created_at >= p_date_from
          AND created_at <= p_date_to
        GROUP BY device_type
      ) breakdown;
    
    WHEN 'city' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(city, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT city, COUNT(*) as count
        FROM public.sessions
        WHERE site_id = p_site_id
          AND created_month >= v_start_month
          AND created_month < v_end_month
          AND created_at >= p_date_from
          AND created_at <= p_date_to
        GROUP BY city
      ) breakdown;
  END CASE;
  
  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;


ALTER FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text", "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_total_count bigint;
  v_result jsonb[];
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  IF p_dimension NOT IN ('source', 'device', 'city') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be source, device, or city', p_dimension;
  END IF;

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT COUNT(*) INTO v_total_count
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at <= p_date_to
    AND (p_ads_only = false OR public.is_ads_session(s));

  CASE p_dimension
    WHEN 'source' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(attribution_source, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT s.attribution_source, COUNT(*) as count
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at <= p_date_to
          AND (p_ads_only = false OR public.is_ads_session(s))
        GROUP BY s.attribution_source
      ) breakdown;

    WHEN 'device' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(device_type, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT s.device_type, COUNT(*) as count
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at <= p_date_to
          AND (p_ads_only = false OR public.is_ads_session(s))
        GROUP BY s.device_type
      ) breakdown;

    WHEN 'city' THEN
      SELECT array_agg(
        jsonb_build_object(
          'dimension_value', COALESCE(city, 'Unknown'),
          'count', count,
          'percentage', CASE WHEN v_total_count > 0 THEN ROUND((count::numeric / v_total_count::numeric) * 100, 2) ELSE 0 END
        )
        ORDER BY count DESC
      ) INTO v_result
      FROM (
        SELECT s.city, COUNT(*) as count
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at <= p_date_to
          AND (p_ads_only = false OR public.is_ads_session(s))
        GROUP BY s.city
      ) breakdown;
  END CASE;

  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;


ALTER FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text", "p_ads_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_breakdown_p4"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_sources jsonb;
  v_locations jsonb;
  v_devices jsonb;
  v_total_sessions bigint;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  -- Total sessions in range (for percentages). p_ads_only=true: STRICT click-id only.
  SELECT COUNT(*) INTO v_total_sessions
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s));

  v_total_sessions := COALESCE(v_total_sessions, 0);

  -- Sources: top 5 + Other. Dimension = COALESCE(NULLIF(TRIM(attribution_source),''), 'Unknown').
  WITH base AS (
    SELECT COALESCE(NULLIF(BTRIM(COALESCE(s.attribution_source, '')), ''), 'Unknown') AS dim
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s))
  ),
  agg AS (
    SELECT dim, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY dim
    ORDER BY cnt DESC
  ),
  top5 AS (
    SELECT dim, cnt, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS rn FROM agg
  ),
  with_other AS (
    SELECT
      CASE WHEN rn <= 5 THEN dim ELSE 'Other' END AS label,
      cnt
    FROM top5
  ),
  merged AS (
    SELECT label, SUM(cnt)::bigint AS cnt
    FROM with_other
    GROUP BY label
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', label,
      'count', cnt,
      'percentage', CASE WHEN v_total_sessions > 0 THEN ROUND((cnt::numeric / v_total_sessions::numeric) * 100, 2) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_sources
  FROM merged;

  -- Locations: top 8 + Other. District preferred, fallback city. NULL/empty -> 'Unknown'.
  WITH base AS (
    SELECT COALESCE(
      NULLIF(BTRIM(COALESCE(s.district, '')), ''),
      NULLIF(BTRIM(COALESCE(s.city, '')), ''),
      'Unknown'
    ) AS dim
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s))
  ),
  agg AS (
    SELECT dim, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY dim
    ORDER BY cnt DESC
  ),
  top8 AS (
    SELECT dim, cnt, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS rn FROM agg
  ),
  with_other AS (
    SELECT
      CASE WHEN rn <= 8 THEN dim ELSE 'Other' END AS label,
      cnt
    FROM top8
  ),
  merged AS (
    SELECT label, SUM(cnt)::bigint AS cnt
    FROM with_other
    GROUP BY label
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', label,
      'count', cnt,
      'percentage', CASE WHEN v_total_sessions > 0 THEN ROUND((cnt::numeric / v_total_sessions::numeric) * 100, 2) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_locations
  FROM merged;

  -- Devices: 3 buckets (Mobile, Desktop, Other) + Unknown. NULL/empty -> 'Unknown'.
  WITH base AS (
    SELECT
      CASE
        WHEN NULLIF(BTRIM(COALESCE(s.device_type, '')), '') IS NULL THEN 'Unknown'
        WHEN LOWER(TRIM(s.device_type)) IN ('mobile', 'phone', 'tablet')
          OR LOWER(TRIM(s.device_type)) LIKE '%mobile%'
          OR LOWER(TRIM(s.device_type)) LIKE '%phone%'
          OR LOWER(TRIM(s.device_type)) LIKE '%tablet%' THEN 'Mobile'
        WHEN LOWER(TRIM(s.device_type)) LIKE '%desktop%' THEN 'Desktop'
        ELSE 'Other'
      END AS dim
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND (NOT p_ads_only OR public.is_ads_session_click_id_only(s))
  ),
  agg AS (
    SELECT dim, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY dim
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', dim,
      'count', cnt,
      'percentage', CASE WHEN v_total_sessions > 0 THEN ROUND((cnt::numeric / v_total_sessions::numeric) * 100, 2) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_devices
  FROM agg;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,
    'total_sessions', v_total_sessions,
    'sources', COALESCE(v_sources, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb),
    'devices', COALESCE(v_devices, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_dashboard_breakdown_p4"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_dashboard_breakdown_p4"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) IS 'P4-1 Breakdown: sources (top 5 + Other), locations (top 8 + Other), devices (Mobile/Desktop/Other + Unknown). p_ads_only=true uses click-id only.';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month_from date;
  v_month_to date;
  v_total bigint;
  v_sources jsonb;
  v_locations jsonb;
  v_devices jsonb;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_month_from := DATE_TRUNC('month', p_date_from)::date;
  v_month_to   := DATE_TRUNC('month', p_date_to)::date;

  -- Total sessions: half-open [from, to)
  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to
    AND (NOT p_ads_only OR public.is_ads_session(s));

  v_total := COALESCE(v_total, 0);

  -- Sources: ads_only=true stays simplified; ads_only=false uses traffic_source (canonical).
  IF p_ads_only THEN
    v_sources := jsonb_build_array(
      jsonb_build_object('name', 'Google Ads', 'count', v_total, 'pct', CASE WHEN v_total > 0 THEN ROUND(100.0, 1) ELSE 0 END),
      jsonb_build_object('name', 'Other', 'count', 0, 'pct', 0)
    );
  ELSE
    WITH base AS (
      SELECT
        COALESCE(
          NULLIF(BTRIM(COALESCE(s.traffic_source, '')), ''),
          -- Fallbacks for older rows where traffic_source may be missing
          CASE
            WHEN public.is_ads_session(s) THEN 'Google Ads'
            WHEN s.attribution_source IS NOT NULL AND s.attribution_source ILIKE '%Paid Social%' THEN 'Paid Social'
            WHEN s.attribution_source IS NOT NULL AND s.attribution_source ILIKE '%Organic%' THEN 'SEO'
            WHEN s.referrer_host IS NOT NULL AND BTRIM(s.referrer_host) <> '' THEN 'Referral'
            ELSE 'Direct'
          END
        ) AS bucket
      FROM public.sessions s
      WHERE s.site_id = p_site_id
        AND s.created_at >= p_date_from
        AND s.created_at < p_date_to
        AND s.created_month BETWEEN v_month_from AND v_month_to
    ),
    agg AS (
      SELECT bucket, COUNT(*)::bigint AS cnt
      FROM base
      GROUP BY bucket
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', bucket,
        'count', cnt,
        'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
      )
      ORDER BY cnt DESC
    ) INTO v_sources
    FROM agg;
    v_sources := COALESCE(v_sources, '[]'::jsonb);
  END IF;

  -- Locations (Merkez-safe) ÔÇö keep same logic, but half-open range.
  WITH base AS (
    SELECT
      CASE
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') = 'Merkez'
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.city) || ' (Merkez)'
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') IS NOT NULL
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
             AND BTRIM(s.district) = BTRIM(s.city)
        THEN BTRIM(s.city)
        WHEN NULLIF(BTRIM(COALESCE(s.district, '')), '') IS NOT NULL
             AND NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.district) || ' / ' || BTRIM(s.city)
        WHEN NULLIF(BTRIM(COALESCE(s.city, '')), '') IS NOT NULL
        THEN BTRIM(s.city)
        ELSE 'Unknown'
      END AS loc
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND s.created_month BETWEEN v_month_from AND v_month_to
      AND (NOT p_ads_only OR public.is_ads_session(s))
  ),
  agg AS (
    SELECT loc, COUNT(*)::bigint AS cnt FROM base GROUP BY loc ORDER BY COUNT(*) DESC
  ),
  ranked AS (
    SELECT loc, cnt, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS rn FROM agg
  ),
  merged AS (
    SELECT CASE WHEN rn <= 8 THEN loc ELSE 'Other' END AS name, SUM(cnt)::bigint AS cnt
    FROM ranked GROUP BY CASE WHEN rn <= 8 THEN loc ELSE 'Other' END
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', name,
      'count', cnt,
      'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_locations
  FROM merged;
  v_locations := COALESCE(v_locations, '[]'::jsonb);

  -- Devices: half-open range.
  WITH base AS (
    SELECT
      CASE
        WHEN NULLIF(BTRIM(COALESCE(s.device_type, '')), '') IS NULL THEN 'Unknown'
        WHEN LOWER(s.device_type) LIKE '%mobile%' THEN 'Mobile'
        WHEN LOWER(s.device_type) LIKE '%desktop%' THEN 'Desktop'
        ELSE 'Other'
      END AS bucket
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND s.created_month BETWEEN v_month_from AND v_month_to
      AND (NOT p_ads_only OR public.is_ads_session(s))
  ),
  agg AS (
    SELECT bucket, COUNT(*)::bigint AS cnt FROM base GROUP BY bucket
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', bucket,
      'count', cnt,
      'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
    ) ORDER BY cnt DESC
  ) INTO v_devices
  FROM agg;
  v_devices := COALESCE(v_devices, '[]'::jsonb);

  RETURN jsonb_build_object(
    'total_sessions', v_total,
    'sources', v_sources,
    'locations', v_locations,
    'devices', v_devices
  );
END;
$$;


ALTER FUNCTION "public"."get_dashboard_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_dashboard_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) IS 'Dashboard breakdown v1 (unified): sources use sessions.traffic_source (canonical), locations handle Merkez, devices buckets. Half-open ranges [from,to). ads_only=true filters is_ads_session(s).';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text") RETURNS "jsonb"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_result jsonb[];
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Calculate month boundaries
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  -- Combine calls and conversion events
  WITH intents AS (
    -- Calls
    SELECT
      c.id::text as id,
      'call'::text as type,
      c.created_at as timestamp,
      c.status,
      c.confirmed_at as sealed_at,
      COALESCE(
        (SELECT e.url FROM public.events e 
         WHERE e.session_id = c.matched_session_id 
           AND e.session_month = s.created_month
         ORDER BY e.created_at ASC 
         LIMIT 1),
        ''
      ) as page_url,
      s.city,
      s.district,
      s.device_type,
      c.matched_session_id,
      COALESCE(c.lead_score, 0) as confidence_score,
      c.phone_number,
      NULL::text as event_category,
      NULL::text as event_action
    FROM public.calls c
    LEFT JOIN public.sessions s ON c.matched_session_id = s.id AND s.created_month >= v_start_month AND s.created_month < v_end_month
    WHERE c.site_id = p_site_id
      AND c.created_at >= p_date_from
      AND c.created_at <= p_date_to
      AND (p_status IS NULL OR 
           (p_status = 'pending' AND (c.status = 'intent' OR c.status IS NULL)) OR
           (p_status = 'sealed' AND c.status IN ('confirmed', 'qualified', 'real')) OR
           c.status = p_status)
      AND (p_search IS NULL OR 
           COALESCE(
             (SELECT e.url FROM public.events e 
              WHERE e.session_id = c.matched_session_id 
                AND e.session_month = s.created_month
              ORDER BY e.created_at ASC 
              LIMIT 1),
             ''
           ) ILIKE '%' || p_search || '%')
    
    UNION ALL
    
    -- Conversion events
    SELECT
      'conv-' || e.id as id,
      'conversion'::text as type,
      e.created_at as timestamp,
      'confirmed'::text as status,
      e.created_at as sealed_at,
      COALESCE(e.url, '') as page_url,
      s.city,
      s.district,
      s.device_type,
      e.session_id as matched_session_id,
      COALESCE(e.event_value, 0) as confidence_score,
      NULL::text as phone_number,
      e.event_category,
      e.event_action
    FROM public.events e
    JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
    WHERE s.site_id = p_site_id
      AND e.event_category = 'conversion'
      AND e.session_month >= v_start_month
      AND e.session_month < v_end_month
      AND e.created_at >= p_date_from
      AND e.created_at <= p_date_to
      AND (p_status IS NULL OR p_status = 'sealed')
      AND (p_search IS NULL OR COALESCE(e.url, '') ILIKE '%' || p_search || '%')
  )
  SELECT array_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'timestamp', timestamp,
      'status', status,
      'sealed_at', sealed_at,
      'page_url', page_url,
      'city', city,
      'district', district,
      'device_type', device_type,
      'matched_session_id', matched_session_id,
      'confidence_score', confidence_score,
      'phone_number', phone_number,
      'event_category', event_category,
      'event_action', event_action
    )
    ORDER BY timestamp DESC
  ) INTO v_result
  FROM intents;
  
  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;


ALTER FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_result jsonb[];
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  WITH intents AS (
    -- Calls (ads_only: require matched Ads session)
    SELECT
      c.id::text as id,
      'call'::text as type,
      c.created_at as timestamp,
      c.status,
      c.confirmed_at as sealed_at,
      COALESCE(
        (SELECT e.url FROM public.events e
         WHERE e.session_id = c.matched_session_id
           AND e.session_month = s.created_month
         ORDER BY e.created_at ASC
         LIMIT 1),
        ''
      ) as page_url,
      s.city,
      s.district,
      s.device_type,
      c.matched_session_id,
      COALESCE(c.lead_score, 0) as confidence_score,
      c.phone_number,
      NULL::text as event_category,
      NULL::text as event_action
    FROM public.calls c
    LEFT JOIN public.sessions s
      ON c.matched_session_id = s.id
     AND s.created_month >= v_start_month
     AND s.created_month < v_end_month
    WHERE c.site_id = p_site_id
      AND c.created_at >= p_date_from
      AND c.created_at <= p_date_to
      AND (p_status IS NULL OR
           (p_status = 'pending' AND (c.status = 'intent' OR c.status IS NULL)) OR
           (p_status = 'sealed' AND c.status IN ('confirmed', 'qualified', 'real')) OR
           c.status = p_status)
      AND (p_search IS NULL OR
           COALESCE(
             (SELECT e.url FROM public.events e
              WHERE e.session_id = c.matched_session_id
                AND e.session_month = s.created_month
              ORDER BY e.created_at ASC
              LIMIT 1),
             ''
           ) ILIKE '%' || p_search || '%')
      AND (
        p_ads_only = false
        OR (s.id IS NOT NULL AND public.is_ads_session(s))
      )

    UNION ALL

    -- Conversion events (ads_only: require Ads session)
    SELECT
      'conv-' || e.id as id,
      'conversion'::text as type,
      e.created_at as timestamp,
      'confirmed'::text as status,
      e.created_at as sealed_at,
      COALESCE(e.url, '') as page_url,
      s.city,
      s.district,
      s.device_type,
      e.session_id as matched_session_id,
      COALESCE(e.event_value, 0) as confidence_score,
      NULL::text as phone_number,
      e.event_category,
      e.event_action
    FROM public.events e
    JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
    WHERE s.site_id = p_site_id
      AND e.event_category = 'conversion'
      AND e.session_month >= v_start_month
      AND e.session_month < v_end_month
      AND e.created_at >= p_date_from
      AND e.created_at <= p_date_to
      AND (p_status IS NULL OR p_status = 'sealed')
      AND (p_search IS NULL OR COALESCE(e.url, '') ILIKE '%' || p_search || '%')
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT array_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'timestamp', timestamp,
      'status', status,
      'sealed_at', sealed_at,
      'page_url', page_url,
      'city', city,
      'district', district,
      'device_type', device_type,
      'matched_session_id', matched_session_id,
      'confidence_score', confidence_score,
      'phone_number', phone_number,
      'event_category', event_category,
      'event_action', event_action
    )
    ORDER BY timestamp DESC
  ) INTO v_result
  FROM intents;

  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;


ALTER FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text", "p_ads_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_result jsonb;
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Calculate month boundaries for partition filtering
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  WITH stats AS (
    SELECT
      (SELECT COUNT(*)::int 
       FROM public.calls 
       WHERE site_id = p_site_id 
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as total_calls,
      (SELECT COUNT(*)::int 
       FROM public.calls 
       WHERE site_id = p_site_id 
         AND status = 'confirmed' 
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as confirmed_calls,
      (SELECT MAX(created_at) 
       FROM public.calls 
       WHERE site_id = p_site_id 
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as last_call_at,
      (SELECT COUNT(*)::int 
       FROM public.sessions 
       WHERE site_id = p_site_id 
         AND created_month >= v_start_month 
         AND created_month < v_end_month
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as total_sessions,
      (SELECT COUNT(DISTINCT fingerprint)::int 
       FROM public.sessions 
       WHERE site_id = p_site_id 
         AND created_month >= v_start_month 
         AND created_month < v_end_month
         AND created_at >= p_date_from 
         AND created_at <= p_date_to) as unique_visitors,
      (SELECT COUNT(*)::int 
       FROM public.events e
       JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
       WHERE s.site_id = p_site_id 
         AND e.session_month >= v_start_month 
         AND e.session_month < v_end_month
         AND e.created_at >= p_date_from 
         AND e.created_at <= p_date_to
         AND e.event_category != 'heartbeat') as total_events,
      (SELECT MAX(e.created_at)
       FROM public.events e
       JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
       WHERE s.site_id = p_site_id 
         AND e.session_month >= v_start_month 
         AND e.session_month < v_end_month
         AND e.created_at >= p_date_from 
         AND e.created_at <= p_date_to
         AND e.event_category != 'heartbeat') as last_event_at
  )
  SELECT jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'total_calls', total_calls,
    'total_events', total_events,
    'total_sessions', total_sessions,
    'unique_visitors', unique_visitors,
    'confirmed_calls', confirmed_calls,
    'conversion_rate', CASE WHEN unique_visitors > 0 THEN ROUND((confirmed_calls::numeric / unique_visitors::numeric), 4) ELSE 0 END,
    'last_event_at', last_event_at,
    'last_call_at', last_call_at
  ) INTO v_result
  FROM stats;
  
  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) IS 'v2.2: Dashboard stats with date_from/date_to contract. Legacy p_days signature removed.';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;

  v_ads_sessions int;
  v_high_intent int;
  v_phone_click_intents int;
  v_whatsapp_click_intents int;
  v_sealed int;

  v_total_events int;
  v_forms int;
  v_forms_enabled boolean;
  v_last_event_at timestamptz;
  v_last_call_at timestamptz;

  v_forms_window_from timestamptz;
  v_forms_start_month date;
  v_forms_end_month date;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  -- Ads sessions in-range (half-open)
  SELECT COUNT(*)::int INTO v_ads_sessions
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND (p_ads_only = false OR public.is_ads_session(s));

  -- Click intents breakdown (phone/whatsapp) + legacy high_intent (phone+whatsapp)
  SELECT
    COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL))::int,
    COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL) AND c.intent_action = 'phone')::int,
    COUNT(*) FILTER (WHERE c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL) AND c.intent_action = 'whatsapp')::int
  INTO v_high_intent, v_phone_click_intents, v_whatsapp_click_intents
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Sealed calls (half-open)
  SELECT COUNT(*)::int INTO v_sealed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Events total + last + forms (form_submit) within range (half-open)
  SELECT
    COUNT(*)::int,
    MAX(e.created_at),
    COUNT(*) FILTER (WHERE e.event_category = 'conversion' AND e.event_action = 'form_submit')::int
  INTO v_total_events, v_last_event_at, v_forms
  FROM public.events e
  JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
  WHERE s.site_id = p_site_id
    AND e.session_month >= v_start_month
    AND e.session_month < v_end_month
    AND e.created_at >= p_date_from
    AND e.created_at < p_date_to
    AND e.event_category != 'heartbeat'
    AND (p_ads_only = false OR public.is_ads_session(s));

  -- Last call in-range (half-open)
  SELECT MAX(c.created_at) INTO v_last_call_at
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Forms enabled heuristic (site capability): any form_submit in last 365 days (bounded by partitions)
  v_forms_window_from := p_date_to - INTERVAL '365 days';
  v_forms_start_month := DATE_TRUNC('month', v_forms_window_from)::date;
  v_forms_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT EXISTS(
    SELECT 1
    FROM public.events e
    JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
    WHERE s.site_id = p_site_id
      AND e.session_month >= v_forms_start_month
      AND e.session_month < v_forms_end_month
      AND e.created_at >= v_forms_window_from
      AND e.created_at < p_date_to
      AND e.event_category = 'conversion'
      AND e.event_action = 'form_submit'
      AND (p_ads_only = false OR public.is_ads_session(s))
    LIMIT 1
  ) INTO v_forms_enabled;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,

    'ads_sessions', COALESCE(v_ads_sessions, 0),
    'high_intent', COALESCE(v_high_intent, 0),
    'phone_click_intents', COALESCE(v_phone_click_intents, 0),
    'whatsapp_click_intents', COALESCE(v_whatsapp_click_intents, 0),
    'forms', COALESCE(v_forms, 0),
    'forms_enabled', COALESCE(v_forms_enabled, false),
    'sealed', COALESCE(v_sealed, 0),
    'cvr', CASE WHEN COALESCE(v_ads_sessions, 0) > 0 THEN ROUND((v_sealed::numeric / v_ads_sessions::numeric), 4) ELSE 0 END,

    -- Backward-compat
    'total_sessions', COALESCE(v_ads_sessions, 0),
    'total_calls', COALESCE(v_high_intent, 0),
    'confirmed_calls', COALESCE(v_sealed, 0),
    'conversion_rate', CASE WHEN COALESCE(v_ads_sessions, 0) > 0 THEN ROUND((v_sealed::numeric / v_ads_sessions::numeric), 4) ELSE 0 END,
    'total_events', COALESCE(v_total_events, 0),
    'unique_visitors', 0,
    'last_event_at', v_last_event_at,
    'last_call_at', v_last_call_at
  );
END;
$$;


ALTER FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats_v1"("p_site_id" "uuid", "p_days" integer DEFAULT 7) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_start_date timestamptz;
    v_start_month date;
    v_result jsonb;
BEGIN
    v_start_date := NOW() - (p_days || ' days')::interval;
    v_start_month := DATE_TRUNC('month', v_start_date)::date;

    WITH stats AS (
        SELECT
            (SELECT COUNT(*)::int FROM public.calls WHERE site_id = p_site_id AND created_at >= v_start_date) as total_calls,
            (SELECT COUNT(*)::int FROM public.calls WHERE site_id = p_site_id AND status = 'confirmed' AND created_at >= v_start_date) as confirmed_calls,
            (SELECT MAX(created_at) FROM public.calls WHERE site_id = p_site_id) as last_call_at,
            (SELECT COUNT(*)::int FROM public.sessions WHERE site_id = p_site_id AND created_month >= v_start_month AND created_at >= v_start_date) as total_sessions,
            (SELECT COUNT(DISTINCT fingerprint)::int FROM public.sessions WHERE site_id = p_site_id AND created_month >= v_start_month AND created_at >= v_start_date) as unique_visitors,
            (SELECT COUNT(*)::int 
             FROM public.events e
             JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
             WHERE s.site_id = p_site_id 
               AND e.session_month >= v_start_month 
               AND e.created_at >= v_start_date) as total_events,
            (SELECT MAX(e.created_at)
             FROM public.events e
             JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
             WHERE s.site_id = p_site_id 
               AND e.session_month >= v_start_month) as last_event_at
    )
    SELECT jsonb_build_object(
        'site_id', p_site_id,
        'range_days', p_days,
        'total_calls', total_calls,
        'total_events', total_events,
        'total_sessions', total_sessions,
        'unique_visitors', unique_visitors,
        'confirmed_calls', confirmed_calls,
        'conversion_rate', CASE WHEN unique_visitors > 0 THEN ROUND((confirmed_calls::numeric / unique_visitors::numeric), 4) ELSE 0 END,
        'last_event_at', last_event_at,
        'last_call_at', last_call_at
    ) INTO v_result
    FROM stats;

    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_stats_v1"("p_site_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text" DEFAULT 'auto'::"text") RETURNS "jsonb"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_range_days int;
  v_effective_granularity text;
  v_result jsonb[];
BEGIN
  -- Validate date range
  PERFORM validate_date_range(p_date_from, p_date_to);
  
  -- Calculate month boundaries
  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';
  
  -- Determine granularity
  v_range_days := EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 86400;
  
  IF p_granularity = 'auto' THEN
    IF v_range_days <= 7 THEN
      v_effective_granularity := 'hour';
    ELSIF v_range_days <= 30 THEN
      v_effective_granularity := 'day';
    ELSE
      v_effective_granularity := 'week';
    END IF;
  ELSE
    v_effective_granularity := p_granularity;
  END IF;
  
  -- Aggregate by time bucket (separate aggregations for efficiency)
  WITH time_buckets AS (
    SELECT
      bucket_time,
      COALESCE(SUM(visitors), 0) as visitors,
      COALESCE(SUM(events), 0) as events,
      COALESCE(SUM(calls), 0) as calls,
      COALESCE(SUM(intents), 0) as intents,
      COALESCE(SUM(conversions), 0) as conversions
    FROM (
      -- Sessions (visitors by fingerprint)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', created_at)
          WHEN 'day' THEN DATE_TRUNC('day', created_at)
          WHEN 'week' THEN DATE_TRUNC('week', created_at)
          ELSE DATE_TRUNC('day', created_at)
        END as bucket_time,
        COUNT(DISTINCT fingerprint) as visitors,
        0::bigint as events,
        0::bigint as calls,
        0::bigint as intents,
        0::bigint as conversions
      FROM public.sessions
      WHERE site_id = p_site_id
        AND created_month >= v_start_month
        AND created_month < v_end_month
        AND created_at >= p_date_from
        AND created_at <= p_date_to
      GROUP BY bucket_time
      
      UNION ALL
      
      -- Events (exclude heartbeats)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', e.created_at)
          WHEN 'day' THEN DATE_TRUNC('day', e.created_at)
          WHEN 'week' THEN DATE_TRUNC('week', e.created_at)
          ELSE DATE_TRUNC('day', e.created_at)
        END as bucket_time,
        0::bigint as visitors,
        COUNT(*) as events,
        0::bigint as calls,
        0::bigint as intents,
        COUNT(*) FILTER (WHERE e.event_category = 'conversion') as conversions
      FROM public.events e
      JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
      WHERE s.site_id = p_site_id
        AND e.session_month >= v_start_month
        AND e.session_month < v_end_month
        AND e.created_at >= p_date_from
        AND e.created_at <= p_date_to
        AND e.event_category != 'heartbeat'
      GROUP BY bucket_time
      
      UNION ALL
      
      -- Calls
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', created_at)
          WHEN 'day' THEN DATE_TRUNC('day', created_at)
          WHEN 'week' THEN DATE_TRUNC('week', created_at)
          ELSE DATE_TRUNC('day', created_at)
        END as bucket_time,
        0::bigint as visitors,
        0::bigint as events,
        COUNT(*) as calls,
        COUNT(*) FILTER (WHERE status = 'intent') as intents,
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'qualified', 'real')) as conversions
      FROM public.calls
      WHERE site_id = p_site_id
        AND created_at >= p_date_from
        AND created_at <= p_date_to
      GROUP BY bucket_time
    ) combined
    GROUP BY bucket_time
    ORDER BY bucket_time
  )
  SELECT COALESCE(
    array_agg(
      jsonb_build_object(
        'date', bucket_time::text,
        'label', CASE v_effective_granularity
          WHEN 'hour' THEN TO_CHAR(bucket_time, 'HH24:MI')
          WHEN 'day' THEN TO_CHAR(bucket_time, 'DD/MM')
          WHEN 'week' THEN TO_CHAR(bucket_time, 'DD/MM')
          ELSE TO_CHAR(bucket_time, 'DD/MM')
        END,
        'visitors', COALESCE(visitors, 0),
        'events', COALESCE(events, 0),
        'calls', COALESCE(calls, 0),
        'intents', COALESCE(intents, 0),
        'conversions', COALESCE(conversions, 0)
      )
      ORDER BY bucket_time
    ),
    ARRAY[]::jsonb[]
  ) INTO v_result
  FROM time_buckets;
  
  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;


ALTER FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text" DEFAULT 'auto'::"text", "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_range_days int;
  v_effective_granularity text;
  v_result jsonb[];
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  v_range_days := EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 86400;

  IF p_granularity = 'auto' THEN
    IF v_range_days <= 7 THEN
      v_effective_granularity := 'hour';
    ELSIF v_range_days <= 30 THEN
      v_effective_granularity := 'day';
    ELSE
      v_effective_granularity := 'week';
    END IF;
  ELSE
    v_effective_granularity := p_granularity;
  END IF;

  WITH time_buckets AS (
    SELECT
      bucket_time,
      COALESCE(SUM(visitors), 0) as visitors,
      COALESCE(SUM(events), 0) as events,
      COALESCE(SUM(calls), 0) as calls,
      COALESCE(SUM(intents), 0) as intents,
      COALESCE(SUM(conversions), 0) as conversions
    FROM (
      -- Sessions (visitors by fingerprint)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', s.created_at)
          WHEN 'day' THEN DATE_TRUNC('day', s.created_at)
          WHEN 'week' THEN DATE_TRUNC('week', s.created_at)
          ELSE DATE_TRUNC('day', s.created_at)
        END as bucket_time,
        COUNT(DISTINCT s.fingerprint) as visitors,
        0::bigint as events,
        0::bigint as calls,
        0::bigint as intents,
        0::bigint as conversions
      FROM public.sessions s
      WHERE s.site_id = p_site_id
        AND s.created_month >= v_start_month
        AND s.created_month < v_end_month
        AND s.created_at >= p_date_from
        AND s.created_at <= p_date_to
        AND (p_ads_only = false OR public.is_ads_session(s))
      GROUP BY bucket_time

      UNION ALL

      -- Events (exclude heartbeats)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', e.created_at)
          WHEN 'day' THEN DATE_TRUNC('day', e.created_at)
          WHEN 'week' THEN DATE_TRUNC('week', e.created_at)
          ELSE DATE_TRUNC('day', e.created_at)
        END as bucket_time,
        0::bigint as visitors,
        COUNT(*) as events,
        0::bigint as calls,
        0::bigint as intents,
        COUNT(*) FILTER (WHERE e.event_category = 'conversion') as conversions
      FROM public.events e
      JOIN public.sessions s ON e.session_id = s.id AND e.session_month = s.created_month
      WHERE s.site_id = p_site_id
        AND e.session_month >= v_start_month
        AND e.session_month < v_end_month
        AND e.created_at >= p_date_from
        AND e.created_at <= p_date_to
        AND e.event_category != 'heartbeat'
        AND (p_ads_only = false OR public.is_ads_session(s))
      GROUP BY bucket_time

      UNION ALL

      -- Calls (only those matched to Ads sessions when ads_only=true)
      SELECT
        CASE v_effective_granularity
          WHEN 'hour' THEN DATE_TRUNC('hour', c.created_at)
          WHEN 'day' THEN DATE_TRUNC('day', c.created_at)
          WHEN 'week' THEN DATE_TRUNC('week', c.created_at)
          ELSE DATE_TRUNC('day', c.created_at)
        END as bucket_time,
        0::bigint as visitors,
        0::bigint as events,
        COUNT(*) as calls,
        COUNT(*) FILTER (WHERE c.status = 'intent') as intents,
        COUNT(*) FILTER (WHERE c.status IN ('confirmed', 'qualified', 'real')) as conversions
      FROM public.calls c
      WHERE c.site_id = p_site_id
        AND c.created_at >= p_date_from
        AND c.created_at <= p_date_to
        AND (
          p_ads_only = false
          OR EXISTS (
            SELECT 1
            FROM public.sessions s
            WHERE s.site_id = p_site_id
              AND s.id = c.matched_session_id
              AND s.created_month >= v_start_month
              AND s.created_month < v_end_month
              AND public.is_ads_session(s)
          )
        )
      GROUP BY bucket_time
    ) combined
    GROUP BY bucket_time
    ORDER BY bucket_time
  )
  SELECT COALESCE(
    array_agg(
      jsonb_build_object(
        'date', bucket_time::text,
        'label', CASE v_effective_granularity
          WHEN 'hour' THEN TO_CHAR(bucket_time, 'HH24:MI')
          WHEN 'day' THEN TO_CHAR(bucket_time, 'DD/MM')
          WHEN 'week' THEN TO_CHAR(bucket_time, 'DD/MM')
          ELSE TO_CHAR(bucket_time, 'DD/MM')
        END,
        'visitors', COALESCE(visitors, 0),
        'events', COALESCE(events, 0),
        'calls', COALESCE(calls, 0),
        'intents', COALESCE(intents, 0),
        'conversions', COALESCE(conversions, 0)
      )
      ORDER BY bucket_time
    ),
    ARRAY[]::jsonb[]
  ) INTO v_result
  FROM time_buckets;

  RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;


ALTER FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text", "p_ads_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") RETURNS TABLE("raw_phone_string" "text", "phone_source_type" "text", "detected_country_iso" "text", "event_timestamp_utc_ms" bigint, "first_fingerprint_touch_utc_ms" bigint, "user_agent_raw" "text", "historical_gclid_presence" boolean, "is_verified" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH c AS (
    SELECT
      c.phone_number,
      c.caller_phone_e164,
      c.caller_phone_raw,
      c.phone_source_type,
      c.user_agent,
      c.matched_fingerprint,
      c.site_id,
      c.confirmed_at,
      c.matched_at,
      c.session_created_month
    FROM public.calls c
    WHERE c.id = p_call_id AND c.site_id = p_site_id
    LIMIT 1
  ),
  site_country AS (
    SELECT s.default_country_iso
    FROM public.sites s
    INNER JOIN c ON c.site_id = s.id
    LIMIT 1
  ),
  first_touch AS (
    SELECT MIN(s2.created_at) AS first_at
    FROM public.sessions s2
    INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
    WHERE s2.created_at >= (SELECT COALESCE(c.confirmed_at, c.matched_at) FROM c) - interval '90 days'
  ),
  gclid_90d AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s2
      INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
      WHERE s2.gclid IS NOT NULL
        AND s2.created_at >= (SELECT COALESCE(c.confirmed_at, c.matched_at) FROM c) - interval '90 days'
    ) AS has_gclid
  )
  SELECT
    COALESCE(c.caller_phone_e164, c.phone_number) AS raw_phone_string,
    c.phone_source_type,
    (SELECT default_country_iso FROM site_country) AS detected_country_iso,
    (EXTRACT(EPOCH FROM COALESCE(c.confirmed_at, c.matched_at)) * 1000)::bigint AS event_timestamp_utc_ms,
    (EXTRACT(EPOCH FROM (SELECT first_at FROM first_touch)) * 1000)::bigint AS first_fingerprint_touch_utc_ms,
    c.user_agent AS user_agent_raw,
    (SELECT has_gclid FROM gclid_90d) AS historical_gclid_presence,
    (c.caller_phone_e164 IS NOT NULL) AS is_verified
  FROM c;
$$;


ALTER FUNCTION "public"."get_dic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_dic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") IS 'DIC: raw_phone_string = COALESCE(caller_phone_e164, phone_number). is_verified when operator-verified.';



CREATE OR REPLACE FUNCTION "public"."get_entitlements_for_site"("p_site_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_service boolean;
  v_uid uuid;
  v_tier text;
BEGIN
  v_uid := auth.uid();
  v_is_service := (v_uid IS NULL AND public._jwt_role() = 'service_role');

  IF NOT v_is_service THEN
    IF NOT public.can_access_site(v_uid, p_site_id) THEN
      RETURN public._entitlements_no_access();
    END IF;
  END IF;

  SELECT s.tier INTO v_tier
  FROM public.subscriptions s
  WHERE s.site_id = p_site_id
    AND s.status IN ('ACTIVE','TRIALING')
    AND (s.current_period_end IS NULL OR s.current_period_end >= now())
  ORDER BY s.current_period_end DESC NULLS LAST
  LIMIT 1;

  IF v_tier IS NULL THEN
    v_tier := 'FREE';
  END IF;

  IF v_uid IS NOT NULL AND public.is_admin(v_uid) THEN
    v_tier := 'SUPER_ADMIN';
  END IF;

  RETURN public._entitlements_for_tier(v_tier);
END;
$$;


ALTER FUNCTION "public"."get_entitlements_for_site"("p_site_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_entitlements_for_site"("p_site_id" "uuid") IS 'Sprint-1: Returns tier + capabilities + limits. No-access or service_role bypass. Optional is_admin -> SUPER_ADMIN.';



CREATE OR REPLACE FUNCTION "public"."get_ingest_publish_failures_last_1h"("p_site_public_id" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "site_public_id" "text", "created_at" timestamp with time zone, "error_code" "text", "error_message_short" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT f.id, f.site_public_id, f.created_at, f.error_code, f.error_message_short
    FROM public.ingest_publish_failures f
    WHERE f.created_at >= NOW() - INTERVAL '1 hour'
      AND (p_site_public_id IS NULL OR f.site_public_id = p_site_public_id)
    ORDER BY f.created_at DESC;
$$;


ALTER FUNCTION "public"."get_ingest_publish_failures_last_1h"("p_site_public_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_ingest_publish_failures_last_1h"("p_site_public_id" "text") IS 'Returns ingest publish failures in the last hour. Pass site_public_id to filter by site, or NULL for all.';



CREATE OR REPLACE FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

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
          OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s0.id AND sm.user_id = v_user_id)
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN (
    SELECT to_jsonb(x)
    FROM (
      SELECT
        c.id AS id,
        c.created_at AS created_at,
        c.intent_action AS intent_action,
        c.intent_target AS intent_target,
        c.intent_stamp AS intent_stamp,
        COALESCE(c.intent_page_url, s.entry_page) AS intent_page_url,
        COALESCE(c.intent_page_url, s.entry_page) AS page_url,
        c.matched_session_id AS matched_session_id,
        c.lead_score AS lead_score,
        c.status AS status,
        COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) AS click_id,
        c.form_state AS form_state,
        c.form_summary AS form_summary,
        s.traffic_source AS traffic_source,
        s.traffic_medium AS traffic_medium,
        GREATEST(
          COALESCE((
            SELECT MAX(COALESCE(c2.intent_phone_clicks, 0))
            FROM public.calls c2
            WHERE c2.site_id = p_site_id
              AND c2.source = 'click'
              AND c2.matched_session_id = c.matched_session_id
          ), 0),
          COALESCE((
            SELECT COUNT(*)
            FROM public.calls c3
            WHERE c3.site_id = p_site_id
              AND c3.source = 'click'
              AND c3.matched_session_id = c.matched_session_id
              AND (c3.status IS NULL OR c3.status = 'intent')
              AND c3.intent_action = 'phone'
          ), 0)
        ) AS phone_clicks,
        GREATEST(
          COALESCE((
            SELECT MAX(COALESCE(c2.intent_whatsapp_clicks, 0))
            FROM public.calls c2
            WHERE c2.site_id = p_site_id
              AND c2.source = 'click'
              AND c2.matched_session_id = c.matched_session_id
          ), 0),
          COALESCE((
            SELECT COUNT(*)
            FROM public.calls c3
            WHERE c3.site_id = p_site_id
              AND c3.source = 'click'
              AND c3.matched_session_id = c.matched_session_id
              AND (c3.status IS NULL OR c3.status = 'intent')
              AND c3.intent_action = 'whatsapp'
          ), 0)
        ) AS whatsapp_clicks,
        s.gclid AS gclid,
        s.wbraid AS wbraid,
        s.gbraid AS gbraid,
        c.estimated_value AS estimated_value,
        (SELECT sites.currency FROM public.sites WHERE sites.id = p_site_id) AS currency,
        s.utm_term AS utm_term,
        s.utm_campaign AS utm_campaign,
        s.utm_source AS utm_source,
        s.utm_medium AS utm_medium,
        s.utm_content AS utm_content,
        s.matchtype AS matchtype,
        s.ads_network AS ads_network,
        s.ads_placement AS ads_placement,
        s.device_type AS device_type,
        s.device_os AS device_os,
        s.browser AS browser,
        s.browser_language AS browser_language,
        s.device_memory AS device_memory,
        s.hardware_concurrency AS hardware_concurrency,
        s.screen_width AS screen_width,
        s.screen_height AS screen_height,
        s.pixel_ratio AS pixel_ratio,
        s.gpu_renderer AS gpu_renderer,
        s.connection_type AS connection_type,
        s.max_scroll_percentage AS max_scroll_percentage,
        s.cta_hover_count AS cta_hover_count,
        s.form_focus_duration AS form_focus_duration,
        s.total_active_seconds AS total_active_seconds,
        s.engagement_score AS engagement_score,
        s.is_returning AS is_returning,
        s.visitor_rank AS visitor_rank,
        COALESCE(s.previous_visit_count, 0) AS previous_visit_count,
        s.referrer_host AS referrer_host,
        CASE
          WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN NULL
          WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL THEN NULL
          ELSE s.city
        END AS city,
        COALESCE(
          NULLIF(CASE WHEN c.location_source = 'gclid' THEN BTRIM(COALESCE(c.district_name, '')) END, ''),
          NULLIF(BTRIM(COALESCE(s.geo_district, '')), ''),
          NULLIF(BTRIM(COALESCE(s.district, '')), '')
        ) AS district,
        CASE
          WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN 'gclid'
          WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL
            AND NULLIF(BTRIM(COALESCE(s.loc_physical_ms, '')), '') IS NOT NULL THEN 'gclid'
          ELSE c.location_source
        END AS location_source,
        s.telco_carrier AS telco_carrier,
        s.isp_asn AS isp_asn,
        COALESCE(s.is_proxy_detected, false) AS is_proxy_detected,
        s.attribution_source AS attribution_source,
        s.total_duration_sec AS total_duration_sec,
        s.event_count AS event_count,
        s.ai_score AS ai_score,
        s.ai_summary AS ai_summary,
        s.ai_tags AS ai_tags,
        c.oci_status AS oci_status,
        c.oci_status_updated_at AS oci_status_updated_at,
        c.oci_uploaded_at AS oci_uploaded_at,
        c.oci_batch_id AS oci_batch_id,
        c.oci_error AS oci_error
      FROM public.calls c
      LEFT JOIN public.sessions s
        ON s.id = c.matched_session_id
       AND s.site_id = p_site_id
      WHERE c.site_id = p_site_id
        AND c.id = p_call_id
      LIMIT 1
    ) x
  );
END;
$$;


ALTER FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") IS 'Intent details with hardened source and GCLID-first district fidelity for operator review.';



CREATE OR REPLACE FUNCTION "public"."get_intent_ratio_watchdog"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_phone_events int;
  v_click_intents int;
  v_ratio numeric;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  -- Scope sessions first (partition-friendly) then join events using session_id+session_month
  WITH s_scope AS (
    SELECT s.id, s.created_month
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at <= p_date_to
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_phone_events
  FROM public.events e
  JOIN s_scope s ON e.session_id = s.id AND e.session_month = s.created_month
  WHERE e.session_month >= v_start_month
    AND e.session_month < v_end_month
    AND e.created_at >= p_date_from
    AND e.created_at <= p_date_to
    AND e.event_action IN ('phone_call', 'whatsapp', 'phone_click', 'call_click');

  -- Click intents matched to scoped sessions (ads-only correctness)
  WITH s_scope AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at <= p_date_to
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_click_intents
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at <= p_date_to
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND (
      p_ads_only = false
      OR EXISTS (SELECT 1 FROM s_scope s WHERE s.id = c.matched_session_id)
    );

  IF v_phone_events > 0 THEN
    v_ratio := ROUND((v_click_intents::numeric / v_phone_events::numeric), 4);
  ELSE
    v_ratio := NULL;
  END IF;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,
    'phone_events_anycat_ads_only', v_phone_events,
    'click_intents_ads_only', v_click_intents,
    'ratio', v_ratio
  );
END;
$$;


ALTER FUNCTION "public"."get_intent_ratio_watchdog"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_intent_ratio_watchdog"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) IS 'Acceptance metric: ratio=click_intents_ads_only/phone_events_anycat_ads_only for a date range (Ads Command Center).';



CREATE OR REPLACE FUNCTION "public"."get_kill_feed_v1"("p_site_id" "uuid", "p_hours_back" integer DEFAULT 24, "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_from timestamptz;
  v_result jsonb;
BEGIN
  -- Calculate time window
  v_from := now() - (p_hours_back || ' hours')::interval;

  -- Fetch recent qualified intents (confirmed/junk/cancelled)
  -- Order by most recent action first
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'intent_action', c.intent_action,
      'intent_target', c.intent_target,
      'created_at', c.created_at,
      'confirmed_at', c.confirmed_at,
      'cancelled_at', c.cancelled_at,
      'lead_score', c.lead_score,
      'sale_amount', c.sale_amount,
      'currency', c.currency,
      -- Effective action timestamp (for sorting and display)
      'action_at', COALESCE(
        c.cancelled_at,
        c.confirmed_at,
        c.created_at
      )
    )
    ORDER BY COALESCE(c.cancelled_at, c.confirmed_at, c.created_at) DESC
  )
  INTO v_result
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.status IN ('confirmed', 'junk', 'cancelled')
    -- Look back based on when the action happened
    AND COALESCE(c.cancelled_at, c.confirmed_at, c.created_at) >= v_from
  LIMIT p_limit;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_kill_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_kill_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer) IS 'Returns recent qualified intents (confirmed/junk/cancelled) for kill feed UI. Used for undo/restore and cancel flows.';



CREATE OR REPLACE FUNCTION "public"."get_marketing_signals_as_of"("p_site_id" "uuid", "p_as_of" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("id" "uuid", "call_id" "uuid", "site_id" "uuid", "signal_type" "text", "google_conversion_name" "text", "google_conversion_time" "text", "conversion_value" numeric, "gclid" "text", "wbraid" "text", "gbraid" "text", "dispatch_status" "text", "expected_value_cents" bigint, "sys_period" "tstzrange", "valid_period" "tstzrange")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Return the row that was CURRENT in the system at p_as_of
  -- Uses history table for past states, live table for current state
  (
    SELECT
      ms.id, ms.call_id, ms.site_id, ms.signal_type,
      ms.google_conversion_name, ms.google_conversion_time,
      ms.conversion_value, ms.gclid, ms.wbraid, ms.gbraid,
      ms.dispatch_status, ms.expected_value_cents,
      ms.sys_period, ms.valid_period
    FROM public.marketing_signals ms
    WHERE ms.site_id = p_site_id
      AND ms.sys_period @> p_as_of
  )
  UNION ALL
  (
    SELECT
      h.id, h.call_id, h.site_id, h.signal_type,
      h.google_conversion_name, h.google_conversion_time,
      h.conversion_value, h.gclid, h.wbraid, h.gbraid,
      h.dispatch_status, h.expected_value_cents,
      h.sys_period, h.valid_period
    FROM public.marketing_signals_history h
    WHERE h.site_id = p_site_id
      AND h.sys_period @> p_as_of
  );
$$;


ALTER FUNCTION "public"."get_marketing_signals_as_of"("p_site_id" "uuid", "p_as_of" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_marketing_signals_as_of"("p_site_id" "uuid", "p_as_of" timestamp with time zone) IS 'Bitemporal time-travel: returns marketing_signals as the system believed them at p_as_of. Uses live table for current, history table for past.';



CREATE TABLE IF NOT EXISTS "public"."conversions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gclid" "text",
    "session_id" "uuid",
    "visitor_id" "uuid",
    "star" integer,
    "revenue" numeric DEFAULT 0,
    "presignal_value" numeric DEFAULT 0,
    "google_action" "public"."google_action_type",
    "adjustment_value" numeric DEFAULT 0,
    "google_sent_at" timestamp with time zone,
    "google_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "intent_id" "uuid",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "next_retry_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_value" numeric,
    "claimed_at" timestamp with time zone,
    "claimed_by" "text",
    "seal_status" "text" DEFAULT 'unsealed'::"text",
    CONSTRAINT "conversions_seal_status_check" CHECK (("seal_status" = ANY (ARRAY['unsealed'::"text", 'sealed'::"text"]))),
    CONSTRAINT "conversions_star_check" CHECK ((("star" >= 1) AND ("star" <= 5)))
);


ALTER TABLE "public"."conversions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."conversions"."seal_status" IS 'Iron Seal: Only rows with seal_status = ''sealed'' are dispatched. Default ''unsealed'' blocks bypass.';



CREATE OR REPLACE FUNCTION "public"."get_pending_conversions_for_worker"("p_batch_size" integer, "p_current_time" timestamp with time zone DEFAULT "now"(), "p_worker_id" "text" DEFAULT 'worker'::"text") RETURNS SETOF "public"."conversions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Iron Seal: ONLY sealed records are eligible for dispatch
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.conversions
    WHERE google_sent_at  IS NULL
      AND google_action   IS NOT NULL
      AND seal_status     = 'sealed'  -- Hard-block: no unsealed data to Google
      AND next_retry_at   <= p_current_time
      AND (
        claimed_at IS NULL
        OR claimed_at < (p_current_time - INTERVAL '10 minutes')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.conversions c
     SET claimed_at  = p_current_time,
         claimed_by  = p_worker_id,
         updated_at  = p_current_time
    FROM picked
   WHERE c.id = picked.id
  RETURNING c.*;
END;
$$;


ALTER FUNCTION "public"."get_pending_conversions_for_worker"("p_batch_size" integer, "p_current_time" timestamp with time zone, "p_worker_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_pending_conversions_for_worker"("p_batch_size" integer, "p_current_time" timestamp with time zone, "p_worker_id" "text") IS 'Iron Seal: Claims only seal_status=sealed rows. Unsealed rows are never dispatched.';



CREATE OR REPLACE FUNCTION "public"."get_provider_health_state"("p_site_id" "uuid", "p_provider_key" "text") RETURNS TABLE("site_id" "uuid", "provider_key" "text", "state" "public"."provider_circuit_state", "failure_count" integer, "last_failure_at" timestamp with time zone, "opened_at" timestamp with time zone, "next_probe_at" timestamp with time zone, "probe_limit" integer, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'get_provider_health_state may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.provider_health_state (site_id, provider_key)
  VALUES (p_site_id, p_provider_key)
  ON CONFLICT (site_id, provider_key) DO NOTHING;

  RETURN QUERY
  SELECT h.site_id, h.provider_key, h.state, h.failure_count, h.last_failure_at, h.opened_at, h.next_probe_at, h.probe_limit, h.updated_at
  FROM public.provider_health_state h
  WHERE h.site_id = p_site_id AND h.provider_key = p_provider_key;
END;
$$;


ALTER FUNCTION "public"."get_provider_health_state"("p_site_id" "uuid", "p_provider_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_provider_health_state"("p_site_id" "uuid", "p_provider_key" "text") IS 'PR5: Get or upsert health row. service_role only.';



CREATE OR REPLACE FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer DEFAULT 100, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

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

  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_range', ERRCODE = 'P0001';
  END IF;

  v_from := p_date_from;
  v_to := p_date_to;
  IF v_to < v_from THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_range', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));

  RETURN (
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', c.id,
          'created_at', c.created_at,
          'status', c.status,
          'matched_session_id', c.matched_session_id,
          'intent_action', c.intent_action,
          'summary', COALESCE(NULLIF(BTRIM(c.intent_target), ''), NULLIF(BTRIM(c.intent_action), ''), 'intent'),
          'intent_target', c.intent_target,
          'intent_page_url', COALESCE(c.intent_page_url, s.entry_page),
          'page_url', COALESCE(c.intent_page_url, s.entry_page),
          'click_id', COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid),
          'form_state', c.form_state,
          'form_summary', c.form_summary,
          'traffic_source', s.traffic_source,
          'traffic_medium', s.traffic_medium,
          'attribution_source', s.attribution_source,
          'gclid', s.gclid,
          'wbraid', s.wbraid,
          'gbraid', s.gbraid,
          'utm_term', s.utm_term,
          'utm_campaign', s.utm_campaign,
          'utm_source', s.utm_source,
          'matchtype', s.matchtype,
          'city', CASE
            WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN NULL
            WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL THEN NULL
            ELSE s.city
          END,
          'district', COALESCE(
            NULLIF(CASE WHEN c.location_source = 'gclid' THEN BTRIM(COALESCE(c.district_name, '')) END, ''),
            NULLIF(BTRIM(COALESCE(s.geo_district, '')), ''),
            NULLIF(BTRIM(COALESCE(s.district, '')), '')
          ),
          'location_source', CASE
            WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN 'gclid'
            WHEN NULLIF(BTRIM(COALESCE(s.geo_district, '')), '') IS NOT NULL
              AND NULLIF(BTRIM(COALESCE(s.loc_physical_ms, '')), '') IS NOT NULL THEN 'gclid'
            ELSE c.location_source
          END,
          'device_type', s.device_type,
          'device_os', s.device_os,
          'total_duration_sec', s.total_duration_sec,
          'event_count', s.event_count,
          'estimated_value', c.estimated_value,
          'currency', sites.currency,
          'phone_clicks', GREATEST(
            COALESCE((
              SELECT MAX(COALESCE(c2.intent_phone_clicks, 0))
              FROM public.calls c2
              WHERE c2.site_id = p_site_id
                AND c2.source = 'click'
                AND c2.matched_session_id = c.matched_session_id
            ), 0),
            COALESCE((
              SELECT COUNT(*)
              FROM public.calls c3
              WHERE c3.site_id = p_site_id
                AND c3.source = 'click'
                AND c3.matched_session_id = c.matched_session_id
                AND (c3.status IS NULL OR c3.status = 'intent')
                AND c3.intent_action = 'phone'
            ), 0)
          ),
          'whatsapp_clicks', GREATEST(
            COALESCE((
              SELECT MAX(COALESCE(c2.intent_whatsapp_clicks, 0))
              FROM public.calls c2
              WHERE c2.site_id = p_site_id
                AND c2.source = 'click'
                AND c2.matched_session_id = c.matched_session_id
            ), 0),
            COALESCE((
              SELECT COUNT(*)
              FROM public.calls c3
              WHERE c3.site_id = p_site_id
                AND c3.source = 'click'
                AND c3.matched_session_id = c.matched_session_id
                AND (c3.status IS NULL OR c3.status = 'intent')
                AND c3.intent_action = 'whatsapp'
            ), 0)
          )
        )
        FROM public.calls c
        LEFT JOIN public.sessions s
          ON s.id = c.matched_session_id
         AND s.site_id = p_site_id
        LEFT JOIN public.sites sites
          ON sites.id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IS NULL OR c.status = 'intent')
          AND c.created_at >= v_from
          AND c.created_at < v_to
          AND (
            c.matched_session_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM public.calls c2
              WHERE c2.site_id = p_site_id
                AND c2.matched_session_id = c.matched_session_id
                AND c2.status IN ('junk', 'cancelled')
            )
          )
          AND (
            p_ads_only = false
            OR EXISTS (
              SELECT 1
              FROM public.sessions s2
              WHERE s2.id = c.matched_session_id
                AND s2.site_id = p_site_id
                AND public.is_ads_session(s2)
            )
          )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) IS 'Pending intents queue with hardened source + geo fidelity: advanced traffic fields plus GCLID-first district rendering.';



CREATE OR REPLACE FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_minutes_lookback" integer DEFAULT 60, "p_limit" integer DEFAULT 200, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_since timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  -- Auth: allow authenticated users; service_role permitted for smoke/scripts
  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_since := COALESCE(
    p_since,
    now() - make_interval(mins => GREATEST(1, LEAST(COALESCE(p_minutes_lookback, 60), 24 * 60)))
  );

  RETURN (
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', c.id,
          'created_at', c.created_at,
          'intent_action', c.intent_action,
          'intent_target', c.intent_target,
          'intent_stamp', c.intent_stamp,
          'intent_page_url', c.intent_page_url,
          'matched_session_id', c.matched_session_id,
          'lead_score', c.lead_score,
          'status', c.status,
          'click_id', c.click_id,

          -- OCI feedback fields
          'oci_status', c.oci_status,
          'oci_status_updated_at', c.oci_status_updated_at,
          'oci_uploaded_at', c.oci_uploaded_at,
          'oci_batch_id', c.oci_batch_id,
          'oci_error', c.oci_error,

          -- Session enrichment (lightweight join already used for ads-only gating)
          'attribution_source', s.attribution_source,
          'gclid', s.gclid,
          'wbraid', s.wbraid,
          'gbraid', s.gbraid,
          'total_duration_sec', s.total_duration_sec,
          'event_count', s.event_count,

          -- Risk & Matchability (simple, explainable)
          'oci_matchable', (
            COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
          ),
          'risk_reasons', to_jsonb(array_remove(ARRAY[
            CASE
              WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL)
                AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL)
                AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL)
                AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
              THEN 'High Risk: Click ID yok (GCLID/WBRAID/GBRAID bulunamad─▒)'
            END,
            CASE
              WHEN s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3
              THEN 'High Risk: Sitede 3 saniye (veya daha az) kald─▒'
            END,
            CASE
              WHEN s.event_count IS NOT NULL AND s.event_count <= 1
              THEN 'High Risk: Tek etkile┼şim (event_count<=1)'
            END,
            CASE
              WHEN s.attribution_source IS NOT NULL AND LOWER(s.attribution_source) LIKE '%organic%'
              THEN 'High Risk: Attribution Organic g├Âr├╝n├╝yor'
            END
          ], NULL)),
          'risk_level', CASE
            WHEN (
              (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL)
              AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL)
              AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL)
              AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
            )
            OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
            OR (s.event_count IS NOT NULL AND s.event_count <= 1)
            THEN 'high'
            ELSE 'low'
          END,

          -- Display-only derived stage for UI (matches requested vocabulary)
          'oci_stage', CASE
            WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded'
              AND (
                COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
                OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
                OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
                OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
              )
            THEN 'matched'
            WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' THEN 'uploaded'
            WHEN c.status IN ('confirmed','qualified','real') THEN 'sealed'
            ELSE 'pending'
          END
        )
        FROM public.calls c
        LEFT JOIN public.sessions s
          ON s.id = c.matched_session_id
         AND s.site_id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IN ('intent','confirmed','junk') OR c.status IS NULL)
          AND c.created_at >= v_since
          AND (
            p_ads_only = false
            OR (
              s.id IS NOT NULL
              AND public.is_ads_session(s)
            )
          )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_minutes_lookback" integer, "p_limit" integer, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_minutes_lookback" integer, "p_limit" integer, "p_ads_only" boolean) IS 'Live Inbox RPC: recent click intents from calls (fast). Enriched with risk reasons and OCI pipeline fields.';



CREATE OR REPLACE FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer DEFAULT 200, "p_ads_only" boolean DEFAULT true) RETURNS "jsonb"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

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
          OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = s0.id AND sm.user_id = v_user_id)
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
    END IF;
  END IF;

  v_from := p_date_from;
  v_to := p_date_to;
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));

  RETURN (
    SELECT COALESCE(
      ARRAY(
        SELECT to_jsonb(x)
        FROM (
          SELECT
            c.id AS id,
            c.created_at AS created_at,
            c.intent_action AS intent_action,
            c.intent_target AS intent_target,
            c.intent_stamp AS intent_stamp,
            COALESCE(c.intent_page_url, s.entry_page) AS intent_page_url,
            COALESCE(c.intent_page_url, s.entry_page) AS page_url,
            c.matched_session_id AS matched_session_id,
            c.lead_score AS lead_score,
            c.status AS status,
            COALESCE(c.click_id, s.gclid, s.wbraid, s.gbraid) AS click_id,
            s.gclid AS gclid,
            s.wbraid AS wbraid,
            s.gbraid AS gbraid,
            c.estimated_value AS estimated_value,
            (SELECT sites.currency FROM public.sites WHERE sites.id = p_site_id) AS currency,
            s.utm_term AS utm_term,
            s.utm_campaign AS utm_campaign,
            s.utm_source AS utm_source,
            s.utm_medium AS utm_medium,
            s.utm_content AS utm_content,
            s.matchtype AS matchtype,
            s.ads_network AS ads_network,
            s.ads_placement AS ads_placement,
            s.device_type AS device_type,
            s.device_os AS device_os,
            s.browser AS browser,
            s.browser_language AS browser_language,
            s.device_memory AS device_memory,
            s.hardware_concurrency AS hardware_concurrency,
            s.screen_width AS screen_width,
            s.screen_height AS screen_height,
            s.pixel_ratio AS pixel_ratio,
            s.gpu_renderer AS gpu_renderer,
            s.connection_type AS connection_type,
            s.max_scroll_percentage AS max_scroll_percentage,
            s.cta_hover_count AS cta_hover_count,
            s.form_focus_duration AS form_focus_duration,
            s.total_active_seconds AS total_active_seconds,
            s.engagement_score AS engagement_score,
            s.is_returning AS is_returning,
            s.visitor_rank AS visitor_rank,
            COALESCE(s.previous_visit_count, 0) AS previous_visit_count,
            s.referrer_host AS referrer_host,
            CASE WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN NULL ELSE s.city END AS city,
            CASE WHEN c.location_source = 'gclid' AND NULLIF(BTRIM(COALESCE(c.district_name, '')), '') IS NOT NULL THEN c.district_name ELSE s.district END AS district,
            c.location_source AS location_source,
            s.telco_carrier AS telco_carrier,
            s.isp_asn AS isp_asn,
            COALESCE(s.is_proxy_detected, false) AS is_proxy_detected,
            s.attribution_source AS attribution_source,
            s.total_duration_sec AS total_duration_sec,
            s.event_count AS event_count,
            s.ai_score AS ai_score,
            s.ai_summary AS ai_summary,
            s.ai_tags AS ai_tags,
            c.oci_status AS oci_status,
            c.oci_status_updated_at AS oci_status_updated_at,
            c.oci_uploaded_at AS oci_uploaded_at,
            c.oci_batch_id AS oci_batch_id,
            c.oci_error AS oci_error,
            (
              COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
              OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
            ) AS oci_matchable,
            to_jsonb(array_remove(ARRAY[
              CASE WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL) AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL) THEN 'High Risk: Click ID yok' END,
              CASE WHEN s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3 THEN 'High Risk: 3sn alt─▒ kal─▒┼ş' END,
              CASE WHEN s.event_count IS NOT NULL AND s.event_count <= 1 THEN 'High Risk: D├╝┼ş├╝k etkile┼şim' END,
              CASE WHEN s.attribution_source IS NOT NULL AND LOWER(s.attribution_source) LIKE '%organic%' THEN 'High Risk: Organic trafik' END
            ], NULL)) AS risk_reasons,
            CASE
              WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL AND COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
                OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
                OR (s.event_count IS NOT NULL AND s.event_count <= 1)
              THEN 'high'
              ELSE 'low'
            END AS risk_level,
            CASE
              WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' AND (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL) THEN 'matched'
              WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' THEN 'uploaded'
              WHEN c.status IN ('confirmed','qualified','real') THEN 'sealed'
              ELSE 'pending'
            END AS oci_stage
          FROM public.calls c
          LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
          WHERE c.site_id = p_site_id
            AND c.source = 'click'
            AND (c.status IN ('intent','confirmed','qualified','real') OR c.status IS NULL)
            AND (
              c.status IN ('confirmed','qualified','real')
              OR c.matched_session_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM public.calls c2
                WHERE c2.site_id = p_site_id
                  AND c2.matched_session_id = c.matched_session_id
                  AND c2.status IN ('junk','cancelled')
              )
            )
            AND c.created_at >= v_from
            AND c.created_at <= v_to
            AND (p_ads_only = false OR (s.id IS NOT NULL AND public.is_ads_session(s)))
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT v_limit
        ) x
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) IS 'Recent intents for queue/dashboard. Excludes junk and cancelled so binned intents do not reappear.';



CREATE OR REPLACE FUNCTION "public"."get_redundant_identities"("p_site_id" "uuid", "p_days" integer DEFAULT 90) RETURNS TABLE("matched_fingerprint" "text", "phone_numbers" "text"[], "call_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    c.matched_fingerprint,
    array_agg(DISTINCT c.phone_number ORDER BY c.phone_number) AS phone_numbers,
    count(*)::bigint AS call_count
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.matched_fingerprint IS NOT NULL
    AND c.matched_at >= (current_timestamp - (p_days || ' days')::interval)
  GROUP BY c.matched_fingerprint
  HAVING count(DISTINCT c.phone_number) > 1;
$$;


ALTER FUNCTION "public"."get_redundant_identities"("p_site_id" "uuid", "p_days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_redundant_identities"("p_site_id" "uuid", "p_days" integer) IS 'DIC: Fingerprints with multiple distinct phone_number values in the last p_days. Used for conflict mapping and hash strategy (last vs all aliases).';



CREATE OR REPLACE FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") RETURNS TABLE("id" "uuid", "site_id" "uuid", "created_at" timestamp with time zone, "created_month" "date", "city" "text", "district" "text", "device_type" "text", "attribution_source" "text", "gclid" "text", "fingerprint" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    sess.id,
    sess.site_id,
    sess.created_at,
    sess.created_month,
    sess.city,
    sess.district,
    sess.device_type,
    sess.attribution_source,
    sess.gclid,
    sess.fingerprint
  FROM public.sessions sess
  WHERE sess.id = p_session_id
    AND sess.site_id = p_site_id
    AND public.is_ads_session(sess)
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") IS 'Get session details for a specific session (ads-only enforced).';



CREATE OR REPLACE FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "created_at" timestamp with time zone, "event_category" "text", "event_action" "text", "event_label" "text", "url" "text", "metadata" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_month date;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));

  -- Ensure session belongs to site and is ads-only
  SELECT sess.created_month
  INTO v_month
  FROM public.sessions sess
  WHERE sess.id = p_session_id
    AND sess.site_id = p_site_id
    AND public.is_ads_session(sess)
  LIMIT 1;

  IF v_month IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.created_at,
    e.event_category,
    e.event_action,
    e.event_label,
    e.url,
    e.metadata
  FROM public.events e
  WHERE e.session_id = p_session_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT v_limit;
END;
$$;


ALTER FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer) IS 'Lazy drawer RPC: returns recent events for a session (ads-only enforced).';



CREATE OR REPLACE FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "created_at" timestamp with time zone, "attribution_source" "text", "device_type" "text", "city" "text", "lead_score" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_fingerprint IS NULL OR length(p_fingerprint) = 0 THEN
    RETURN;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  RETURN QUERY
  SELECT
    sess.id,
    sess.created_at,
    sess.attribution_source,
    sess.device_type,
    sess.city,
    sess.lead_score
  FROM public.sessions sess
  WHERE sess.site_id = p_site_id
    AND sess.fingerprint = p_fingerprint
    AND public.is_ads_session(sess)
  ORDER BY sess.created_at DESC, sess.id DESC
  LIMIT v_limit;
END;
$$;


ALTER FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer) IS 'Dashboard RPC: return last N sessions for a fingerprint within a site. Enforces site access (owner/member/admin).';



CREATE OR REPLACE FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) RETURNS TABLE("sessions_count" bigint, "leads_count" bigint, "calls_count" bigint, "conversions_count" bigint, "last_event_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_site_user_id uuid;
    v_since_month date;
    v_until_month date;
BEGIN
    -- Security: Check if current user can access this site
    -- Get current user ID
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING MESSAGE = 'User must be authenticated';
    END IF;
    
    -- Check site access: user must own the site
    SELECT user_id INTO v_site_user_id
    FROM public.sites
    WHERE id = p_site_id;
    
    IF v_site_user_id IS NULL THEN
        RAISE EXCEPTION 'site_not_found' USING MESSAGE = 'Site not found';
    END IF;
    
    IF v_site_user_id != v_user_id THEN
        RAISE EXCEPTION 'access_denied' USING MESSAGE = 'Access denied to this site';
    END IF;
    
    -- Calculate month boundaries for partition filtering
    v_since_month := DATE_TRUNC('month', p_since);
    v_until_month := DATE_TRUNC('month', p_until) + INTERVAL '1 month';
    
    -- Return aggregated stats (single query for performance)
    -- Uses indexed columns: site_id, created_at, created_month, event_category
    RETURN QUERY
    SELECT 
        -- Sessions count: unique sessions in time range
        (
            SELECT COUNT(DISTINCT s.id)::bigint
            FROM public.sessions s
            WHERE s.site_id = p_site_id
              AND s.created_at >= p_since
              AND s.created_at < p_until
        ) as sessions_count,
        
        -- Leads count: sessions with acquisition events or lead_score > 0 in metadata
        (
            SELECT COUNT(DISTINCT s.id)::bigint
            FROM public.sessions s
            WHERE s.site_id = p_site_id
              AND s.created_at >= p_since
              AND s.created_at < p_until
              AND EXISTS (
                  SELECT 1
                  FROM public.events e
                  WHERE e.session_id = s.id
                    AND e.session_month = s.created_month
                    AND (
                        e.event_category = 'acquisition'
                        OR (e.metadata->>'lead_score')::int > 0
                    )
                    AND e.created_at >= p_since
                    AND e.created_at < p_until
              )
        ) as leads_count,
        
        -- Calls count: all calls in time range (includes intent, confirmed, qualified, real, junk)
        (
            SELECT COUNT(*)::bigint
            FROM public.calls c
            WHERE c.site_id = p_site_id
              AND c.created_at >= p_since
              AND c.created_at < p_until
        ) as calls_count,
        
        -- Conversions count: events with category = 'conversion'
        (
            SELECT COUNT(*)::bigint
            FROM public.events e
            INNER JOIN public.sessions s ON s.id = e.session_id 
                AND s.site_id = p_site_id
                AND s.created_month = e.session_month
            WHERE e.event_category = 'conversion'
              AND e.created_at >= p_since
              AND e.created_at < p_until
        ) as conversions_count,
        
        -- Last event timestamp: most recent event in time range
        (
            SELECT MAX(e.created_at)
            FROM public.events e
            INNER JOIN public.sessions s ON s.id = e.session_id 
                AND s.site_id = p_site_id
                AND s.created_month = e.session_month
            WHERE e.created_at >= p_since
              AND e.created_at < p_until
        ) as last_event_at;
END;
$$;


ALTER FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) IS 'Returns aggregated stats for dashboard cards: sessions, leads, calls, conversions, and last event timestamp. Uses SECURITY DEFINER to check site access. Optimized for <200ms performance with indexed columns and partition filtering.';



CREATE OR REPLACE FUNCTION "public"."get_traffic_source_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer DEFAULT 12) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month_from date;
  v_month_to date;
  v_total bigint;
  v_rows jsonb;
  v_limit int;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_month_from := DATE_TRUNC('month', p_date_from)::date;
  v_month_to   := DATE_TRUNC('month', p_date_to)::date;
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 12), 50));

  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to;

  v_total := COALESCE(v_total, 0);

  WITH base AS (
    SELECT
      COALESCE(NULLIF(BTRIM(COALESCE(s.traffic_source, '')), ''), 'Unknown') AS src
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND s.created_month BETWEEN v_month_from AND v_month_to
  ),
  agg AS (
    SELECT src, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY src
    ORDER BY COUNT(*) DESC
    LIMIT v_limit
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', src,
      'count', cnt,
      'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
    )
    ORDER BY cnt DESC
  )
  INTO v_rows
  FROM agg;

  v_rows := COALESCE(v_rows, '[]'::jsonb);

  RETURN jsonb_build_object(
    'total_sessions', v_total,
    'sources', v_rows
  );
END;
$$;


ALTER FUNCTION "public"."get_traffic_source_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_url_param"("p_url" "text", "p_param" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'public'
    AS $_$
  SELECT (regexp_match(substring(p_url from '\?(.*)$'), p_param || '=([^&]*)'))[2];
$_$;


ALTER FUNCTION "public"."get_url_param"("p_url" "text", "p_param" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_url_param"("p_url" "text", "p_param" "text") IS 'Extract single query param value from URL (for backfill).';



CREATE OR REPLACE FUNCTION "public"."handle_call_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        NEW.last_status_change_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_call_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."heartbeat_merkle_1000"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_last_to bigint;
  v_from bigint;
  v_count bigint;
  v_sequence bigint;
  v_rows jsonb;
  v_usage_snapshot jsonb;
  v_payload text;
  v_hash text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  SELECT COALESCE(MAX(ledger_id_to), 0) INTO v_last_to
  FROM public.system_integrity_merkle;

  SELECT id INTO v_from
  FROM public.causal_dna_ledger
  WHERE id > v_last_to
  ORDER BY id ASC
  LIMIT 1;

  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'heartbeat', false, 'reason', 'no_new_entries');
  END IF;

  SELECT count(*), max(id) INTO v_count, v_last_to
  FROM (
    SELECT id FROM public.causal_dna_ledger
    WHERE id >= v_from
    ORDER BY id ASC
    LIMIT 1000
  ) sub;

  IF v_count < 1000 THEN
    RETURN jsonb_build_object('ok', true, 'heartbeat', false, 'reason', 'insufficient_entries', 'count', v_count);
  END IF;

  SELECT jsonb_agg(l ORDER BY l.id) INTO v_rows
  FROM public.causal_dna_ledger l
  WHERE l.id >= v_from AND l.id <= v_last_to;

  SELECT jsonb_object_agg(uc.site_id || '_' || uc.month, jsonb_build_object('revenue_events', uc.revenue_events_count, 'conversion_sends', uc.conversion_sends_count))
  INTO v_usage_snapshot
  FROM (
    SELECT site_id, month, revenue_events_count, conversion_sends_count
    FROM public.usage_counters
    WHERE updated_at >= now() - interval '1 day'
  ) uc;

  v_payload := (v_rows::text || COALESCE(v_usage_snapshot::text, '{}'));
  v_hash := encode(digest(v_payload, 'sha256'), 'hex');

  SELECT COALESCE(MAX(heartbeat_sequence), 0) + 1 INTO v_sequence FROM public.system_integrity_merkle;

  INSERT INTO public.system_integrity_merkle (heartbeat_sequence, merkle_root_hash, ledger_id_from, ledger_id_to, scope_snapshot)
  VALUES (v_sequence, v_hash, v_from, v_last_to, jsonb_build_object('usage_snapshot', COALESCE(v_usage_snapshot, '{}')));

  RETURN jsonb_build_object('ok', true, 'heartbeat', true, 'sequence', v_sequence, 'ledger_id_from', v_from, 'ledger_id_to', v_last_to, 'hash', v_hash);
END;
$$;


ALTER FUNCTION "public"."heartbeat_merkle_1000"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."heartbeat_merkle_1000"() IS 'Singularity: If 1000+ new causal_dna_ledger rows exist, hash them + usage snapshot and insert into system_integrity_merkle.';



CREATE OR REPLACE FUNCTION "public"."increment_provider_upload_metrics"("p_site_id" "uuid", "p_provider_key" "text", "p_attempts_delta" bigint DEFAULT 0, "p_completed_delta" bigint DEFAULT 0, "p_failed_delta" bigint DEFAULT 0, "p_retry_delta" bigint DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Enterprise hardening: allow only service_role (explicit role check).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'increment_provider_upload_metrics may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.provider_upload_metrics (site_id, provider_key, attempts_total, completed_total, failed_total, retry_total, updated_at)
  VALUES (p_site_id, p_provider_key, GREATEST(0, p_attempts_delta), GREATEST(0, p_completed_delta), GREATEST(0, p_failed_delta), GREATEST(0, p_retry_delta), now())
  ON CONFLICT (site_id, provider_key) DO UPDATE SET
    attempts_total = public.provider_upload_metrics.attempts_total + GREATEST(0, p_attempts_delta),
    completed_total = public.provider_upload_metrics.completed_total + GREATEST(0, p_completed_delta),
    failed_total = public.provider_upload_metrics.failed_total + GREATEST(0, p_failed_delta),
    retry_total = public.provider_upload_metrics.retry_total + GREATEST(0, p_retry_delta),
    updated_at = now();
END;
$$;


ALTER FUNCTION "public"."increment_provider_upload_metrics"("p_site_id" "uuid", "p_provider_key" "text", "p_attempts_delta" bigint, "p_completed_delta" bigint, "p_failed_delta" bigint, "p_retry_delta" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."increment_provider_upload_metrics"("p_site_id" "uuid", "p_provider_key" "text", "p_attempts_delta" bigint, "p_completed_delta" bigint, "p_failed_delta" bigint, "p_retry_delta" bigint) IS 'Increment site-scoped provider upload counters. Service_role only.';



CREATE OR REPLACE FUNCTION "public"."increment_usage_checked"("p_site_id" "uuid", "p_month" "date", "p_kind" "text", "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_service boolean;
  v_month date;
  v_row public.usage_counters%ROWTYPE;
  v_current int;
  v_new int;
BEGIN
  v_is_service := (auth.uid() IS NULL AND public._jwt_role() = 'service_role');
  IF NOT v_is_service THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF p_kind NOT IN ('revenue_events', 'conversion_sends') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_KIND');
  END IF;

  v_month := date_trunc('month', p_month)::date;

  INSERT INTO public.usage_counters(site_id, month)
  VALUES (p_site_id, v_month)
  ON CONFLICT (site_id, month) DO NOTHING;

  SELECT * INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id AND month = v_month
  FOR UPDATE;

  IF p_kind = 'revenue_events' THEN
    v_current := v_row.revenue_events_count;
  ELSE
    v_current := v_row.conversion_sends_count;
  END IF;

  IF p_limit >= 0 AND (v_current + 1) > p_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT');
  END IF;

  v_new := v_current + 1;

  IF p_kind = 'revenue_events' THEN
    UPDATE public.usage_counters
    SET revenue_events_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  ELSE
    UPDATE public.usage_counters
    SET conversion_sends_count = v_new, updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_count', v_new);
END;
$$;


ALTER FUNCTION "public"."increment_usage_checked"("p_site_id" "uuid", "p_month" "date", "p_kind" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."increment_usage_checked"("p_site_id" "uuid", "p_month" "date", "p_kind" "text", "p_limit" integer) IS 'Sprint-1: Atomic check-and-increment for entitlement limits. Service_role only. p_limit < 0 = unlimited.';



CREATE OR REPLACE FUNCTION "public"."insert_shadow_decision"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_rejected_gear_or_branch" "text", "p_reason" "text", "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'insert_shadow_decision may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.shadow_decisions (site_id, aggregate_type, aggregate_id, rejected_gear_or_branch, reason, context)
  VALUES (p_site_id, p_aggregate_type, p_aggregate_id, p_rejected_gear_or_branch, p_reason, COALESCE(p_context, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."insert_shadow_decision"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_rejected_gear_or_branch" "text", "p_reason" "text", "p_context" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."insert_shadow_decision"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_rejected_gear_or_branch" "text", "p_reason" "text", "p_context" "jsonb") IS 'Singularity: Log why a gear/branch was rejected (counterfactual history).';



CREATE OR REPLACE FUNCTION "public"."invoice_snapshot_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'invoice_snapshot is immutable: updates and deletes are not allowed'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;


ALTER FUNCTION "public"."invoice_snapshot_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = check_user_id AND role = 'admin'
    );
END;
$$;


ALTER FUNCTION "public"."is_admin"("check_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin"("check_user_id" "uuid") IS 'Check if user is admin by user_id';



CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "created_month" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "entry_page" "text",
    "exit_page" "text",
    "total_duration_sec" integer DEFAULT 0,
    "event_count" integer DEFAULT 0,
    "attribution_source" "text",
    "device_type" "text",
    "city" "text",
    "district" "text",
    "fingerprint" "text",
    "lead_score" integer DEFAULT 0,
    "ai_score" integer DEFAULT 0,
    "ai_summary" "text",
    "ai_tags" "text"[],
    "user_journey_path" "text",
    "utm_term" "text",
    "matchtype" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "ads_network" "text",
    "ads_placement" "text",
    "device_os" "text",
    "telco_carrier" "text",
    "browser" "text",
    "browser_language" "text",
    "device_memory" integer,
    "hardware_concurrency" integer,
    "screen_width" integer,
    "screen_height" integer,
    "pixel_ratio" numeric,
    "gpu_renderer" "text",
    "connection_type" "text",
    "is_returning" boolean DEFAULT false,
    "referrer_host" "text",
    "max_scroll_percentage" integer DEFAULT 0,
    "cta_hover_count" integer DEFAULT 0,
    "form_focus_duration" integer DEFAULT 0,
    "total_active_seconds" integer DEFAULT 0,
    "engagement_score" integer DEFAULT 0,
    "isp_asn" "text",
    "is_proxy_detected" boolean DEFAULT false,
    "visitor_rank" "text",
    "previous_visit_count" integer DEFAULT 0,
    "traffic_source" "text",
    "traffic_medium" "text",
    "utm_adgroup" "text",
    "device_model" "text",
    "ads_target_id" "text",
    "ads_adposition" "text",
    "ads_feed_item_id" "text",
    "loc_interest_ms" "text",
    "loc_physical_ms" "text",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[],
    "geo_city" "text",
    "geo_district" "text",
    "geo_source" "text",
    "geo_updated_at" timestamp with time zone
)
PARTITION BY RANGE ("created_month");
ALTER TABLE ONLY "public"."sessions" ALTER COLUMN "site_id" SET STATISTICS 1000;

ALTER TABLE ONLY "public"."sessions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sessions"."attribution_source" IS 'Computed attribution source: First Click (Paid), Paid (UTM), Ads Assisted, Paid Social, or Organic';



COMMENT ON COLUMN "public"."sessions"."device_type" IS 'Normalized device type: desktop, mobile, or tablet';



COMMENT ON COLUMN "public"."sessions"."city" IS 'City name from geo headers or metadata';



COMMENT ON COLUMN "public"."sessions"."district" IS 'District name from geo headers or metadata';



COMMENT ON COLUMN "public"."sessions"."fingerprint" IS 'Browser fingerprint hash for session matching';



COMMENT ON COLUMN "public"."sessions"."lead_score" IS 'Calculated lead score for the session';



COMMENT ON COLUMN "public"."sessions"."ai_score" IS 'AI-derived lead/quality score (0-100).';



COMMENT ON COLUMN "public"."sessions"."ai_summary" IS 'AI-generated session summary.';



COMMENT ON COLUMN "public"."sessions"."ai_tags" IS 'AI tags e.g. high-intent, plumber.';



COMMENT ON COLUMN "public"."sessions"."user_journey_path" IS 'Simplified path e.g. Home > Service > Contact.';



COMMENT ON COLUMN "public"."sessions"."utm_term" IS 'Search keyword from utm_term (Google Ads {keyword})';



COMMENT ON COLUMN "public"."sessions"."matchtype" IS 'Google Ads match type: e=Exact, p=Phrase, b=Broad';



COMMENT ON COLUMN "public"."sessions"."utm_source" IS 'Traffic source from utm_source (e.g. google, newsletter)';



COMMENT ON COLUMN "public"."sessions"."utm_medium" IS 'Marketing medium from utm_medium (e.g. cpc, email)';



COMMENT ON COLUMN "public"."sessions"."utm_campaign" IS 'Campaign name or ID from utm_campaign';



COMMENT ON COLUMN "public"."sessions"."utm_content" IS 'Ad/content variant from utm_content';



COMMENT ON COLUMN "public"."sessions"."ads_network" IS 'Google Ads {network}: Search, Display, YouTube, etc.';



COMMENT ON COLUMN "public"."sessions"."ads_placement" IS 'Google Ads {placement}';



COMMENT ON COLUMN "public"."sessions"."device_os" IS 'OS from User-Agent (e.g. iOS, Android). Single source for device label.';



COMMENT ON COLUMN "public"."sessions"."utm_adgroup" IS 'Google Ads {adgroupid} from utm_adgroup';



COMMENT ON COLUMN "public"."sessions"."device_model" IS 'Google Ads {devicemodel}';



COMMENT ON COLUMN "public"."sessions"."ads_target_id" IS 'Google Ads {targetid}';



COMMENT ON COLUMN "public"."sessions"."ads_adposition" IS 'Google Ads {adposition} (ad position on page)';



COMMENT ON COLUMN "public"."sessions"."ads_feed_item_id" IS 'Google Ads {feeditemid}';



COMMENT ON COLUMN "public"."sessions"."loc_interest_ms" IS 'Google Ads {loc_interest_ms}';



COMMENT ON COLUMN "public"."sessions"."loc_physical_ms" IS 'Google Ads {loc_physical_ms}';



COMMENT ON COLUMN "public"."sessions"."consent_at" IS 'KVKK/GDPR: R─▒za al─▒nd─▒─ş─▒ zaman.';



COMMENT ON COLUMN "public"."sessions"."consent_scopes" IS 'KVKK/GDPR: ─░zin kapsamlar─▒. analytics=sessions/events yaz─▒m─▒, marketing=OCI enqueue.';



COMMENT ON COLUMN "public"."sessions"."geo_city" IS 'Master geo city. ADS (GCLID) > IP; Rome/Amsterdam = UNKNOWN.';



COMMENT ON COLUMN "public"."sessions"."geo_district" IS 'Master geo district. ADS (geo_target_id) > IP.';



COMMENT ON COLUMN "public"."sessions"."geo_source" IS 'ADS | IP | OPERATOR | UNKNOWN. ADS always wins.';



COMMENT ON COLUMN "public"."sessions"."geo_updated_at" IS 'Last geo update timestamp.';



CREATE OR REPLACE FUNCTION "public"."is_ads_session"("sess" "public"."sessions") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT public.is_ads_session_input(
    sess.attribution_source,
    sess.gbraid,
    sess.gclid,
    sess.utm_medium,
    sess.utm_source,
    sess.wbraid
  );
$$;


ALTER FUNCTION "public"."is_ads_session"("sess" "public"."sessions") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_ads_session"("sess" "public"."sessions") IS 'Ads-origin classifier for sessions row. Delegates to is_ads_session_input().';



CREATE OR REPLACE FUNCTION "public"."is_ads_session_click_id_only"("sess" "public"."sessions") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    COALESCE(NULLIF(BTRIM(COALESCE(sess.gclid, '')), ''), NULL) IS NOT NULL
    OR COALESCE(NULLIF(BTRIM(COALESCE(sess.wbraid, '')), ''), NULL) IS NOT NULL
    OR COALESCE(NULLIF(BTRIM(COALESCE(sess.gbraid, '')), ''), NULL) IS NOT NULL;
$$;


ALTER FUNCTION "public"."is_ads_session_click_id_only"("sess" "public"."sessions") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_ads_session_click_id_only"("sess" "public"."sessions") IS 'P4: Strict ads filter for breakdown ÔÇö click-id only (gclid/wbraid/gbraid). Do not use attribution_source.';



CREATE OR REPLACE FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH norm AS (
    SELECT
      NULLIF(BTRIM(COALESCE(p_gclid, '')), '') AS gclid,
      NULLIF(BTRIM(COALESCE(p_wbraid, '')), '') AS wbraid,
      NULLIF(BTRIM(COALESCE(p_gbraid, '')), '') AS gbraid,
      LOWER(NULLIF(BTRIM(COALESCE(p_utm_source, '')), '')) AS utm_source,
      LOWER(NULLIF(BTRIM(COALESCE(p_utm_medium, '')), '')) AS utm_medium,
      LOWER(NULLIF(BTRIM(COALESCE(p_attribution_source, '')), '')) AS attribution_source
  )
  SELECT
    (gclid IS NOT NULL OR wbraid IS NOT NULL OR gbraid IS NOT NULL)
    OR
    (attribution_source IS NOT NULL AND (
      attribution_source LIKE '%paid%'
      OR attribution_source LIKE '%ads%'
      OR attribution_source LIKE '%cpc%'
      OR attribution_source LIKE '%ppc%'
    ))
    OR
    (utm_medium IS NOT NULL AND (
      utm_medium IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'sem', 'display', 'retargeting', 'remarketing')
      OR utm_medium LIKE '%cpc%'
      OR utm_medium LIKE '%ppc%'
      OR utm_medium LIKE '%paid%'
      OR utm_medium LIKE '%display%'
    ))
    OR
    (utm_source IS NOT NULL AND (
      utm_source IN ('google', 'googleads', 'adwords', 'gads', 'meta', 'facebook', 'fb', 'instagram', 'tiktok', 'bing', 'microsoft')
      OR utm_source LIKE '%google%'
      OR utm_source LIKE '%adwords%'
      OR utm_source LIKE '%gads%'
    ))
  FROM norm;
$$;


ALTER FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") IS 'Single source of truth: Ads-origin session classifier using click IDs, utm_source/utm_medium, and attribution_source.';



CREATE OR REPLACE FUNCTION "public"."is_site_admin_member"("p_site_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists(
    select 1
    from public.site_members sm
    where sm.site_id = p_site_id
      and sm.user_id = p_user_id
      and sm.role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_site_admin_member"("p_site_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_site_owner"("_site_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.sites
    where id = _site_id
      and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_site_owner"("_site_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_offline_conversion_groups"("p_limit_groups" integer DEFAULT 50) RETURNS TABLE("site_id" "uuid", "provider_key" "text", "queued_count" bigint, "min_next_retry_at" timestamp with time zone, "min_created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'list_offline_conversion_groups may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT g.site_id, g.provider_key, g.queued_count, g.min_next_retry_at, g.min_created_at
  FROM (
    SELECT oq.site_id, oq.provider_key,
           count(*)::bigint AS queued_count,
           MIN(oq.next_retry_at) AS min_next_retry_at,
           MIN(oq.created_at) AS min_created_at
    FROM public.offline_conversion_queue oq
    JOIN public.sites s ON s.id = oq.site_id
    WHERE oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= now())
      AND s.oci_sync_method = 'api'
    GROUP BY oq.site_id, oq.provider_key
    ORDER BY MIN(oq.next_retry_at) ASC NULLS FIRST, MIN(oq.created_at) ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit_groups, 50), 100))
  ) g;
END;
$$;


ALTER FUNCTION "public"."list_offline_conversion_groups"("p_limit_groups" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_oci_payload_validation_event"("p_actor" "text", "p_queue_id" "uuid", "p_site_id" "uuid", "p_attempted_status" "text", "p_payload" "jsonb", "p_unknown_keys" "text"[] DEFAULT ARRAY[]::"text"[], "p_missing_required" "text"[] DEFAULT ARRAY[]::"text"[], "p_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF COALESCE(array_length(p_unknown_keys, 1), 0) = 0
     AND COALESCE(array_length(p_missing_required, 1), 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.oci_payload_validation_events (
    actor,
    queue_id,
    site_id,
    attempted_status,
    unknown_keys,
    missing_required,
    payload,
    note
  )
  VALUES (
    p_actor,
    p_queue_id,
    p_site_id,
    p_attempted_status,
    to_jsonb(COALESCE(p_unknown_keys, ARRAY[]::text[])),
    to_jsonb(COALESCE(p_missing_required, ARRAY[]::text[])),
    p_payload,
    p_note
  );
END;
$$;


ALTER FUNCTION "public"."log_oci_payload_validation_event"("p_actor" "text", "p_queue_id" "uuid", "p_site_id" "uuid", "p_attempted_status" "text", "p_payload" "jsonb", "p_unknown_keys" "text"[], "p_missing_required" "text"[], "p_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_oci_payload_validation_event"("p_actor" "text", "p_queue_id" "uuid", "p_site_id" "uuid", "p_attempted_status" "text", "p_payload" "jsonb", "p_unknown_keys" "text"[], "p_missing_required" "text"[], "p_note" "text") IS 'Phase 23A warning-mode telemetry writer for transition payload drift.';



CREATE OR REPLACE FUNCTION "public"."marketing_signals_bitemporal_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  OLD.sys_period := tstzrange(lower(OLD.sys_period), now(), '[)');

  INSERT INTO public.marketing_signals_history (
    id,
    site_id,
    call_id,
    signal_type,
    google_conversion_name,
    google_conversion_time,
    dispatch_status,
    google_sent_at,
    created_at,
    conversion_value,
    causal_dna,
    entropy_score,
    uncertainty_bit,
    expected_value_cents,
    recovery_attempt_count,
    last_recovery_attempt_at,
    gclid,
    wbraid,
    gbraid,
    adjustment_sequence,
    previous_hash,
    current_hash,
    trace_id,
    sys_period,
    valid_period,
    history_recorded_at,
    history_action
  ) VALUES (
    OLD.id,
    OLD.site_id,
    OLD.call_id,
    OLD.signal_type,
    OLD.google_conversion_name,
    OLD.google_conversion_time,
    OLD.dispatch_status,
    OLD.google_sent_at,
    OLD.created_at,
    OLD.conversion_value,
    OLD.causal_dna,
    OLD.entropy_score,
    OLD.uncertainty_bit,
    OLD.expected_value_cents,
    OLD.recovery_attempt_count,
    OLD.last_recovery_attempt_at,
    OLD.gclid,
    OLD.wbraid,
    OLD.gbraid,
    OLD.adjustment_sequence,
    OLD.previous_hash,
    OLD.current_hash,
    OLD.trace_id,
    OLD.sys_period,
    OLD.valid_period,
    now(),
    'UPDATE'
  );

  NEW.sys_period := tstzrange(now(), 'infinity', '[)');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."marketing_signals_bitemporal_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."oci_attempt_cap"("p_max_attempts" integer DEFAULT 5, "p_min_age_minutes" integer DEFAULT 0) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_cutoff timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'oci_attempt_cap may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (p_min_age_minutes || ' minutes')::interval;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING')
    AND q.attempt_count >= p_max_attempts
    AND (p_min_age_minutes = 0 OR q.updated_at < v_cutoff);

  RETURN public.append_worker_transition_batch(
    v_queue_ids,
    'FAILED',
    now(),
    'MAX_ATTEMPTS_EXCEEDED',
    'MAX_ATTEMPTS',
    'PERMANENT'
  );
END;
$$;


ALTER FUNCTION "public"."oci_attempt_cap"("p_max_attempts" integer, "p_min_age_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."oci_attempt_cap"("p_max_attempts" integer, "p_min_age_minutes" integer) IS 'Phase 23C worker-owned attempt cap path. Delegates to append_worker_transition_batch with FAILED/MAX_ATTEMPTS semantics.';



CREATE OR REPLACE FUNCTION "public"."oci_transition_payload_allowed_keys"() RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT ARRAY[
    'last_error',
    'provider_error_code',
    'provider_error_category',
    'attempt_count',
    'retry_count',
    'next_retry_at',
    'uploaded_at',
    'claimed_at',
    'provider_request_id',
    'provider_ref',
    'clear_fields'
  ]::text[];
$$;


ALTER FUNCTION "public"."oci_transition_payload_allowed_keys"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."oci_transition_payload_allowed_keys"() IS 'Phase 23A canonical allowlist for oci_queue_transitions.error_payload keys.';



CREATE OR REPLACE FUNCTION "public"."oci_transition_payload_missing_required"("p_status" "text", "p_payload" "jsonb") RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RETURN ARRAY['payload_object'];
  END IF;

  IF p_status = 'PROCESSING' THEN
    IF NOT (v_payload ? 'claimed_at') THEN
      v_missing := array_append(v_missing, 'claimed_at');
    END IF;
  ELSIF p_status = 'RETRY' THEN
    IF NOT (v_payload ? 'next_retry_at') THEN
      v_missing := array_append(v_missing, 'next_retry_at');
    END IF;
    IF NOT (v_payload ? 'provider_error_category') THEN
      v_missing := array_append(v_missing, 'provider_error_category');
    END IF;
  ELSIF p_status IN ('FAILED', 'DEAD_LETTER_QUARANTINE') THEN
    IF NOT (v_payload ? 'provider_error_category') THEN
      v_missing := array_append(v_missing, 'provider_error_category');
    END IF;
  END IF;

  RETURN v_missing;
END;
$$;


ALTER FUNCTION "public"."oci_transition_payload_missing_required"("p_status" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."oci_transition_payload_missing_required"("p_status" "text", "p_payload" "jsonb") IS 'Phase 23A warning-mode helper that reports status-specific missing required keys.';



CREATE OR REPLACE FUNCTION "public"."oci_transition_payload_unknown_keys"("p_payload" "jsonb") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN ARRAY[]::text[]
      ELSE COALESCE((
        SELECT array_agg(entry.key ORDER BY entry.key)
        FROM jsonb_each(p_payload) AS entry
        WHERE entry.key <> ALL(public.oci_transition_payload_allowed_keys())
      ), ARRAY[]::text[])
    END;
$$;


ALTER FUNCTION "public"."oci_transition_payload_unknown_keys"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."oci_transition_payload_unknown_keys"("p_payload" "jsonb") IS 'Phase 23A warning-mode helper that returns unknown top-level payload keys.';



CREATE OR REPLACE FUNCTION "public"."ping"() RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 1;
$$;


ALTER FUNCTION "public"."ping"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_transition_clear_fields"("p_payload" "jsonb") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN ARRAY[]::text[]
      WHEN p_payload ? 'clear_fields' AND jsonb_typeof(p_payload->'clear_fields') = 'array' THEN
        COALESCE(
          ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'clear_fields')
          ),
          ARRAY[]::text[]
        )
      ELSE ARRAY[]::text[]
    END;
$$;


ALTER FUNCTION "public"."queue_transition_clear_fields"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_transition_clear_fields"("p_payload" "jsonb") IS 'Phase 23B helper that expands clear_fields into a text array for batch snapshot apply.';



CREATE OR REPLACE FUNCTION "public"."queue_transition_payload_has_meaningful_patch"("p_payload" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN false
      ELSE (
        EXISTS (
          SELECT 1
          FROM jsonb_each(p_payload) AS entry
          WHERE entry.key IN (
            'last_error',
            'provider_error_code',
            'provider_error_category',
            'attempt_count',
            'retry_count',
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref'
          )
            AND entry.value IS DISTINCT FROM 'null'::jsonb
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN p_payload ? 'clear_fields' AND jsonb_typeof(p_payload->'clear_fields') = 'array'
                THEN p_payload->'clear_fields'
              ELSE '[]'::jsonb
            END
          ) AS clear_field
          WHERE clear_field.value IN (
            'last_error',
            'provider_error_code',
            'provider_error_category',
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref'
          )
        )
      )
    END;
$$;


ALTER FUNCTION "public"."queue_transition_payload_has_meaningful_patch"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_transition_payload_has_meaningful_patch"("p_payload" "jsonb") IS 'Returns true when a transition payload contains at least one supported non-null patch key or explicit clear_fields.';



CREATE OR REPLACE FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") RETURNS TABLE("sale_id" "uuid", "enqueued" boolean, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_primary_session_id uuid;
  v_consent_scopes text[];
  v_external_id text;
  v_queue_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'sale_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_sale_id, false, 'sale_not_found'::text;
    RETURN;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_sale.site_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_sale.status IS DISTINCT FROM 'CONFIRMED' THEN
    RETURN QUERY SELECT p_sale_id, false, 'sale_not_confirmed'::text;
    RETURN;
  END IF;

  IF v_sale.amount_cents IS NULL OR v_sale.amount_cents <= 0 THEN
    RETURN QUERY SELECT p_sale_id, false, 'value_non_positive'::text;
    RETURN;
  END IF;

  IF v_sale.conversation_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'conversation_missing'::text;
    RETURN;
  END IF;

  SELECT c.primary_source, c.primary_session_id
  INTO v_primary_source, v_primary_session_id
  FROM public.conversations c
  WHERE c.id = v_sale.conversation_id
  LIMIT 1;

  IF v_primary_session_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'conversation_session_missing'::text;
    RETURN;
  END IF;

  SELECT s.consent_scopes
  INTO v_consent_scopes
  FROM public.sessions s
  WHERE s.id = v_primary_session_id
    AND s.site_id = v_sale.site_id
  LIMIT 1;

  IF v_consent_scopes IS NULL OR NOT ('marketing' = ANY(v_consent_scopes)) THEN
    RETURN QUERY SELECT p_sale_id, false, 'marketing_consent_required'::text;
    RETURN;
  END IF;

  v_external_id := public.compute_offline_conversion_external_id(
    'google_ads',
    'purchase',
    v_sale.id,
    NULL,
    v_primary_session_id
  );

  INSERT INTO public.offline_conversion_queue (
    site_id,
    sale_id,
    session_id,
    provider_key,
    external_id,
    conversion_time,
    occurred_at,
    source_timestamp,
    time_confidence,
    occurred_at_source,
    entry_reason,
    value_cents,
    currency,
    gclid,
    wbraid,
    gbraid,
    status
  )
  VALUES (
    v_sale.site_id,
    v_sale.id,
    v_primary_session_id,
    'google_ads',
    v_external_id,
    v_sale.occurred_at,
    v_sale.occurred_at,
    v_sale.occurred_at,
    'observed',
    'sale',
    v_sale.entry_reason,
    v_sale.amount_cents,
    v_sale.currency,
    NULLIF(btrim(COALESCE(v_primary_source->>'gclid', '')), ''),
    NULLIF(btrim(COALESCE(v_primary_source->>'wbraid', '')), ''),
    NULLIF(btrim(COALESCE(v_primary_source->>'gbraid', '')), ''),
    'QUEUED'
  )
  ON CONFLICT (site_id, provider_key, external_id)
  WHERE external_id IS NOT NULL
    AND status <> 'VOIDED_BY_REVERSAL'
  DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'already_queued'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT p_sale_id, true, 'enqueued'::text;
END;
$$;


ALTER FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") IS 'Canonical backfill/reconcile path for confirmed sales missing an offline_conversion_queue row. Reuses DB-owned queue shape and dedup invariants.';



CREATE OR REPLACE FUNCTION "public"."record_provider_outcome"("p_site_id" "uuid", "p_provider_key" "text", "p_is_success" boolean, "p_is_transient" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_threshold int := 5;
  v_next_probe timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'record_provider_outcome may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.provider_health_state (site_id, provider_key)
  VALUES (p_site_id, p_provider_key)
  ON CONFLICT (site_id, provider_key) DO NOTHING;

  IF p_is_success THEN
    UPDATE public.provider_health_state
    SET state = 'CLOSED', failure_count = 0, last_failure_at = NULL, opened_at = NULL, next_probe_at = NULL, updated_at = now()
    WHERE site_id = p_site_id AND provider_key = p_provider_key;
    RETURN;
  END IF;

  IF p_is_transient THEN
    UPDATE public.provider_health_state
    SET failure_count = failure_count + 1, last_failure_at = now(), updated_at = now()
    WHERE site_id = p_site_id AND provider_key = p_provider_key;

    UPDATE public.provider_health_state
    SET state = 'OPEN', opened_at = now(),
        next_probe_at = now() + interval '5 minutes' + (random() * interval '60 seconds')
    WHERE site_id = p_site_id AND provider_key = p_provider_key
      AND failure_count >= v_threshold;
    RETURN;
  END IF;

  -- Permanent failure: do not increment failure_count, do not open circuit.
  RETURN;
END;
$$;


ALTER FUNCTION "public"."record_provider_outcome"("p_site_id" "uuid", "p_provider_key" "text", "p_is_success" boolean, "p_is_transient" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_provider_outcome"("p_site_id" "uuid", "p_provider_key" "text", "p_is_success" boolean, "p_is_transient" boolean) IS 'PR5: Record success (reset) or transient (increment, open at 5). service_role only.';



CREATE OR REPLACE FUNCTION "public"."recover_stuck_ingest_fallback"("p_min_age_minutes" integer DEFAULT 120) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated int;
  v_cutoff timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_ingest_fallback may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (p_min_age_minutes || ' minutes')::interval;

  WITH updated AS (
    UPDATE public.ingest_fallback_buffer
    SET status = 'PENDING', updated_at = now()
    WHERE status = 'PROCESSING'
      AND updated_at < v_cutoff
    RETURNING id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."recover_stuck_ingest_fallback"("p_min_age_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recover_stuck_ingest_fallback"("p_min_age_minutes" integer) IS 'Reset ingest_fallback_buffer PROCESSING rows older than p_min_age_minutes to PENDING. service_role only.';



CREATE OR REPLACE FUNCTION "public"."recover_stuck_offline_conversion_jobs"("p_min_age_minutes" integer DEFAULT 120) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_failed_ids uuid[] := ARRAY[]::uuid[];
  v_retry_ids uuid[] := ARRAY[]::uuid[];
  v_cutoff timestamptz := now() - (p_min_age_minutes || ' minutes')::interval;
  v_failed int := 0;
  v_retry int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_offline_conversion_jobs may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_failed_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status = 'PROCESSING'
    AND (q.retry_count >= 7 OR q.attempt_count >= 7)
    AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff));

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_retry_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status = 'PROCESSING'
    AND q.retry_count < 7
    AND q.attempt_count < 7
    AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff));

  v_failed := public.append_sweeper_transition_batch(
    v_failed_ids,
    'FAILED',
    now(),
    'Zombie recovered: max retries exhausted'
  );

  v_retry := public.append_sweeper_transition_batch(
    v_retry_ids,
    'RETRY',
    now(),
    NULL
  );

  RETURN v_retry + v_failed;
END;
$$;


ALTER FUNCTION "public"."recover_stuck_offline_conversion_jobs"("p_min_age_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recover_stuck_offline_conversion_jobs"("p_min_age_minutes" integer) IS 'Phase 23C sweeper-owned zombie recovery path. Delegates to append_sweeper_transition_batch for FAILED or RETRY recovery.';



CREATE OR REPLACE FUNCTION "public"."reset_business_data_before_cutoff_v1"("p_cutoff" timestamp with time zone, "p_dry_run" boolean DEFAULT true) RETURNS TABLE("step" "text", "affected" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'reset_business_data_before_cutoff_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'cutoff_required' USING ERRCODE = '22004';
  END IF;

  IF p_cutoff >= now() THEN
    RAISE EXCEPTION 'cutoff_must_be_in_the_past' USING ERRCODE = '22007';
  END IF;

  DROP TABLE IF EXISTS tmp_reset_summary;
  DROP TABLE IF EXISTS tmp_old_sessions;
  DROP TABLE IF EXISTS tmp_old_events;
  DROP TABLE IF EXISTS tmp_old_calls;
  DROP TABLE IF EXISTS tmp_old_conversations;
  DROP TABLE IF EXISTS tmp_old_sales;
  DROP TABLE IF EXISTS tmp_old_snapshots;
  DROP TABLE IF EXISTS tmp_old_sync_dlq;
  DROP TABLE IF EXISTS tmp_old_queue;
  DROP TABLE IF EXISTS tmp_old_signals;

  CREATE TEMP TABLE tmp_reset_summary (step text PRIMARY KEY, affected bigint NOT NULL DEFAULT 0) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_old_sessions ON COMMIT DROP AS SELECT s.id FROM public.sessions s WHERE s.created_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_events ON COMMIT DROP AS SELECT e.id FROM public.events e WHERE e.created_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_calls ON COMMIT DROP AS SELECT c.id FROM public.calls c WHERE c.created_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_conversations ON COMMIT DROP AS SELECT c.id FROM public.conversations c WHERE c.created_at < p_cutoff OR c.primary_call_id IN (SELECT id FROM tmp_old_calls) OR c.primary_session_id IN (SELECT id FROM tmp_old_sessions);
  CREATE TEMP TABLE tmp_old_sales ON COMMIT DROP AS SELECT s.id FROM public.sales s WHERE COALESCE(s.occurred_at, s.created_at) < p_cutoff OR s.conversation_id IN (SELECT id FROM tmp_old_conversations);
  CREATE TEMP TABLE tmp_old_snapshots ON COMMIT DROP AS SELECT r.id FROM public.revenue_snapshots r WHERE r.created_at < p_cutoff OR r.call_id IN (SELECT id FROM tmp_old_calls) OR r.sale_id IN (SELECT id FROM tmp_old_sales);
  CREATE TEMP TABLE tmp_old_sync_dlq ON COMMIT DROP AS SELECT d.id FROM public.sync_dlq d WHERE d.received_at < p_cutoff;
  CREATE TEMP TABLE tmp_old_queue ON COMMIT DROP AS SELECT q.id FROM public.offline_conversion_queue q WHERE q.call_id IN (SELECT id FROM tmp_old_calls) OR q.sale_id IN (SELECT id FROM tmp_old_sales) OR COALESCE(q.occurred_at, q.conversion_time, q.created_at) < p_cutoff;
  CREATE TEMP TABLE tmp_old_signals ON COMMIT DROP AS SELECT m.id FROM public.marketing_signals m WHERE m.call_id IN (SELECT id FROM tmp_old_calls) OR COALESCE(m.occurred_at, m.recorded_at, m.created_at) < p_cutoff;

  INSERT INTO tmp_reset_summary(step, affected) VALUES ('provider_dispatches',0),('revenue_snapshots',0),('outbox_events',0),('marketing_signals_history',0),('marketing_signals',0),('offline_conversion_tombstones',0),('oci_queue_transitions',0),('offline_conversion_queue',0),('sales',0),('conversation_links',0),('conversations',0),('call_scores',0),('call_actions',0),('calls',0),('events',0),('sessions',0),('processed_signals',0),('ingest_idempotency',0),('ingest_fallback_buffer',0),('sync_dlq_replay_audit',0),('sync_dlq',0),('audit_log',0),('gdpr_consents',0),('shadow_decisions',0),('causal_dna_ledger',0),('causal_dna_ledger_failures',0),('system_integrity_merkle',0),('signal_entropy_by_fingerprint',0),('conversions',0),('ingest_publish_failures',0);
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.provider_dispatches pd WHERE pd.snapshot_id IN (SELECT id FROM tmp_old_snapshots) OR pd.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'provider_dispatches';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.revenue_snapshots r WHERE r.id IN (SELECT id FROM tmp_old_snapshots)) AS sub WHERE tmp_reset_summary.step = 'revenue_snapshots';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.outbox_events o WHERE o.call_id IN (SELECT id FROM tmp_old_calls) OR o.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'outbox_events';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.marketing_signals_history h WHERE h.call_id IN (SELECT id FROM tmp_old_calls) OR h.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'marketing_signals_history';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.marketing_signals m WHERE m.id IN (SELECT id FROM tmp_old_signals)) AS sub WHERE tmp_reset_summary.step = 'marketing_signals';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.offline_conversion_tombstones t WHERE t.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'offline_conversion_tombstones';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.oci_queue_transitions t WHERE t.queue_id IN (SELECT id FROM tmp_old_queue) OR t.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'oci_queue_transitions';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.offline_conversion_queue q WHERE q.id IN (SELECT id FROM tmp_old_queue)) AS sub WHERE tmp_reset_summary.step = 'offline_conversion_queue';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.sales s WHERE s.id IN (SELECT id FROM tmp_old_sales)) AS sub WHERE tmp_reset_summary.step = 'sales';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.conversation_links cl WHERE cl.conversation_id IN (SELECT id FROM tmp_old_conversations) OR (cl.entity_type = 'call' AND cl.entity_id IN (SELECT id FROM tmp_old_calls)) OR (cl.entity_type = 'session' AND cl.entity_id IN (SELECT id FROM tmp_old_sessions)) OR (cl.entity_type = 'event' AND cl.entity_id IN (SELECT id FROM tmp_old_events)) OR cl.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'conversation_links';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.conversations c WHERE c.id IN (SELECT id FROM tmp_old_conversations)) AS sub WHERE tmp_reset_summary.step = 'conversations';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.call_scores cs WHERE cs.call_id IN (SELECT id FROM tmp_old_calls) OR cs.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'call_scores';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.call_actions ca WHERE ca.call_id IN (SELECT id FROM tmp_old_calls) OR ca.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'call_actions';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.calls c WHERE c.id IN (SELECT id FROM tmp_old_calls)) AS sub WHERE tmp_reset_summary.step = 'calls';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.events e WHERE e.id IN (SELECT id FROM tmp_old_events)) AS sub WHERE tmp_reset_summary.step = 'events';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.sessions s WHERE s.id IN (SELECT id FROM tmp_old_sessions)) AS sub WHERE tmp_reset_summary.step = 'sessions';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.processed_signals p WHERE p.received_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'processed_signals';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.ingest_idempotency i WHERE i.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'ingest_idempotency';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.ingest_fallback_buffer b WHERE b.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'ingest_fallback_buffer';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.sync_dlq_replay_audit a WHERE a.dlq_id IN (SELECT id FROM tmp_old_sync_dlq) OR a.replayed_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'sync_dlq_replay_audit';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.sync_dlq d WHERE d.id IN (SELECT id FROM tmp_old_sync_dlq)) AS sub WHERE tmp_reset_summary.step = 'sync_dlq';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.audit_log a WHERE a.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'audit_log';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.gdpr_consents g WHERE g.consent_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'gdpr_consents';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.shadow_decisions s WHERE s.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'shadow_decisions';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.causal_dna_ledger c WHERE c.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'causal_dna_ledger';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.causal_dna_ledger_failures c WHERE c.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'causal_dna_ledger_failures';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.system_integrity_merkle s WHERE s.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'system_integrity_merkle';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.signal_entropy_by_fingerprint s WHERE s.updated_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'signal_entropy_by_fingerprint';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.conversions c WHERE c.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'conversions';
  UPDATE tmp_reset_summary SET affected = sub.cnt FROM (SELECT count(*)::bigint AS cnt FROM public.ingest_publish_failures i WHERE i.created_at < p_cutoff) AS sub WHERE tmp_reset_summary.step = 'ingest_publish_failures';

  IF p_dry_run THEN RETURN QUERY SELECT s.step, s.affected FROM tmp_reset_summary s WHERE s.affected > 0 ORDER BY s.step; RETURN; END IF;

  PERFORM set_config('statement_timeout', '0', true);
  PERFORM set_config('app.opsmantik_reset_mode', 'on', true);

  DELETE FROM public.provider_dispatches WHERE snapshot_id IN (SELECT id FROM tmp_old_snapshots) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'provider_dispatches';
  DELETE FROM public.revenue_snapshots WHERE id IN (SELECT id FROM tmp_old_snapshots); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'revenue_snapshots';
  DELETE FROM public.outbox_events WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'outbox_events';
  DELETE FROM public.marketing_signals_history WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'marketing_signals_history';
  DELETE FROM public.marketing_signals WHERE id IN (SELECT id FROM tmp_old_signals); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'marketing_signals';
  DELETE FROM public.offline_conversion_tombstones WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'offline_conversion_tombstones';
  DELETE FROM public.oci_queue_transitions WHERE queue_id IN (SELECT id FROM tmp_old_queue) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'oci_queue_transitions';
  DELETE FROM public.offline_conversion_queue WHERE id IN (SELECT id FROM tmp_old_queue); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'offline_conversion_queue';
  DELETE FROM public.sales WHERE id IN (SELECT id FROM tmp_old_sales); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sales';
  DELETE FROM public.conversation_links WHERE conversation_id IN (SELECT id FROM tmp_old_conversations) OR (entity_type = 'call' AND entity_id IN (SELECT id FROM tmp_old_calls)) OR (entity_type = 'session' AND entity_id IN (SELECT id FROM tmp_old_sessions)) OR (entity_type = 'event' AND entity_id IN (SELECT id FROM tmp_old_events)) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'conversation_links';
  DELETE FROM public.conversations WHERE id IN (SELECT id FROM tmp_old_conversations); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'conversations';
  DELETE FROM public.call_scores WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'call_scores';
  DELETE FROM public.call_actions WHERE call_id IN (SELECT id FROM tmp_old_calls) OR created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'call_actions';
  DELETE FROM public.calls WHERE id IN (SELECT id FROM tmp_old_calls); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'calls';
  DELETE FROM public.events WHERE id IN (SELECT id FROM tmp_old_events); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'events';
  DELETE FROM public.sessions WHERE id IN (SELECT id FROM tmp_old_sessions); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sessions';
  DELETE FROM public.processed_signals WHERE received_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'processed_signals';
  DELETE FROM public.ingest_idempotency WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'ingest_idempotency';
  DELETE FROM public.ingest_fallback_buffer WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'ingest_fallback_buffer';
  DELETE FROM public.sync_dlq_replay_audit WHERE dlq_id IN (SELECT id FROM tmp_old_sync_dlq) OR replayed_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sync_dlq_replay_audit';
  DELETE FROM public.sync_dlq WHERE id IN (SELECT id FROM tmp_old_sync_dlq); GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'sync_dlq';
  DELETE FROM public.audit_log WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'audit_log';
  DELETE FROM public.gdpr_consents WHERE consent_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'gdpr_consents';
  DELETE FROM public.shadow_decisions WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'shadow_decisions';
  DELETE FROM public.causal_dna_ledger WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'causal_dna_ledger';
  DELETE FROM public.causal_dna_ledger_failures WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'causal_dna_ledger_failures';
  DELETE FROM public.system_integrity_merkle WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'system_integrity_merkle';
  DELETE FROM public.signal_entropy_by_fingerprint WHERE updated_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'signal_entropy_by_fingerprint';
  DELETE FROM public.conversions WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'conversions';
  DELETE FROM public.ingest_publish_failures WHERE created_at < p_cutoff; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE tmp_reset_summary SET affected = v_count WHERE tmp_reset_summary.step = 'ingest_publish_failures';

  RETURN QUERY SELECT s.step, s.affected FROM tmp_reset_summary s WHERE s.affected > 0 ORDER BY s.step;
END;
$$;


ALTER FUNCTION "public"."reset_business_data_before_cutoff_v1"("p_cutoff" timestamp with time zone, "p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reset_business_data_before_cutoff_v1"("p_cutoff" timestamp with time zone, "p_dry_run" boolean) IS 'Maintenance reset kernel. Deletes business/runtime data older than cutoff; dry-run supported; service_role only.';



CREATE OR REPLACE FUNCTION "public"."resolve_conversation_with_sale_link"("p_conversation_id" "uuid", "p_status" "text", "p_note" "text" DEFAULT NULL::"text", "p_sale_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_conversation public.conversations%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_uid uuid;
BEGIN
  IF p_status NOT IN ('WON', 'LOST', 'JUNK') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_status', ERRCODE = 'P0001';
  END IF;

  v_uid := auth.uid();

  SELECT * INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'conversation_not_found', ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NOT NULL AND NOT public.can_access_site(v_uid, v_conversation.site_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', ERRCODE = 'P0001';
  END IF;

  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001';
    END IF;

    IF v_sale.site_id IS DISTINCT FROM v_conversation.site_id THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_site_mismatch', ERRCODE = 'P0001';
    END IF;

    IF v_sale.conversation_id IS NOT NULL AND v_sale.conversation_id IS DISTINCT FROM v_conversation.id THEN
      RAISE EXCEPTION USING MESSAGE = 'sale_already_linked_elsewhere', ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.conversations
  SET
    status = p_status,
    note = CASE WHEN p_note IS NULL THEN note ELSE p_note END,
    updated_at = now()
  WHERE id = v_conversation.id
  RETURNING * INTO v_conversation;

  IF p_sale_id IS NOT NULL THEN
    UPDATE public.sales
    SET
      conversation_id = v_conversation.id,
      updated_at = now()
    WHERE id = p_sale_id
    RETURNING * INTO v_sale;

    IF v_sale.status = 'CONFIRMED' THEN
      PERFORM public.update_offline_conversion_queue_attribution(p_sale_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_conversation.id,
    'site_id', v_conversation.site_id,
    'status', v_conversation.status,
    'note', v_conversation.note,
    'primary_call_id', v_conversation.primary_call_id,
    'primary_session_id', v_conversation.primary_session_id,
    'primary_source', v_conversation.primary_source,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at
  );
END;
$$;


ALTER FUNCTION "public"."resolve_conversation_with_sale_link"("p_conversation_id" "uuid", "p_status" "text", "p_note" "text", "p_sale_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_conversation_with_sale_link"("p_conversation_id" "uuid", "p_status" "text", "p_note" "text", "p_sale_id" "uuid") IS 'Atomically resolves a conversation, optionally links a same-site sale, and backfills OCI attribution before any split-brain state can be committed.';



CREATE OR REPLACE FUNCTION "public"."resolve_site_identifier_v1"("p_input" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_site_id uuid;
BEGIN
  IF p_input IS NULL OR length(trim(p_input)) = 0 THEN
    RETURN NULL;
  END IF;

  -- 1) UUID path (must exist in sites)
  BEGIN
    v_site_id := p_input::uuid;
    SELECT s.id INTO v_site_id
    FROM public.sites s
    WHERE s.id = v_site_id
    LIMIT 1;

    IF v_site_id IS NOT NULL THEN
      RETURN v_site_id;
    END IF;
  EXCEPTION WHEN others THEN
    -- ignore invalid UUID casts
    NULL;
  END;

  -- 2) 32-hex public id path
  IF p_input ~* '^[a-f0-9]{32}$' THEN
    SELECT s.id INTO v_site_id
    FROM public.sites s
    WHERE s.public_id = lower(p_input)
    LIMIT 1;
    RETURN v_site_id;
  END IF;

  RETURN NULL;
END;
$_$;


ALTER FUNCTION "public"."resolve_site_identifier_v1"("p_input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_updated public.calls%ROWTYPE;
  v_action text := lower(COALESCE(NULLIF(btrim(p_action), ''), ''));
  v_next_review_status text;
  v_next_oci_status text;
  v_now timestamptz := now();
  v_uid uuid := auth.uid();
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id_required' USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_review_action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_uid IS NULL OR p_actor_id IS DISTINCT FROM v_uid OR NOT public.can_access_site(v_uid, v_call.site_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF COALESCE(v_call.sale_review_status, 'NONE') <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'call_sale_not_pending_approval' USING ERRCODE = 'P0001';
  END IF;

  v_next_review_status := CASE WHEN v_action = 'approve' THEN 'APPROVED' ELSE 'REJECTED' END;
  v_next_oci_status := CASE
    WHEN v_action = 'approve' THEN
      CASE
        WHEN v_call.lead_score = 100 THEN 'sealed'
        WHEN v_call.lead_score IS NOT NULL AND v_call.lead_score >= 10 THEN 'intent'
        ELSE 'skipped'
      END
    ELSE 'pending_approval'
  END;

  UPDATE public.calls
  SET
    sale_review_status = v_next_review_status,
    sale_review_requested_at = CASE WHEN v_action = 'approve' THEN NULL ELSE sale_review_requested_at END,
    oci_status = v_next_oci_status,
    oci_status_updated_at = v_now,
    updated_at = v_now,
    version = version + 1
  WHERE id = p_call_id
  RETURNING * INTO v_updated;

  IF v_action = 'approve' AND v_next_oci_status <> 'skipped' THEN
    INSERT INTO public.outbox_events (event_type, payload, call_id, site_id, status)
    VALUES (
      'IntentSealed',
      jsonb_build_object(
        'call_id', v_updated.id,
        'site_id', v_updated.site_id,
        'lead_score', v_updated.lead_score,
        'confirmed_at', v_updated.confirmed_at,
        'created_at', v_updated.created_at,
        'sale_amount', v_updated.sale_amount,
        'currency', COALESCE(v_updated.currency, 'TRY'),
        'oci_status', v_updated.oci_status,
        'sale_occurred_at', v_updated.sale_occurred_at,
        'sale_source_timestamp', v_updated.sale_source_timestamp,
        'sale_time_confidence', v_updated.sale_time_confidence,
        'sale_occurred_at_source', v_updated.sale_occurred_at_source,
        'sale_entry_reason', v_updated.sale_entry_reason
      ),
      v_updated.id,
      v_updated.site_id,
      'PENDING'
    );
  END IF;

  INSERT INTO public.call_actions (call_id, site_id, action_type, actor_type, actor_id, previous_status, new_status, revert_snapshot, metadata)
  VALUES (
    v_updated.id,
    v_updated.site_id,
    CASE WHEN v_action = 'approve' THEN 'sale_review_approve' ELSE 'sale_review_reject' END,
    CASE WHEN auth.role() = 'service_role' THEN 'system' ELSE 'user' END,
    p_actor_id,
    v_call.status,
    v_updated.status,
    to_jsonb(v_call),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'previous_review_status', v_call.sale_review_status,
      'next_review_status', v_updated.sale_review_status,
      'next_oci_status', v_updated.oci_status
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;


ALTER FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") IS 'Atomically approves or rejects backdated call sale times, updating calls and emitting IntentSealed outbox rows in the same transaction.';



CREATE OR REPLACE FUNCTION "public"."revive_dead_cohort"("p_filter" "jsonb" DEFAULT '{}'::"jsonb", "p_limit" integer DEFAULT 1000, "p_dry_run" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count int := 0;
  v_revived int := 0;
  v_row record;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_site_id uuid;
  v_error_type text;
  v_order_id text;
  v_payload jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  v_site_id := (p_filter->>'site_id')::uuid;
  v_error_type := p_filter->>'error_type';
  IF p_filter ? 'date_range' THEN
    v_from_ts := (p_filter->'date_range'->>'from')::timestamptz;
    v_to_ts := (p_filter->'date_range'->>'to')::timestamptz;
  END IF;

  FOR v_row IN
    SELECT t.id, t.site_id, t.provider_key, t.payload, t.queue_snapshot, t.failure_summary
    FROM public.offline_conversion_tombstones t
    WHERE (v_site_id IS NULL OR t.site_id = v_site_id)
      AND (v_from_ts IS NULL OR t.created_at >= v_from_ts)
      AND (v_to_ts IS NULL OR t.created_at <= v_to_ts)
      AND (v_error_type IS NULL OR t.failure_summary->>'last_error' ILIKE '%' || v_error_type || '%')
    ORDER BY t.created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 5000)
  LOOP
    v_count := v_count + 1;
    v_order_id := COALESCE(v_row.payload->>'order_id', v_row.queue_snapshot->>'order_id', '') || '_revived';
    v_payload := jsonb_set(COALESCE(v_row.payload, '{}'::jsonb), '{order_id}', to_jsonb(v_order_id));

    IF NOT p_dry_run THEN
      INSERT INTO public.offline_conversion_queue (
        site_id, sale_id, call_id, provider_key, payload, status, retry_count, attempt_count,
        conversion_time, value_cents, currency, gclid, wbraid, gbraid, created_at, updated_at
      )
      SELECT
        v_row.site_id,
        (v_row.queue_snapshot->>'sale_id')::uuid,
        (v_row.queue_snapshot->>'call_id')::uuid,
        v_row.provider_key,
        v_payload,
        'QUEUED',
        0,
        0,
        COALESCE((v_row.queue_snapshot->>'conversion_time')::timestamptz, now()),
        COALESCE((v_row.queue_snapshot->>'value_cents')::bigint, 0),
        COALESCE(v_row.queue_snapshot->>'currency', 'TRY'),
        v_row.queue_snapshot->>'gclid',
        v_row.queue_snapshot->>'wbraid',
        v_row.queue_snapshot->>'gbraid',
        now(),
        now()
      WHERE (
          (v_row.queue_snapshot->>'sale_id')::uuid IS NOT NULL
          OR (v_row.queue_snapshot->>'call_id')::uuid IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.offline_conversion_queue q
          WHERE q.site_id = v_row.site_id AND q.payload->>'order_id' = v_order_id
        );

      IF FOUND THEN
        DELETE FROM public.offline_conversion_tombstones WHERE id = v_row.id;
        v_revived := v_revived + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'would_revive', v_count,
    'revived', v_revived
  );
END;
$$;


ALTER FUNCTION "public"."revive_dead_cohort"("p_filter" "jsonb", "p_limit" integer, "p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revive_dead_cohort"("p_filter" "jsonb", "p_limit" integer, "p_dry_run" boolean) IS 'Resurrect tombstone rows to queue. p_dry_run=true by default. service_role only.';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rotate_site_secret_v1"("p_site_public_id" "text", "p_current_secret" "text", "p_next_secret" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
DECLARE
  v_site_id uuid;
BEGIN
  IF p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RAISE EXCEPTION 'site_public_id is required';
  END IF;
  SELECT id INTO v_site_id
  FROM public.sites
  WHERE public_id = p_site_public_id
  LIMIT 1;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'site not found';
  END IF;

  PERFORM private.set_site_secrets_v1(v_site_id, p_current_secret, p_next_secret);
END;
$$;


ALTER FUNCTION "public"."rotate_site_secret_v1"("p_site_public_id" "text", "p_current_secret" "text", "p_next_secret" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_conversation_site_check"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sales_conversation_site_check"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_conversation_site_check"() IS 'Trigger: ensures sales.conversation_id references a conversation in the same site as sales.site_id.';



CREATE OR REPLACE FUNCTION "public"."sales_finalized_identity_immutable_check"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'DRAFT'
     AND (
       NEW.site_id IS DISTINCT FROM OLD.site_id
       OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
       OR NEW.customer_hash IS DISTINCT FROM OLD.customer_hash
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'sales: finalized identity fields are immutable',
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sales_finalized_identity_immutable_check"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_finalized_identity_immutable_check"() IS 'Trigger: prevents non-DRAFT sales from mutating monetary identity fields during external_ref replays or manual writes.';



CREATE OR REPLACE FUNCTION "public"."set_provider_state_half_open"("p_site_id" "uuid", "p_provider_key" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'set_provider_state_half_open may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  UPDATE public.provider_health_state
  SET state = 'HALF_OPEN', updated_at = now()
  WHERE site_id = p_site_id AND provider_key = p_provider_key;
END;
$$;


ALTER FUNCTION "public"."set_provider_state_half_open"("p_site_id" "uuid", "p_provider_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_provider_state_half_open"("p_site_id" "uuid", "p_provider_key" "text") IS 'PR5: Set state to HALF_OPEN for probe. service_role only.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_updated_at"() IS 'Standard trigger: set updated_at = NOW() on row update.';



CREATE OR REPLACE FUNCTION "public"."sites_before_insert_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Slug-friendly public_id if not provided (null or empty)
  IF NEW.public_id IS NULL OR trim(NEW.public_id) = '' THEN
    NEW.public_id := 'site-' || encode(gen_random_bytes(6), 'hex');
  END IF;

  -- Secure oci_api_key if not provided
  IF NEW.oci_api_key IS NULL OR trim(NEW.oci_api_key) = '' THEN
    NEW.oci_api_key := encode(gen_random_bytes(32), 'hex');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sites_before_insert_identity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sites_before_insert_identity"() IS 'Identity Protocol: auto public_id and oci_api_key on Site creation';



CREATE OR REPLACE FUNCTION "public"."sync_dlq_record_replay"("p_id" "uuid", "p_error" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "replay_count" integer, "last_replay_at" timestamp with time zone, "last_replay_error" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.sync_dlq
  SET
    replay_count = COALESCE(replay_count, 0) + 1,
    last_replay_at = NOW(),
    last_replay_error = p_error
  WHERE public.sync_dlq.id = p_id
  RETURNING public.sync_dlq.id, public.sync_dlq.replay_count, public.sync_dlq.last_replay_at, public.sync_dlq.last_replay_error
  INTO id, replay_count, last_replay_at, last_replay_error;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING MESSAGE = 'DLQ row not found';
  END IF;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."sync_dlq_record_replay"("p_id" "uuid", "p_error" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_dlq_record_replay"("p_id" "uuid", "p_error" "text") IS 'Atomic replay bookkeeping for sync_dlq: increments replay_count and stores last_replay_* fields.';



CREATE OR REPLACE FUNCTION "public"."sync_user_emails_from_auth"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- If email is removed/blanked, delete mapping row.
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    DELETE FROM public.user_emails ue WHERE ue.id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.user_emails (id, email, email_lc, updated_at)
  VALUES (NEW.id, NEW.email, lower(NEW.email), now())
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        email_lc = EXCLUDED.email_lc,
        updated_at = now();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_emails_from_auth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_calls_enforce_session_created_month"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.matched_session_id IS NOT NULL AND NEW.session_created_month IS NULL THEN
    NEW.session_created_month := date_trunc('month', (COALESCE(NEW.matched_at, now()) AT TIME ZONE 'utc'))::date;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_calls_enforce_session_created_month"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_calls_enforce_session_created_month"() IS 'Ensures session_created_month is set when matched_session_id present. Enables partition pruning on sessions JOIN.';



CREATE OR REPLACE FUNCTION "public"."trg_events_set_session_month_from_session"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_month date;
  v_site uuid;
BEGIN
  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'events.session_id cannot be NULL';
  END IF;
  
  -- Lookup session's created_month (trigger ensures it's correct)
  SELECT s.created_month, s.site_id
    INTO v_month, v_site
  FROM public.sessions s
  WHERE s.id = NEW.session_id
  LIMIT 1;
  
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'Session % not found for event insert/update', NEW.session_id;
  END IF;
  
  -- CRITICAL: Always override session_month (even if worker sent it)
  NEW.session_month := v_month;
  
  -- Backfill site_id if NULL
  IF NEW.site_id IS NULL THEN
    NEW.site_id := v_site;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_events_set_session_month_from_session"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_events_set_session_month_from_session"() IS 'ALWAYS sets events.session_month = sessions.created_month. Overrides any explicit session_month from worker.';



CREATE OR REPLACE FUNCTION "public"."trg_sessions_set_created_month"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Ensure created_at is set (default fallback)
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;
  
  -- CRITICAL: Always compute from created_at UTC (matches partition logic)
  NEW.created_month := date_trunc('month', (NEW.created_at AT TIME ZONE 'utc'))::date;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_sessions_set_created_month"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_sessions_set_created_month"() IS 'ALWAYS sets sessions.created_month = date_trunc(month, created_at UTC)::date. Overrides any explicit dbMonth from worker.';



CREATE OR REPLACE FUNCTION "public"."trigger_calls_notify_hunter_ai"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'net', 'extensions'
    AS $$
DECLARE
  v_url text;
  v_key text;
  v_headers jsonb;
  v_body jsonb;
BEGIN
  -- Only high-intent: source = 'click' and intent_action in ('phone', 'whatsapp')
  IF NEW.source IS DISTINCT FROM 'click' OR NEW.intent_action IS NULL OR NEW.intent_action NOT IN ('phone', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  -- private.api_keys tablosundan oku (Vault yerine)
  SELECT key_value INTO v_url FROM private.api_keys WHERE key_name = 'project_url';
  SELECT key_value INTO v_key FROM private.api_keys WHERE key_name = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'hunter_ai: project_url or service_role_key missing in private.api_keys; skipping.';
    RETURN NEW;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/hunter-ai';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_key
  );
  v_body := jsonb_build_object(
    'type', 'INSERT',
    'table', 'calls',
    'record', to_jsonb(NEW)
  );

  PERFORM net.http_post(
    url := v_url,
    body := v_body,
    params := '{}'::jsonb,
    headers := v_headers,
    timeout_milliseconds := 10000
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'hunter_ai trigger hatas─▒: %', SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_calls_notify_hunter_ai"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trigger_calls_notify_hunter_ai"() IS 'On high-intent call insert, POST to hunter-ai Edge Function via pg_net. Reads project_url and service_role_key from private.api_keys.';



CREATE OR REPLACE FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text" DEFAULT 'user'::"text", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_actor_type text;
  v_actor_id uuid;
  v_current public.calls%ROWTYPE;
  v_site_id uuid;
  v_last_action record;
  v_prev jsonb;
  v_prev_status text;
  v_new_status text;
  v_revert_of_undo jsonb;
  v_updated public.calls%ROWTYPE;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type NOT IN ('user','system') THEN
    RAISE EXCEPTION 'invalid_actor_type' USING ERRCODE = '22023';
  END IF;

  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
    v_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_current
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  v_site_id := v_current.site_id;

  SELECT
    a.id,
    a.action_type,
    a.previous_status,
    a.new_status,
    a.revert_snapshot,
    a.created_at
  INTO v_last_action
  FROM public.call_actions a
  WHERE a.call_id = p_call_id
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1;

  IF v_last_action IS NULL THEN
    RAISE EXCEPTION 'no_actions_to_undo' USING ERRCODE = '22023';
  END IF;

  IF v_last_action.action_type = 'undo' THEN
    RAISE EXCEPTION 'last_action_is_undo' USING ERRCODE = '40900';
  END IF;

  v_prev := v_last_action.revert_snapshot;
  IF v_prev IS NULL OR jsonb_typeof(v_prev) <> 'object' THEN
    RAISE EXCEPTION 'invalid_revert_snapshot' USING ERRCODE = '22023';
  END IF;

  v_prev_status := v_current.status;
  v_new_status := NULLIF(btrim(COALESCE(v_prev->>'status','')), '');
  v_revert_of_undo := to_jsonb(v_current);

  UPDATE public.calls
  SET
    status = v_new_status,
    sale_amount = CASE WHEN v_prev ? 'sale_amount' AND NULLIF(btrim(COALESCE(v_prev->>'sale_amount','')), '') IS NOT NULL
      THEN (v_prev->>'sale_amount')::numeric ELSE NULL END,
    estimated_value = CASE WHEN v_prev ? 'estimated_value' AND NULLIF(btrim(COALESCE(v_prev->>'estimated_value','')), '') IS NOT NULL
      THEN (v_prev->>'estimated_value')::numeric ELSE NULL END,
    currency = COALESCE(NULLIF(btrim(COALESCE(v_prev->>'currency','')), ''), v_current.currency),
    confirmed_at = CASE WHEN v_prev ? 'confirmed_at' AND NULLIF(btrim(COALESCE(v_prev->>'confirmed_at','')), '') IS NOT NULL
      THEN (v_prev->>'confirmed_at')::timestamptz ELSE NULL END,
    confirmed_by = CASE WHEN v_prev ? 'confirmed_by' AND NULLIF(btrim(COALESCE(v_prev->>'confirmed_by','')), '') IS NOT NULL
      THEN (v_prev->>'confirmed_by')::uuid ELSE NULL END,
    cancelled_at = CASE WHEN v_prev ? 'cancelled_at' AND NULLIF(btrim(COALESCE(v_prev->>'cancelled_at','')), '') IS NOT NULL
      THEN (v_prev->>'cancelled_at')::timestamptz ELSE NULL END,
    note = CASE WHEN v_prev ? 'note' THEN NULLIF(v_prev->>'note','') ELSE NULL END,
    lead_score = CASE WHEN v_prev ? 'lead_score' AND NULLIF(btrim(COALESCE(v_prev->>'lead_score','')), '') IS NOT NULL
      THEN (v_prev->>'lead_score')::integer ELSE NULL END,
    oci_status = CASE WHEN v_prev ? 'oci_status' THEN NULLIF(v_prev->>'oci_status','') ELSE NULL END,
    oci_status_updated_at = CASE WHEN v_prev ? 'oci_status_updated_at' AND NULLIF(btrim(COALESCE(v_prev->>'oci_status_updated_at','')), '') IS NOT NULL
      THEN (v_prev->>'oci_status_updated_at')::timestamptz ELSE NULL END,
    caller_phone_raw = CASE WHEN v_prev ? 'caller_phone_raw' THEN NULLIF(v_prev->>'caller_phone_raw','') ELSE NULL END,
    caller_phone_e164 = CASE WHEN v_prev ? 'caller_phone_e164' THEN NULLIF(v_prev->>'caller_phone_e164','') ELSE NULL END,
    caller_phone_hash_sha256 = CASE WHEN v_prev ? 'caller_phone_hash_sha256' THEN NULLIF(v_prev->>'caller_phone_hash_sha256','') ELSE NULL END,
    phone_source_type = CASE WHEN v_prev ? 'phone_source_type' THEN NULLIF(v_prev->>'phone_source_type','') ELSE NULL END,
    sale_occurred_at = CASE WHEN v_prev ? 'sale_occurred_at' AND NULLIF(btrim(COALESCE(v_prev->>'sale_occurred_at','')), '') IS NOT NULL
      THEN (v_prev->>'sale_occurred_at')::timestamptz ELSE NULL END,
    sale_source_timestamp = CASE WHEN v_prev ? 'sale_source_timestamp' AND NULLIF(btrim(COALESCE(v_prev->>'sale_source_timestamp','')), '') IS NOT NULL
      THEN (v_prev->>'sale_source_timestamp')::timestamptz ELSE NULL END,
    sale_time_confidence = CASE WHEN v_prev ? 'sale_time_confidence' THEN NULLIF(v_prev->>'sale_time_confidence','') ELSE NULL END,
    sale_occurred_at_source = CASE WHEN v_prev ? 'sale_occurred_at_source' THEN NULLIF(v_prev->>'sale_occurred_at_source','') ELSE NULL END,
    sale_entry_reason = CASE WHEN v_prev ? 'sale_entry_reason' THEN NULLIF(v_prev->>'sale_entry_reason','') ELSE NULL END,
    sale_is_backdated = CASE WHEN v_prev ? 'sale_is_backdated'
      THEN COALESCE((v_prev->>'sale_is_backdated')::boolean, false) ELSE false END,
    sale_backdated_seconds = CASE WHEN v_prev ? 'sale_backdated_seconds' AND NULLIF(btrim(COALESCE(v_prev->>'sale_backdated_seconds','')), '') IS NOT NULL
      THEN (v_prev->>'sale_backdated_seconds')::integer ELSE NULL END,
    sale_review_status = CASE WHEN v_prev ? 'sale_review_status' THEN NULLIF(v_prev->>'sale_review_status','') ELSE NULL END,
    sale_review_requested_at = CASE WHEN v_prev ? 'sale_review_requested_at' AND NULLIF(btrim(COALESCE(v_prev->>'sale_review_requested_at','')), '') IS NOT NULL
      THEN (v_prev->>'sale_review_requested_at')::timestamptz ELSE NULL END,
    updated_at = v_now,
    version = COALESCE(v_current.version, 0) + 1
  WHERE id = p_call_id
  RETURNING * INTO v_updated;

  INSERT INTO public.call_actions (
    call_id,
    site_id,
    action_type,
    actor_type,
    actor_id,
    previous_status,
    new_status,
    revert_snapshot,
    metadata
  ) VALUES (
    p_call_id,
    v_site_id,
    'undo',
    v_actor_type,
    v_actor_id,
    v_prev_status,
    v_new_status,
    v_revert_of_undo,
    jsonb_build_object(
      'undone_action_id', v_last_action.id,
      'undone_action_type', v_last_action.action_type,
      'meta', COALESCE(p_metadata, '{}'::jsonb)
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;


ALTER FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") IS 'Event-Sourcing Lite: reverts the most recent non-undo call action using revert_snapshot, and records an undo action.';



CREATE OR REPLACE FUNCTION "public"."update_fallback_on_publish_failure"("p_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  r jsonb;
  v_id uuid;
  v_error_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'update_fallback_on_publish_failure may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := (r->>'id')::uuid;
    v_error_reason := nullif(trim(r->>'error_reason'), '');

    UPDATE public.ingest_fallback_buffer
    SET
      recover_attempt_count = recover_attempt_count + 1,
      status = CASE
        WHEN recover_attempt_count + 1 >= 10 THEN 'QUARANTINE'::public.ingest_fallback_status
        ELSE 'PENDING'::public.ingest_fallback_status
      END,
      error_reason = v_error_reason,
      updated_at = now()
    WHERE id = v_id;
  END LOOP;

  RETURN (SELECT count(*)::int FROM jsonb_array_elements(p_rows) AS _);
END;
$$;


ALTER FUNCTION "public"."update_fallback_on_publish_failure"("p_rows" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_fallback_on_publish_failure"("p_rows" "jsonb") IS 'Axiomatic: On publish failure, increment recover_attempt_count. At 10 -> QUARANTINE. System halts.';



CREATE OR REPLACE FUNCTION "public"."update_offline_conversion_queue_attribution"("p_sale_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_uid uuid;
  v_queue_status text;
BEGIN
  v_uid := auth.uid();

  SELECT * INTO v_sale FROM public.sales WHERE public.sales.id = p_sale_id FOR UPDATE;

  IF NOT FOUND OR v_sale.status IS DISTINCT FROM 'CONFIRMED' OR v_sale.conversation_id IS NULL THEN
    RETURN;
  END IF;

  -- Tenant isolation: authenticated callers must have access to sale's site
  IF v_uid IS NOT NULL THEN
    IF NOT public.can_access_site(v_uid, v_sale.site_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT q.status INTO v_queue_status
  FROM public.offline_conversion_queue q
  WHERE q.sale_id = p_sale_id AND q.site_id = v_sale.site_id
  LIMIT 1;

  IF v_queue_status IS NULL THEN
    RETURN;
  END IF;

  IF v_queue_status NOT IN ('QUEUED', 'PROCESSING') THEN
    RAISE EXCEPTION USING MESSAGE = 'immutable_after_sent',
      DETAIL = 'Queue attribution cannot be updated when status is ' || COALESCE(v_queue_status, 'unknown'),
      ERRCODE = 'P0001';
  END IF;

  SELECT c.primary_source INTO v_primary_source
  FROM public.conversations c
  WHERE c.id = v_sale.conversation_id
  LIMIT 1;
  IF v_primary_source IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.offline_conversion_queue q
  SET
    gclid = COALESCE(v_primary_source->>'gclid', q.gclid),
    wbraid = COALESCE(v_primary_source->>'wbraid', q.wbraid),
    gbraid = COALESCE(v_primary_source->>'gbraid', q.gbraid),
    updated_at = now()
  WHERE q.sale_id = p_sale_id
    AND q.site_id = v_sale.site_id
    AND q.status IN ('QUEUED', 'PROCESSING');
END;
$$;


ALTER FUNCTION "public"."update_offline_conversion_queue_attribution"("p_sale_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_offline_conversion_queue_attribution"("p_sale_id" "uuid") IS 'P1 Late linking: backfill gclid/wbraid/gbraid from conversation. Only when queue status is QUEUED or PROCESSING; immutable after COMPLETED/FAILED. Enforces tenant access.';



CREATE OR REPLACE FUNCTION "public"."update_queue_status_locked"("p_ids" "uuid"[], "p_site_id" "uuid", "p_action" "text", "p_clear_errors" boolean DEFAULT false, "p_error_code" "text" DEFAULT 'MANUAL_FAIL'::"text", "p_error_category" "text" DEFAULT 'PERMANENT'::"text", "p_reason" "text" DEFAULT 'MANUALLY_MARKED_FAILED'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_affected int := 0;
  v_now timestamptz := now();
  v_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'update_queue_status_locked may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  CASE p_action
    WHEN 'RETRY_SELECTED' THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
      INTO v_queue_ids
      FROM public.offline_conversion_queue AS q
      WHERE q.id = ANY(p_ids)
        AND q.site_id = p_site_id
        AND q.status IN ('FAILED', 'RETRY');

      v_affected := public.append_manual_transition_batch(v_queue_ids, 'QUEUED', v_now, false, NULL, NULL, NULL);

    WHEN 'RESET_TO_QUEUED' THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
      INTO v_queue_ids
      FROM public.offline_conversion_queue AS q
      WHERE q.id = ANY(p_ids)
        AND q.site_id = p_site_id
        AND q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'FAILED');

      v_affected := public.append_manual_transition_batch(
        v_queue_ids,
        'QUEUED',
        v_now,
        COALESCE(p_clear_errors, false),
        NULL,
        NULL,
        NULL
      );

    WHEN 'MARK_FAILED' THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
      INTO v_queue_ids
      FROM public.offline_conversion_queue AS q
      WHERE q.id = ANY(p_ids)
        AND q.site_id = p_site_id
        AND q.status IN ('PROCESSING', 'QUEUED', 'RETRY');

      v_affected := public.append_manual_transition_batch(
        v_queue_ids,
        'FAILED',
        v_now,
        false,
        p_error_code,
        p_error_category,
        p_reason
      );

    ELSE
      RAISE EXCEPTION USING MESSAGE = 'invalid_action', DETAIL = 'action must be RETRY_SELECTED, RESET_TO_QUEUED, or MARK_FAILED', ERRCODE = 'P0001';
  END CASE;

  RETURN v_affected;
END;
$$;


ALTER FUNCTION "public"."update_queue_status_locked"("p_ids" "uuid"[], "p_site_id" "uuid", "p_action" "text", "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_queue_status_locked"("p_ids" "uuid"[], "p_site_id" "uuid", "p_action" "text", "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") IS 'Phase 23C compat wrapper for OCI control actions. Delegates to append_manual_transition_batch.';



CREATE OR REPLACE FUNCTION "public"."utc_year_month"("ts" timestamp with time zone) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM');
$$;


ALTER FUNCTION "public"."utc_year_month"("ts" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."utc_year_month"("ts" timestamp with time zone) IS 'Revenue Kernel: UTC month YYYY-MM from timestamptz. Used by ingest_idempotency.year_month generated column.';



CREATE OR REPLACE FUNCTION "public"."validate_date_range"("p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_range_days int;
  v_max_days int := 180; -- 6 months
BEGIN
  -- Validate dates
  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION 'date_from and date_to are required';
  END IF;
  
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from must be <= date_to';
  END IF;
  
  -- Check max range
  v_range_days := EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 86400;
  
  IF v_range_days > v_max_days THEN
    RAISE EXCEPTION 'Date range exceeds maximum of % days (6 months)', v_max_days;
  END IF;
END;
$$;


ALTER FUNCTION "public"."validate_date_range"("p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_call_event_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_raw_body" "text", "p_signature" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'extensions'
    AS $$
DECLARE
  v_site_id uuid;
  v_curr text;
  v_next text;
  v_msg text;
  v_expected text;
  v_now bigint;
BEGIN
  IF p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RETURN false;
  END IF;
  IF p_ts IS NULL OR p_ts <= 0 THEN
    RETURN false;
  END IF;
  IF p_signature IS NULL OR length(p_signature) <> 64 THEN
    RETURN false;
  END IF;

  -- Replay window protection (same contract as API layer)
  v_now := extract(epoch from now())::bigint;
  IF v_now - p_ts > 300 THEN
    RETURN false;
  END IF;
  IF p_ts - v_now > 60 THEN
    RETURN false;
  END IF;

  v_site_id := public.resolve_site_identifier_v1(p_site_public_id);
  IF v_site_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT current_secret, next_secret
  INTO v_curr, v_next
  FROM private.site_secrets
  WHERE site_id = v_site_id;

  IF v_curr IS NULL OR length(trim(v_curr)) = 0 THEN
    RETURN false;
  END IF;

  v_msg := p_ts::text || '.' || COALESCE(p_raw_body, '');

  v_expected := encode(
    extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_curr, 'utf8'), 'sha256'),
    'hex'
  );
  IF lower(v_expected) = lower(p_signature) THEN
    RETURN true;
  END IF;

  IF v_next IS NOT NULL AND length(trim(v_next)) > 0 THEN
    v_expected := encode(
      extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_next, 'utf8'), 'sha256'),
      'hex'
    );
    IF lower(v_expected) = lower(p_signature) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."verify_call_event_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_raw_body" "text", "p_signature" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_current_events_partition_exists"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_table text;
  v_month text;
  v_exists boolean;
BEGIN
  -- Align with UTC partition naming convention: events_YYYY_MM
  v_month := to_char(date_trunc('month', now() AT TIME ZONE 'utc'), 'YYYY_MM');
  v_table := 'events_' || v_month;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = v_table
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;


ALTER FUNCTION "public"."verify_current_events_partition_exists"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'extensions'
    AS $$
DECLARE
  v_site_id uuid;
  v_curr text;
  v_next text;
  v_msg text;
  v_expected text;
  v_now bigint;
BEGIN
  IF p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RETURN false;
  END IF;
  IF p_ts IS NULL OR p_ts <= 0 THEN
    RETURN false;
  END IF;
  IF p_nonce IS NULL OR length(trim(p_nonce)) = 0 THEN
    RETURN false;
  END IF;
  IF p_signature IS NULL OR length(p_signature) <> 64 THEN
    RETURN false;
  END IF;
  v_now := extract(epoch from now())::bigint;
  IF v_now - p_ts > 300 THEN
    RETURN false;
  END IF;
  IF p_ts - v_now > 60 THEN
    RETURN false;
  END IF;
  SELECT id INTO v_site_id FROM public.sites WHERE public_id = p_site_public_id LIMIT 1;
  IF v_site_id IS NULL THEN RETURN false; END IF;
  SELECT current_secret, next_secret INTO v_curr, v_next FROM private.site_secrets WHERE site_id = v_site_id;
  IF v_curr IS NULL OR length(trim(v_curr)) = 0 THEN RETURN false; END IF;
  v_msg := p_ts::text || '|' || COALESCE(p_nonce, '') || '|' || p_site_public_id || '|'
    || COALESCE(p_identifier_type, '') || '|' || COALESCE(p_identifier_value, '') || '|'
    || COALESCE(p_consent_scopes_json, '[]') || '|' || COALESCE(p_consent_at, '');
  v_expected := encode(extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_curr, 'utf8'), 'sha256'), 'hex');
  IF lower(v_expected) = lower(p_signature) THEN RETURN true; END IF;
  IF v_next IS NOT NULL AND length(trim(v_next)) > 0 THEN
    v_expected := encode(extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_next, 'utf8'), 'sha256'), 'hex');
    IF lower(v_expected) = lower(p_signature) THEN RETURN true; END IF;
  END IF;
  RETURN false;
END;
$$;


ALTER FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") IS 'GDPR consent HMAC verifier. Replay: ts within 5 min.';



CREATE OR REPLACE FUNCTION "public"."verify_partition_triggers_exist"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_sessions_trigger boolean;
  v_events_trigger boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'sessions'
      AND t.tgname = 'sessions_set_created_month'
      AND NOT t.tgisinternal
  ) INTO v_sessions_trigger;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'events'
      AND t.tgname = 'events_set_session_month_from_session'
      AND NOT t.tgisinternal
  ) INTO v_events_trigger;

  RETURN v_sessions_trigger AND v_events_trigger;
END;
$$;


ALTER FUNCTION "public"."verify_partition_triggers_exist"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verify_partition_triggers_exist"() IS 'CI guard: Returns true if sessions_set_created_month and events_set_session_month_from_session triggers exist. Prevents silent partition drift.';



CREATE OR REPLACE FUNCTION "public"."void_pending_oci_queue_on_call_reversal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_created_at timestamptz := COALESCE(NEW.updated_at, now());
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('cancelled', 'junk', 'intent') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload
  )
  SELECT
    q.id,
    'VOIDED_BY_REVERSAL',
    'MANUAL',
    v_created_at,
    jsonb_build_object(
      'last_error', 'VOIDED_BY_REVERSAL',
      'provider_error_code', 'VOIDED_BY_REVERSAL',
      'provider_error_category', 'DETERMINISTIC_SKIP',
      'clear_fields', jsonb_build_array('next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'),
      'reversal_status', NEW.status,
      'call_id', NEW.id
    )
  FROM public.offline_conversion_queue AS q
  WHERE q.site_id = NEW.site_id
    AND q.call_id = NEW.id
    AND q.status IN ('QUEUED', 'RETRY');

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."void_pending_oci_queue_on_call_reversal"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."void_pending_oci_queue_on_call_reversal"() IS 'DB trigger: when a call is cancelled/junked/restored to intent, immediately VOID queued/retry OCI rows for the same call.';



CREATE OR REPLACE FUNCTION "public"."watchtower_partition_drift_check_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_triggers_ok boolean;
  v_partition_ok boolean;
  v_ok boolean;
  v_details jsonb;
BEGIN
  v_triggers_ok := public.verify_partition_triggers_exist();
  v_partition_ok := public.verify_current_events_partition_exists();
  v_ok := v_triggers_ok AND v_partition_ok;

  v_details := jsonb_build_object(
    'triggers_ok', v_triggers_ok,
    'events_partition_ok', v_partition_ok,
    'checked_at', now()
  );

  INSERT INTO public.watchtower_checks (check_name, ok, details)
  VALUES ('partition_drift_v1', v_ok, v_details);

  RETURN jsonb_build_object('ok', v_ok) || v_details;
END;
$$;


ALTER FUNCTION "public"."watchtower_partition_drift_check_v1"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."api_keys" (
    "key_name" "text" NOT NULL,
    "key_value" "text" NOT NULL
);


ALTER TABLE "private"."api_keys" OWNER TO "postgres";


COMMENT ON TABLE "private"."api_keys" IS 'Edge Function / webhook URL ve service_role_key. Sadece SECURITY DEFINER fonksiyonlar okur.';



CREATE TABLE IF NOT EXISTS "private"."site_secrets" (
    "site_id" "uuid" NOT NULL,
    "current_secret" "text" NOT NULL,
    "next_secret" "text",
    "rotated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "private"."site_secrets" OWNER TO "postgres";


COMMENT ON TABLE "private"."site_secrets" IS 'Per-site HMAC secrets for public signed requests (call-event). Not readable by anon/authenticated.';



CREATE TABLE IF NOT EXISTS "public"."ad_spend_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "campaign_id" "text" NOT NULL,
    "campaign_name" "text" NOT NULL,
    "cost_cents" integer NOT NULL,
    "clicks" integer DEFAULT 0 NOT NULL,
    "impressions" integer DEFAULT 0 NOT NULL,
    "spend_date" "date" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ad_spend_daily" OWNER TO "postgres";


COMMENT ON TABLE "public"."ad_spend_daily" IS 'Daily Google Ads spend per campaign, ingested via webhook. Money in cents. Idempotent by (site_id, campaign_id, spend_date).';



CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text",
    "resource_id" "text",
    "site_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "audit_log_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'service_role'::"text", 'cron'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'PR-G5: Append-only audit trail for billing, admin, and sensitive actions. Write path only via service_role.';



CREATE TABLE IF NOT EXISTS "public"."billing_compensation_failures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "month" "text" NOT NULL,
    "kind" "text" DEFAULT 'revenue_events'::"text" NOT NULL,
    "failure_type" "text" NOT NULL,
    "error_message" "text",
    "qstash_message_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "text"
);


ALTER TABLE "public"."billing_compensation_failures" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_compensation_failures" IS 'Records every failed billing compensation so phantom usage increments can be reconciled. Rows should be processed by /api/cron/billing-compensation-reconcile.';



CREATE SEQUENCE IF NOT EXISTS "public"."billing_reconciliation_jobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."billing_reconciliation_jobs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."billing_reconciliation_jobs_id_seq" OWNED BY "public"."billing_reconciliation_jobs"."id";



CREATE TABLE IF NOT EXISTS "public"."call_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "call_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "previous_status" "text",
    "new_status" "text",
    "revert_snapshot" "jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "call_actions_actor_type_chk" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."call_actions" OWNER TO "postgres";


COMMENT ON TABLE "public"."call_actions" IS 'Event-Sourcing Lite audit log for calls/intents. Append-only. revert_snapshot stores exact pre-update state for safe Undo.';



COMMENT ON COLUMN "public"."call_actions"."revert_snapshot" IS 'Exact pre-update snapshot of calls row (or relevant fields) before action applied. Used for reliable Undo.';



CREATE TABLE IF NOT EXISTS "public"."call_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "call_id" "uuid" NOT NULL,
    "score_version" "text" DEFAULT 'v1.1'::"text" NOT NULL,
    "quality_score" integer NOT NULL,
    "confidence_score" integer,
    "conversion_points" integer NOT NULL,
    "interaction_points" integer NOT NULL,
    "bonuses" integer NOT NULL,
    "bonuses_capped" integer NOT NULL,
    "penalties" integer DEFAULT 0 NOT NULL,
    "raw_score" integer NOT NULL,
    "capped_at_100" boolean NOT NULL,
    "inputs_snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "call_scores_confidence_score_check" CHECK ((("confidence_score" IS NULL) OR (("confidence_score" >= 0) AND ("confidence_score" <= 100)))),
    CONSTRAINT "call_scores_quality_score_check" CHECK ((("quality_score" >= 0) AND ("quality_score" <= 100)))
);


ALTER TABLE "public"."call_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."call_scores" IS 'V1.1 scoring audit: one row per call with full breakdown and inputs_snapshot for 6-month audit.';



CREATE TABLE IF NOT EXISTS "public"."calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "phone_number" "text",
    "matched_session_id" "uuid",
    "matched_fingerprint" "text",
    "lead_score" integer DEFAULT 0,
    "matched_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text" DEFAULT 'intent'::"text",
    "lead_score_at_match" integer,
    "score_breakdown" "jsonb",
    "source" "text" DEFAULT 'click'::"text",
    "confirmed_at" timestamp with time zone,
    "confirmed_by" "uuid",
    "note" "text",
    "intent_stamp" "text",
    "intent_action" "text",
    "intent_target" "text",
    "intent_page_url" "text",
    "click_id" "text",
    "oci_status" "text",
    "oci_status_updated_at" timestamp with time zone,
    "oci_uploaded_at" timestamp with time zone,
    "oci_matched_at" timestamp with time zone,
    "oci_batch_id" "uuid",
    "oci_error" "text",
    "sale_amount" numeric,
    "estimated_value" numeric,
    "currency" "text" DEFAULT 'TRY'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "intent_phone_clicks" integer DEFAULT 0 NOT NULL,
    "intent_whatsapp_clicks" integer DEFAULT 0 NOT NULL,
    "intent_last_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "event_id" "uuid",
    "signature_hash" "text",
    "confidence_score" integer,
    "keyword" "text",
    "match_type" "text",
    "device_model" "text",
    "geo_target_id" bigint,
    "district_name" "text",
    "last_status_change_at" timestamp with time zone DEFAULT "now"(),
    "is_fast_tracked" boolean DEFAULT false,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "source_type" "text" DEFAULT 'organic'::"text",
    "network" "text",
    "device" "text",
    "campaign_id" bigint,
    "adgroup_id" bigint,
    "creative_id" bigint,
    "placement" "text",
    "target_id" bigint,
    "version" integer DEFAULT 0,
    "location_source" "text",
    "session_created_month" "date" NOT NULL,
    "geo_source" "text",
    "user_agent" "text",
    "phone_source_type" "text",
    "caller_phone_raw" "text",
    "caller_phone_e164" "text",
    "caller_phone_hash_sha256" "text",
    "trace_id" "text",
    "sale_occurred_at" timestamp with time zone,
    "sale_source_timestamp" timestamp with time zone,
    "sale_time_confidence" "text",
    "sale_occurred_at_source" "text",
    "sale_entry_reason" "text",
    "sale_is_backdated" boolean DEFAULT false NOT NULL,
    "sale_backdated_seconds" integer,
    "sale_review_status" "text" DEFAULT 'NONE'::"text",
    "sale_review_requested_at" timestamp with time zone,
    "form_state" "text",
    "form_summary" "jsonb",
    "form_last_event_at" timestamp with time zone,
    CONSTRAINT "calls_confidence_score_range" CHECK ((("confidence_score" IS NULL) OR (("confidence_score" >= 0) AND ("confidence_score" <= 100)))),
    CONSTRAINT "calls_estimated_value_non_negative" CHECK ((("estimated_value" IS NULL) OR ("estimated_value" >= (0)::numeric))),
    CONSTRAINT "calls_sale_amount_non_negative" CHECK ((("sale_amount" IS NULL) OR ("sale_amount" >= (0)::numeric))),
    CONSTRAINT "calls_sale_occurred_at_source_check" CHECK ((("sale_occurred_at_source" IS NULL) OR ("sale_occurred_at_source" = ANY (ARRAY['sale'::"text", 'fallback_confirmed'::"text", 'legacy_migrated'::"text"])))),
    CONSTRAINT "calls_sale_review_status_check" CHECK ((("sale_review_status" IS NULL) OR ("sale_review_status" = ANY (ARRAY['NONE'::"text", 'PENDING_APPROVAL'::"text", 'APPROVED'::"text", 'REJECTED'::"text"])))),
    CONSTRAINT "calls_sale_time_confidence_check" CHECK ((("sale_time_confidence" IS NULL) OR ("sale_time_confidence" = ANY (ARRAY['observed'::"text", 'operator_entered'::"text", 'inferred'::"text", 'legacy_migrated'::"text"])))),
    CONSTRAINT "calls_session_created_month_invariant" CHECK ((("matched_session_id" IS NULL) OR ("session_created_month" IS NOT NULL))),
    CONSTRAINT "calls_status_check" CHECK ((("status" = ANY (ARRAY['intent'::"text", 'confirmed'::"text", 'junk'::"text", 'qualified'::"text", 'real'::"text", 'cancelled'::"text"])) OR ("status" IS NULL))),
    CONSTRAINT "check_session_month_exists" CHECK (("session_created_month" IS NOT NULL)),
    CONSTRAINT "chk_calls_version_positive" CHECK (("version" >= 0))
);

ALTER TABLE ONLY "public"."calls" REPLICA IDENTITY FULL;


ALTER TABLE "public"."calls" OWNER TO "postgres";


COMMENT ON COLUMN "public"."calls"."phone_number" IS 'Legacy/extracted phone number. Use intent_target for normalized target storage.';



COMMENT ON COLUMN "public"."calls"."matched_at" IS 'Timestamp when match occurred';



COMMENT ON COLUMN "public"."calls"."status" IS 'Call status: intent (soft click), confirmed (intent confirmed), junk, qualified, real (actual call)';



COMMENT ON COLUMN "public"."calls"."lead_score_at_match" IS 'Lead score at the time of match (snapshot)';



COMMENT ON COLUMN "public"."calls"."score_breakdown" IS 'Detailed score calculation breakdown: {conversionPoints, interactionPoints, bonuses, cappedAt100}';



COMMENT ON COLUMN "public"."calls"."source" IS 'Source of call: click (phone/whatsapp click), api (call-event API), manual';



COMMENT ON COLUMN "public"."calls"."confirmed_at" IS 'Timestamp when intent was confirmed by user';



COMMENT ON COLUMN "public"."calls"."confirmed_by" IS 'User ID who confirmed the intent';



COMMENT ON COLUMN "public"."calls"."note" IS 'Manual note for the call';



COMMENT ON COLUMN "public"."calls"."intent_stamp" IS 'Client-generated idempotency stamp for click intents (nullable).';



COMMENT ON COLUMN "public"."calls"."intent_action" IS 'Normalized intent action (e.g. phone_call, whatsapp_click) (nullable).';



COMMENT ON COLUMN "public"."calls"."intent_target" IS 'Normalized target for dedupe (e.g. +905.. or wa.me/..) (nullable).';



COMMENT ON COLUMN "public"."calls"."intent_page_url" IS 'Page URL where the click intent occurred (no joins needed).';



COMMENT ON COLUMN "public"."calls"."click_id" IS 'Best-effort click id (gclid/wbraid/gbraid) captured at intent time (nullable).';



COMMENT ON COLUMN "public"."calls"."oci_status" IS 'OCI pipeline status: sealed|uploading|uploaded|failed|skipped (Seal API sets to sealed).';



COMMENT ON COLUMN "public"."calls"."oci_batch_id" IS 'OCI batch identifier (export/upload grouping).';



COMMENT ON COLUMN "public"."calls"."oci_error" IS 'Last OCI pipeline error (if any).';



COMMENT ON COLUMN "public"."calls"."sale_amount" IS 'Actual sale amount (Casino Kasa / bounty).';



COMMENT ON COLUMN "public"."calls"."estimated_value" IS 'Estimated value for bounty chip.';



COMMENT ON COLUMN "public"."calls"."currency" IS 'Currency code (e.g. TRY).';



COMMENT ON COLUMN "public"."calls"."signature_hash" IS 'DB idempotency: sha256(x-ops-signature). Same signature ÔåÆ same hash ÔåÆ UNIQUE prevents duplicate insert when Redis replay cache is down.';



COMMENT ON COLUMN "public"."calls"."confidence_score" IS 'V1.1 linear confidence 0ÔÇô100; NULL = legacy/not computed.';



COMMENT ON COLUMN "public"."calls"."keyword" IS 'Google Ads matched keyword from {keyword} ValueTrack parameter.';



COMMENT ON COLUMN "public"."calls"."match_type" IS 'Keyword match type from {matchtype}: e=exact, p=phrase, b=broad.';



COMMENT ON COLUMN "public"."calls"."device_model" IS 'Full device model string from {device_model} ValueTrack (e.g. Apple iPhone 15 Pro).';



COMMENT ON COLUMN "public"."calls"."geo_target_id" IS 'Raw Google Criteria ID from {loc_physical_ms} ValueTrack. FK (soft) to google_geo_targets.criteria_id.';



COMMENT ON COLUMN "public"."calls"."district_name" IS 'Human-readable district resolved from geo_target_id at ingest time (e.g. ┼Şi┼şli / ─░stanbul).';



COMMENT ON COLUMN "public"."calls"."last_status_change_at" IS 'Tracks when the lead status last changed for state machine timing.';



COMMENT ON COLUMN "public"."calls"."is_fast_tracked" IS 'True if the lead was automatically qualified via Brain Score (>= 80).';



COMMENT ON COLUMN "public"."calls"."expires_at" IS 'Timestamp after which a pending lead is considered stale and subject to auto-junking.';



COMMENT ON COLUMN "public"."calls"."gclid" IS 'Universal Google Click ID (PPC).';



COMMENT ON COLUMN "public"."calls"."wbraid" IS 'iOS 14+ Web Click ID (Aggregated).';



COMMENT ON COLUMN "public"."calls"."gbraid" IS 'iOS 14+ App/Web Click ID (Aggregated).';



COMMENT ON COLUMN "public"."calls"."source_type" IS 'Lead origin: organic or paid.';



COMMENT ON COLUMN "public"."calls"."network" IS 'Ads network: g (search), s (search partners), v (youtube), d (display), etc.';



COMMENT ON COLUMN "public"."calls"."device" IS 'User device: m (mobile), t (tablet), c (computer).';



COMMENT ON COLUMN "public"."calls"."campaign_id" IS 'Google Ads Campaign ID.';



COMMENT ON COLUMN "public"."calls"."adgroup_id" IS 'Google Ads Ad Group ID.';



COMMENT ON COLUMN "public"."calls"."creative_id" IS 'Google Ads Ad ID (creative).';



COMMENT ON COLUMN "public"."calls"."placement" IS 'Placement URL (for Display/Search Partners).';



COMMENT ON COLUMN "public"."calls"."target_id" IS 'Target ID (location or remarketing list).';



COMMENT ON COLUMN "public"."calls"."version" IS 'Incrementing version for optimistic locking (concurrency control).';



COMMENT ON COLUMN "public"."calls"."location_source" IS 'gclid when location (district_name) is from Google Ads context; null when from IP/session.';



COMMENT ON COLUMN "public"."calls"."session_created_month" IS 'Session partition (sessions.created_month). Set from call-event payload for OCI RPC partition pruning.';



COMMENT ON COLUMN "public"."calls"."user_agent" IS 'DIC: Raw user-agent at call/conversion time. Used for device entropy and gbraid vs phone-hash prioritization.';



COMMENT ON COLUMN "public"."calls"."phone_source_type" IS 'DIC: How phone was captured: form_fill, click_to_call, manual_dial. Affects identity Trust Score. Derived from intent_action/intent_target if not set.';



COMMENT ON COLUMN "public"."calls"."caller_phone_raw" IS 'Operator-entered verbatim phone (audit trail). PII.';



COMMENT ON COLUMN "public"."calls"."caller_phone_e164" IS 'E.164 normalized identity. DIC/EC fallback when set.';



COMMENT ON COLUMN "public"."calls"."caller_phone_hash_sha256" IS 'SHA256(salt+digits) lowercase hex, 64 chars. For EC upload.';



COMMENT ON COLUMN "public"."calls"."trace_id" IS 'Phase 20: OM-TRACE-UUID from call-event request for forensic audit chain';



COMMENT ON COLUMN "public"."calls"."sale_occurred_at" IS 'Canonical business-event time for V5 sale export. Prefer over confirmed_at when present.';



COMMENT ON COLUMN "public"."calls"."sale_source_timestamp" IS 'Raw operator-provided or inherited V5 timestamp before export-time canonical selection.';



COMMENT ON COLUMN "public"."calls"."sale_time_confidence" IS 'Sale timestamp provenance: observed, operator_entered, inferred, legacy_migrated.';



COMMENT ON COLUMN "public"."calls"."sale_occurred_at_source" IS 'Source of V5 business-event time: sale, fallback_confirmed, legacy_migrated.';



COMMENT ON COLUMN "public"."calls"."sale_entry_reason" IS 'Optional operator reason when sale time is entered late or backdated.';



COMMENT ON COLUMN "public"."calls"."sale_is_backdated" IS 'True when sale_occurred_at is earlier than the system recorded confirmation time.';



COMMENT ON COLUMN "public"."calls"."sale_backdated_seconds" IS 'Delta in seconds between recorded confirmation time and sale_occurred_at.';



COMMENT ON COLUMN "public"."calls"."sale_review_status" IS 'Governance state for manual V5 time overrides: NONE, PENDING_APPROVAL, APPROVED, REJECTED.';



COMMENT ON COLUMN "public"."calls"."sale_review_requested_at" IS 'Timestamp when a backdated sale time entered approval workflow.';



COMMENT ON CONSTRAINT "calls_session_created_month_invariant" ON "public"."calls" IS 'OCI-9: Partition join invariant. Enables get_call_session_for_oci s.created_month = c.session_created_month.';



CREATE TABLE IF NOT EXISTS "public"."causal_dna_ledger" (
    "id" bigint NOT NULL,
    "site_id" "uuid" NOT NULL,
    "aggregate_type" "text" NOT NULL,
    "aggregate_id" "uuid",
    "causal_dna" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "causal_dna_ledger_aggregate_type_check" CHECK (("aggregate_type" = ANY (ARRAY['conversion'::"text", 'signal'::"text", 'pv'::"text"])))
);


ALTER TABLE "public"."causal_dna_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."causal_dna_ledger" IS 'Singularity: Append-only stream of every causal_dna for Merkle heartbeat (last N entries hashed).';



CREATE TABLE IF NOT EXISTS "public"."causal_dna_ledger_failures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "aggregate_type" "text" NOT NULL,
    "aggregate_id" "uuid",
    "causal_dna" "jsonb",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "causal_dna_ledger_failures_aggregate_type_check" CHECK (("aggregate_type" = ANY (ARRAY['conversion'::"text", 'signal'::"text", 'pv'::"text"])))
);


ALTER TABLE "public"."causal_dna_ledger_failures" OWNER TO "postgres";


COMMENT ON TABLE "public"."causal_dna_ledger_failures" IS 'Dead-letter queue for failed append_causal_dna_ledger RPC calls. Rows older than 90 days may be purged.';



ALTER TABLE "public"."causal_dna_ledger" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."causal_dna_ledger_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."conversation_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversation_links_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['session'::"text", 'call'::"text", 'event'::"text"])))
);


ALTER TABLE "public"."conversation_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "primary_intent_id" "uuid",
    "primary_session_id" "uuid",
    "primary_call_id" "uuid",
    "primary_source" "jsonb",
    "note" "text",
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'WON'::"text", 'LOST'::"text", 'JUNK'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_invite_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inviter_user_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "invitee_email" "text" NOT NULL,
    "invitee_email_lc" "text" NOT NULL,
    "role" "text" DEFAULT 'analyst'::"text" NOT NULL,
    "outcome" "text" NOT NULL,
    "details" "text",
    CONSTRAINT "customer_invite_audit_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'operator'::"text", 'analyst'::"text", 'billing'::"text"])))
);


ALTER TABLE "public"."customer_invite_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "site_id" "uuid",
    "ingest_dedup_id" "uuid",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[]
)
PARTITION BY RANGE ("session_month");

ALTER TABLE ONLY "public"."events" REPLICA IDENTITY FULL;


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."events"."site_id" IS 'Denormalized for fast Realtime filter; API must populate on insert.';



COMMENT ON COLUMN "public"."events"."ingest_dedup_id" IS 'Idempotency key from sync worker (processed_signals ledger); prevents duplicate event insert on retry.';



COMMENT ON COLUMN "public"."events"."consent_at" IS 'KVKK/GDPR: Session''dan kopyalan─▒r veya event bazl─▒.';



COMMENT ON COLUMN "public"."events"."consent_scopes" IS 'KVKK/GDPR: ─░zin kapsamlar─▒.';



CREATE TABLE IF NOT EXISTS "public"."events_2026_01" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "site_id" "uuid",
    "ingest_dedup_id" "uuid",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[]
);

ALTER TABLE ONLY "public"."events_2026_01" REPLICA IDENTITY FULL;


ALTER TABLE "public"."events_2026_01" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events_2026_02" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "site_id" "uuid",
    "ingest_dedup_id" "uuid",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."events_2026_02" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events_2026_03" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "site_id" "uuid",
    "ingest_dedup_id" "uuid",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."events_2026_03" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events_default" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "site_id" "uuid",
    "ingest_dedup_id" "uuid",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[]
);

ALTER TABLE ONLY "public"."events_default" REPLICA IDENTITY FULL;


ALTER TABLE "public"."events_default" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gdpr_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "identifier_type" "text" NOT NULL,
    "identifier_value" "text" NOT NULL,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "consent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gdpr_consents_identifier_type_check" CHECK (("identifier_type" = ANY (ARRAY['fingerprint'::"text", 'session_id'::"text"])))
);


ALTER TABLE "public"."gdpr_consents" OWNER TO "postgres";


COMMENT ON TABLE "public"."gdpr_consents" IS 'KVKK/GDPR: Server-recorded consent (e.g. CMP callback). Sync may use for lookup.';



CREATE TABLE IF NOT EXISTS "public"."gdpr_erase_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "identifier_type" "text" NOT NULL,
    "identifier_value" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "gdpr_erase_requests_identifier_type_check" CHECK (("identifier_type" = ANY (ARRAY['email'::"text", 'fingerprint'::"text", 'session_id'::"text"]))),
    CONSTRAINT "gdpr_erase_requests_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'COMPLETED'::"text", 'FAILED'::"text"])))
);


ALTER TABLE "public"."gdpr_erase_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."gdpr_erase_requests" IS 'KVKK/GDPR: Silme talepleri. Erase i┼şlemi tamamland─▒─ş─▒nda completed_at set edilir.';



CREATE TABLE IF NOT EXISTS "public"."google_geo_targets" (
    "criteria_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "canonical_name" "text" NOT NULL,
    "parent_id" bigint,
    "country_code" "text",
    "target_type" "text",
    "status" "text" DEFAULT 'Active'::"text" NOT NULL
);


ALTER TABLE "public"."google_geo_targets" OWNER TO "postgres";


COMMENT ON TABLE "public"."google_geo_targets" IS 'Google Ads geo target criteria IDs. Seeded from Google Geo Targets CSV. Read-only lookup for resolving {loc_physical_ms} ValueTrack IDs to district names.';



COMMENT ON COLUMN "public"."google_geo_targets"."criteria_id" IS 'Primary key: Google Criteria ID returned by {loc_physical_ms}.';



COMMENT ON COLUMN "public"."google_geo_targets"."name" IS 'Short human-readable geo name (e.g. ┼Şi┼şli).';



COMMENT ON COLUMN "public"."google_geo_targets"."canonical_name" IS 'Full CSV canonical name path (e.g. ┼Şi┼şli,─░stanbul,Turkey).';



COMMENT ON COLUMN "public"."google_geo_targets"."parent_id" IS 'Parent geo criteria_id (nullable).';



COMMENT ON COLUMN "public"."google_geo_targets"."country_code" IS 'ISO 3166-1 alpha-2 country code (e.g. TR).';



COMMENT ON COLUMN "public"."google_geo_targets"."target_type" IS 'Google geographic target type (City, Province, District, Country, etc.).';



COMMENT ON COLUMN "public"."google_geo_targets"."status" IS 'Active or Removed per Google CSV.';



CREATE TABLE IF NOT EXISTS "public"."ingest_fallback_buffer" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "error_reason" "text",
    "status" "public"."ingest_fallback_status" DEFAULT 'PENDING'::"public"."ingest_fallback_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recover_attempt_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ingest_fallback_buffer" OWNER TO "postgres";


COMMENT ON TABLE "public"."ingest_fallback_buffer" IS 'Safety net when QStash is down: full worker payload stored; recovery cron retries publish.';



COMMENT ON COLUMN "public"."ingest_fallback_buffer"."recover_attempt_count" IS 'Axiomatic: Bounded retries. After 10 failed QStash publish attempts -> QUARANTINE. System halts.';



CREATE TABLE IF NOT EXISTS "public"."ingest_fraud_quarantine" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "reason" "text" NOT NULL,
    "fingerprint" "text",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ingest_fraud_quarantine" OWNER TO "postgres";


COMMENT ON TABLE "public"."ingest_fraud_quarantine" IS 'Quarantine for suspicious/high-frequency events. Never hits Calls/Conversions. Manual review required.';



CREATE TABLE IF NOT EXISTS "public"."ingest_idempotency" (
    "site_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "billing_state" "public"."billing_state" DEFAULT 'ACCEPTED'::"public"."billing_state" NOT NULL,
    "billable" boolean DEFAULT true NOT NULL,
    "year_month" "text" GENERATED ALWAYS AS ("public"."utc_year_month"("created_at")) STORED NOT NULL,
    "idempotency_version" smallint DEFAULT 1 NOT NULL,
    "event_category" "text",
    "event_action" "text",
    "event_label" "text",
    "billing_reason" "text"
);


ALTER TABLE "public"."ingest_idempotency" OWNER TO "postgres";


COMMENT ON TABLE "public"."ingest_idempotency" IS 'API-edge idempotency: deterministic key per (site, event, url, fingerprint, 5s window). Prevents duplicate processing on client retries.';



COMMENT ON COLUMN "public"."ingest_idempotency"."expires_at" IS 'Revenue Kernel: retention >= 90 days. Cleanup job may DELETE WHERE expires_at < NOW() (non-invoice-critical).';



COMMENT ON COLUMN "public"."ingest_idempotency"."billing_state" IS 'Revenue Kernel: ACCEPTED=normal; OVERAGE=soft limit; DEGRADED_CAPTURE=fallback; RECOVERED=from buffer. Invoice authority = this table only.';



COMMENT ON COLUMN "public"."ingest_idempotency"."billable" IS 'Revenue Kernel: true = row counts toward invoice. Duplicates/429 do not insert; fallback rows are billable at capture.';



COMMENT ON COLUMN "public"."ingest_idempotency"."year_month" IS 'UTC month YYYY-MM for reconciliation. Generated from created_at.';



COMMENT ON COLUMN "public"."ingest_idempotency"."idempotency_version" IS 'Revenue Kernel PR-2: 1 = v1 (5s bucket); 2 = v2 (event-specific: heartbeat 10s, page_view 2s, click/call_intent 0s). Key stored as-is; version derived from key prefix or default 1.';



COMMENT ON COLUMN "public"."ingest_idempotency"."event_category" IS 'Ingest classification: payload.ec (e.g. conversion, interaction, system). For billing proof and audits.';



COMMENT ON COLUMN "public"."ingest_idempotency"."event_action" IS 'Ingest classification: payload.ea (e.g. phone_call, view, scroll_depth, heartbeat). For billing proof and audits.';



COMMENT ON COLUMN "public"."ingest_idempotency"."event_label" IS 'Ingest classification: payload.el (label). Optional.';



COMMENT ON COLUMN "public"."ingest_idempotency"."billing_reason" IS 'Billing reason for billable flag and decisions (e.g. conversion, interaction_view, scroll_depth, system, rejected_quota).';



CREATE TABLE IF NOT EXISTS "public"."ingest_publish_failures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_public_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "error_code" "text" NOT NULL,
    "error_message_short" "text"
);


ALTER TABLE "public"."ingest_publish_failures" OWNER TO "postgres";


COMMENT ON TABLE "public"."ingest_publish_failures" IS 'Best-effort log of QStash publish failures from /api/sync. Used for observability; insert must not throw.';



CREATE TABLE IF NOT EXISTS "public"."invoice_snapshot" (
    "site_id" "uuid" NOT NULL,
    "year_month" "text" NOT NULL,
    "event_count" bigint NOT NULL,
    "overage_count" bigint NOT NULL,
    "snapshot_hash" "text" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "generated_by" "text",
    CONSTRAINT "invoice_snapshot_year_month_format" CHECK (("year_month" ~ '^\d{4}-\d{2}$'::"text"))
);


ALTER TABLE "public"."invoice_snapshot" OWNER TO "postgres";


COMMENT ON TABLE "public"."invoice_snapshot" IS 'Revenue Kernel: immutable audit snapshot per site/month. Invoice authority = ingest_idempotency; this is dispute-proof export. Do not update or delete.';



CREATE TABLE IF NOT EXISTS "public"."marketing_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "call_id" "uuid",
    "signal_type" "text" NOT NULL,
    "google_conversion_name" "text" NOT NULL,
    "google_conversion_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dispatch_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "google_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversion_value" numeric,
    "causal_dna" "jsonb" DEFAULT '{}'::"jsonb",
    "entropy_score" numeric(5,4) DEFAULT 0,
    "uncertainty_bit" boolean DEFAULT false,
    "expected_value_cents" bigint,
    "recovery_attempt_count" integer DEFAULT 0 NOT NULL,
    "last_recovery_attempt_at" timestamp with time zone,
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "adjustment_sequence" integer DEFAULT 0 NOT NULL,
    "previous_hash" "text",
    "current_hash" "text",
    "trace_id" "text",
    "sys_period" "tstzrange" DEFAULT "tstzrange"("now"(), 'infinity'::timestamp with time zone, '[)'::"text") NOT NULL,
    "valid_period" "tstzrange" DEFAULT "tstzrange"("now"(), 'infinity'::timestamp with time zone, '[)'::"text") NOT NULL,
    "occurred_at" timestamp with time zone,
    "recorded_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "source_timestamp" timestamp with time zone,
    "time_confidence" "text",
    "occurred_at_source" "text",
    "entry_reason" "text",
    CONSTRAINT "marketing_signals_dispatch_status_check" CHECK (("dispatch_status" = ANY (ARRAY['PENDING'::"text", 'PROCESSING'::"text", 'SENT'::"text", 'FAILED'::"text", 'JUNK_ABORTED'::"text", 'DEAD_LETTER_QUARANTINE'::"text", 'SKIPPED_NO_CLICK_ID'::"text", 'STALLED_FOR_HUMAN_AUDIT'::"text"]))),
    CONSTRAINT "marketing_signals_entropy_score_check" CHECK ((("entropy_score" >= (0)::numeric) AND ("entropy_score" <= (1)::numeric))),
    CONSTRAINT "marketing_signals_occurred_at_source_check" CHECK ((("occurred_at_source" IS NULL) OR ("occurred_at_source" = ANY (ARRAY['intent'::"text", 'qualified'::"text", 'proposal'::"text", 'legacy_migrated'::"text"])))),
    CONSTRAINT "marketing_signals_time_confidence_check" CHECK ((("time_confidence" IS NULL) OR ("time_confidence" = ANY (ARRAY['observed'::"text", 'operator_entered'::"text", 'inferred'::"text", 'legacy_migrated'::"text"]))))
)
WITH ("autovacuum_vacuum_scale_factor"='0.02', "autovacuum_analyze_scale_factor"='0.01', "autovacuum_vacuum_cost_delay"='2', "autovacuum_vacuum_cost_limit"='1000');


ALTER TABLE "public"."marketing_signals" OWNER TO "postgres";


COMMENT ON TABLE "public"."marketing_signals" IS 'Aggressive autovacuum (scale 0.02) to prevent index bloat on high-insert append-only table.';



COMMENT ON COLUMN "public"."marketing_signals"."dispatch_status" IS 'Queue status: PENDING (new), PROCESSING (exported to script), SENT (ACKed), FAILED (nack), DEAD_LETTER_QUARANTINE (poison pill).';



COMMENT ON COLUMN "public"."marketing_signals"."causal_dna" IS 'Singularity: Decision path for this signal. gear, gates_passed, logic_branch, math_version.';



COMMENT ON COLUMN "public"."marketing_signals"."expected_value_cents" IS 'Conversion value in minor units (cents). SSOT for internal math; conversion_value = expected_value_cents/100 for export.';



COMMENT ON COLUMN "public"."marketing_signals"."recovery_attempt_count" IS 'Self-Healing: number of recovery attempts. Max 3.';



COMMENT ON COLUMN "public"."marketing_signals"."last_recovery_attempt_at" IS 'Self-Healing: last retry timestamp. Gates next attempt via exponential backoff.';



COMMENT ON COLUMN "public"."marketing_signals"."gclid" IS 'Recovered GCLID from Identity Stitcher. Export uses this if set.';



COMMENT ON COLUMN "public"."marketing_signals"."previous_hash" IS 'SHA-256 hash of the previous adjustment in the sequence.';



COMMENT ON COLUMN "public"."marketing_signals"."current_hash" IS 'SHA-256 hash of (call_id + sequence + value_cents + previous_hash + salt).';



COMMENT ON COLUMN "public"."marketing_signals"."trace_id" IS 'Phase 20: OM-TRACE-UUID from sync/call-event request for forensic audit chain';



COMMENT ON COLUMN "public"."marketing_signals"."occurred_at" IS 'Canonical business-event time for signal export. Prefer over google_conversion_time.';



COMMENT ON COLUMN "public"."marketing_signals"."recorded_at" IS 'Physical row-write time for audit. Never export this to Google Ads.';



COMMENT ON COLUMN "public"."marketing_signals"."source_timestamp" IS 'Raw upstream timestamp used to derive occurred_at.';



COMMENT ON COLUMN "public"."marketing_signals"."time_confidence" IS 'Signal timestamp provenance: observed, operator_entered, inferred, legacy_migrated.';



COMMENT ON COLUMN "public"."marketing_signals"."occurred_at_source" IS 'Source of signal business-event time: intent, qualified, proposal, legacy_migrated.';



COMMENT ON COLUMN "public"."marketing_signals"."entry_reason" IS 'Optional human-entered reason for delayed or corrected business-event time.';



COMMENT ON CONSTRAINT "marketing_signals_dispatch_status_check" ON "public"."marketing_signals" IS 'Phase 21 strict signal ontology: PENDING, PROCESSING, SENT, FAILED, JUNK_ABORTED, DEAD_LETTER_QUARANTINE, SKIPPED_NO_CLICK_ID, STALLED_FOR_HUMAN_AUDIT.';



CREATE TABLE IF NOT EXISTS "public"."marketing_signals_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "call_id" "uuid",
    "signal_type" "text" NOT NULL,
    "google_conversion_name" "text" NOT NULL,
    "google_conversion_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dispatch_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "google_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversion_value" numeric,
    "causal_dna" "jsonb" DEFAULT '{}'::"jsonb",
    "entropy_score" numeric(5,4) DEFAULT 0,
    "uncertainty_bit" boolean DEFAULT false,
    "expected_value_cents" bigint,
    "recovery_attempt_count" integer DEFAULT 0 NOT NULL,
    "last_recovery_attempt_at" timestamp with time zone,
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "adjustment_sequence" integer DEFAULT 0 NOT NULL,
    "previous_hash" "text",
    "current_hash" "text",
    "trace_id" "text",
    "sys_period" "tstzrange" DEFAULT "tstzrange"("now"(), 'infinity'::timestamp with time zone, '[)'::"text") NOT NULL,
    "valid_period" "tstzrange" DEFAULT "tstzrange"("now"(), 'infinity'::timestamp with time zone, '[)'::"text") NOT NULL,
    "history_recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "history_action" "text" DEFAULT 'UPDATE'::"text" NOT NULL
);


ALTER TABLE "public"."marketing_signals_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oci_payload_validation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "text" NOT NULL,
    "queue_id" "uuid",
    "site_id" "uuid",
    "attempted_status" "text" NOT NULL,
    "unknown_keys" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "missing_required" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "payload" "jsonb",
    "note" "text",
    CONSTRAINT "oci_payload_validation_events_actor_check" CHECK (("actor" = ANY (ARRAY['SCRIPT'::"text", 'WORKER'::"text", 'RPC_CLAIM'::"text", 'SWEEPER'::"text", 'MANUAL'::"text", 'SYSTEM_BACKFILL'::"text"]))),
    CONSTRAINT "oci_payload_validation_events_missing_required_array" CHECK (("jsonb_typeof"("missing_required") = 'array'::"text")),
    CONSTRAINT "oci_payload_validation_events_status_check" CHECK (("attempted_status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text", 'PROCESSING'::"text", 'UPLOADED'::"text", 'COMPLETED'::"text", 'COMPLETED_UNVERIFIED'::"text", 'FAILED'::"text", 'DEAD_LETTER_QUARANTINE'::"text"]))),
    CONSTRAINT "oci_payload_validation_events_unknown_keys_array" CHECK (("jsonb_typeof"("unknown_keys") = 'array'::"text"))
);


ALTER TABLE "public"."oci_payload_validation_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."oci_payload_validation_events" IS 'Phase 23A warning-mode telemetry for transition payload drift before strict validation is enforced.';



CREATE TABLE IF NOT EXISTS "public"."oci_queue_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "queue_id" "uuid" NOT NULL,
    "new_status" "text" NOT NULL,
    "error_payload" "jsonb",
    "actor" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "brain_score" smallint,
    "match_score" smallint,
    "queue_priority" smallint,
    "score_version" smallint,
    "score_flags" integer,
    "score_explain_jsonb" "jsonb",
    CONSTRAINT "oci_queue_transitions_actor_check" CHECK (("actor" = ANY (ARRAY['SCRIPT'::"text", 'WORKER'::"text", 'RPC_CLAIM'::"text", 'SWEEPER'::"text", 'MANUAL'::"text", 'SYSTEM_BACKFILL'::"text"]))),
    CONSTRAINT "oci_queue_transitions_new_status_check" CHECK (("new_status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text", 'PROCESSING'::"text", 'UPLOADED'::"text", 'COMPLETED'::"text", 'COMPLETED_UNVERIFIED'::"text", 'FAILED'::"text", 'DEAD_LETTER_QUARANTINE'::"text", 'VOIDED_BY_REVERSAL'::"text"])))
);


ALTER TABLE "public"."oci_queue_transitions" OWNER TO "postgres";


COMMENT ON TABLE "public"."oci_queue_transitions" IS 'Phase 22 immutable ledger for offline_conversion_queue state transitions.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."error_payload" IS 'Partial snapshot patch. Null values do not clear fields; use clear_fields array for explicit clears.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."brain_score" IS 'Phase 23A typed routing score written on transition append when available.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."match_score" IS 'Phase 23A immutable match-quality score on the transition.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."queue_priority" IS 'Phase 23A typed priority value intended for future claim-order cutover.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."score_version" IS 'Phase 23A typed score schema version on the transition.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."score_flags" IS 'Phase 23A bit flags for score/routing decisions on the transition.';



COMMENT ON COLUMN "public"."oci_queue_transitions"."score_explain_jsonb" IS 'Phase 23A cold explainability JSON kept out of the snapshot hot path.';



CREATE TABLE IF NOT EXISTS "public"."offline_conversion_tombstones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_queue_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "queue_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "failure_summary" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."offline_conversion_tombstones" OWNER TO "postgres";


COMMENT ON TABLE "public"."offline_conversion_tombstones" IS 'Archived FAILED conversions. queue_snapshot = full row for revival. source_queue_id UNIQUE prevents double-archive.';



CREATE TABLE IF NOT EXISTS "public"."outbox_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" DEFAULT 'IntentSealed'::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "call_id" "uuid",
    "site_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_events_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'PROCESSING'::"text", 'PROCESSED'::"text", 'FAILED'::"text"])))
);


ALTER TABLE "public"."outbox_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."outbox_events" IS 'Transactional outbox for OCI: IntentSealed written in same tx as call seal; worker consumes and writes marketing_signals / queue.';



CREATE TABLE IF NOT EXISTS "public"."processed_signals" (
    "event_id" "uuid" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"(),
    "site_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'processed'::"text"
);


ALTER TABLE "public"."processed_signals" OWNER TO "postgres";


COMMENT ON TABLE "public"."processed_signals" IS 'Ledger for idempotent event ingestion; prevents duplicate processing on retry.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "encrypted_payload" "text" NOT NULL,
    "key_fingerprint" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_credentials" OWNER TO "postgres";


COMMENT ON TABLE "public"."provider_credentials" IS 'Encrypted ad provider credentials per site. encrypted_payload is sealed-box ciphertext; only server with OPSMANTIK_VAULT_KEY can decrypt.';



CREATE TABLE IF NOT EXISTS "public"."provider_dispatches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "snapshot_id" "uuid" NOT NULL,
    "provider_key" "text" DEFAULT 'google_ads'::"text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "next_retry_at" timestamp with time zone,
    "provider_request_id" "text",
    "uploaded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_dispatches_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'COMPLETED'::"text", 'FAILED'::"text"])))
);


ALTER TABLE "public"."provider_dispatches" OWNER TO "postgres";


COMMENT ON TABLE "public"."provider_dispatches" IS 'Iron Seal: Dispatch audit per provider. Status updated by worker; row never deleted.';



CREATE TABLE IF NOT EXISTS "public"."provider_health_state" (
    "site_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "state" "public"."provider_circuit_state" DEFAULT 'CLOSED'::"public"."provider_circuit_state" NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "last_failure_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "next_probe_at" timestamp with time zone,
    "probe_limit" integer DEFAULT 5 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_health_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."provider_health_state" IS 'PR5: Circuit breaker state per (site_id, provider_key). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."provider_upload_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "batch_id" "text" NOT NULL,
    "phase" "text" NOT NULL,
    "claimed_count" integer,
    "completed_count" integer,
    "failed_count" integer,
    "retry_count" integer,
    "duration_ms" integer,
    "provider_request_id" "text",
    "error_code" "text",
    "error_category" "text",
    CONSTRAINT "provider_upload_attempts_phase_check" CHECK (("phase" = ANY (ARRAY['STARTED'::"text", 'FINISHED'::"text"])))
);


ALTER TABLE "public"."provider_upload_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."provider_upload_attempts" IS 'PR10: Append-only ledger of provider upload attempts. One STARTED + one FINISHED per attempt (same batch_id). service_role only.';



CREATE TABLE IF NOT EXISTS "public"."provider_upload_metrics" (
    "site_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "attempts_total" bigint DEFAULT 0 NOT NULL,
    "completed_total" bigint DEFAULT 0 NOT NULL,
    "failed_total" bigint DEFAULT 0 NOT NULL,
    "retry_total" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_upload_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."provider_upload_metrics" IS 'Site-scoped upload counters for provider worker. Written by service_role only.';



CREATE TABLE IF NOT EXISTS "public"."revenue_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "call_id" "uuid",
    "sale_id" "uuid",
    "session_id" "uuid",
    "value_cents" bigint DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'TRY'::"text" NOT NULL,
    "reasons_json" "jsonb" DEFAULT '{}'::"jsonb",
    "meta_json" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."revenue_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."revenue_snapshots" IS 'Iron Seal: Immutable financial ledger. APPEND-ONLY. Every sealed conversion creates one row.';



CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "occurred_at" timestamp with time zone NOT NULL,
    "amount_cents" bigint NOT NULL,
    "currency" "text" DEFAULT 'TRY'::"text" NOT NULL,
    "status" "text" DEFAULT 'DRAFT'::"text" NOT NULL,
    "external_ref" "text",
    "customer_hash" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entry_reason" "text",
    "approval_requested_at" timestamp with time zone,
    CONSTRAINT "sales_amount_cents_check" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "sales_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'PENDING_APPROVAL'::"text", 'CONFIRMED'::"text", 'CANCELED'::"text"])))
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sales"."entry_reason" IS 'Operator-provided reason for manual occurred_at entry or correction.';



COMMENT ON COLUMN "public"."sales"."approval_requested_at" IS 'Timestamp when a sales row entered PENDING_APPROVAL for backdated occurred_at.';



CREATE TABLE IF NOT EXISTS "public"."sessions_2026_01" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "created_month" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "entry_page" "text",
    "exit_page" "text",
    "total_duration_sec" integer DEFAULT 0,
    "event_count" integer DEFAULT 0,
    "attribution_source" "text",
    "device_type" "text",
    "city" "text",
    "district" "text",
    "fingerprint" "text",
    "lead_score" integer DEFAULT 0,
    "ai_score" integer DEFAULT 0,
    "ai_summary" "text",
    "ai_tags" "text"[],
    "user_journey_path" "text",
    "utm_term" "text",
    "matchtype" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "ads_network" "text",
    "ads_placement" "text",
    "device_os" "text",
    "telco_carrier" "text",
    "browser" "text",
    "browser_language" "text",
    "device_memory" integer,
    "hardware_concurrency" integer,
    "screen_width" integer,
    "screen_height" integer,
    "pixel_ratio" numeric,
    "gpu_renderer" "text",
    "connection_type" "text",
    "is_returning" boolean DEFAULT false,
    "referrer_host" "text",
    "max_scroll_percentage" integer DEFAULT 0,
    "cta_hover_count" integer DEFAULT 0,
    "form_focus_duration" integer DEFAULT 0,
    "total_active_seconds" integer DEFAULT 0,
    "engagement_score" integer DEFAULT 0,
    "isp_asn" "text",
    "is_proxy_detected" boolean DEFAULT false,
    "visitor_rank" "text",
    "previous_visit_count" integer DEFAULT 0,
    "traffic_source" "text",
    "traffic_medium" "text",
    "utm_adgroup" "text",
    "device_model" "text",
    "ads_target_id" "text",
    "ads_adposition" "text",
    "ads_feed_item_id" "text",
    "loc_interest_ms" "text",
    "loc_physical_ms" "text",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[],
    "geo_city" "text",
    "geo_district" "text",
    "geo_source" "text",
    "geo_updated_at" timestamp with time zone
);
ALTER TABLE ONLY "public"."sessions_2026_01" ALTER COLUMN "site_id" SET STATISTICS 1000;

ALTER TABLE ONLY "public"."sessions_2026_01" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sessions_2026_01" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions_2026_02" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "created_month" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "entry_page" "text",
    "exit_page" "text",
    "total_duration_sec" integer DEFAULT 0,
    "event_count" integer DEFAULT 0,
    "attribution_source" "text",
    "device_type" "text",
    "city" "text",
    "district" "text",
    "fingerprint" "text",
    "lead_score" integer DEFAULT 0,
    "ai_score" integer DEFAULT 0,
    "ai_summary" "text",
    "ai_tags" "text"[],
    "user_journey_path" "text",
    "utm_term" "text",
    "matchtype" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "ads_network" "text",
    "ads_placement" "text",
    "device_os" "text",
    "telco_carrier" "text",
    "browser" "text",
    "browser_language" "text",
    "device_memory" integer,
    "hardware_concurrency" integer,
    "screen_width" integer,
    "screen_height" integer,
    "pixel_ratio" numeric,
    "gpu_renderer" "text",
    "connection_type" "text",
    "is_returning" boolean DEFAULT false,
    "referrer_host" "text",
    "max_scroll_percentage" integer DEFAULT 0,
    "cta_hover_count" integer DEFAULT 0,
    "form_focus_duration" integer DEFAULT 0,
    "total_active_seconds" integer DEFAULT 0,
    "engagement_score" integer DEFAULT 0,
    "isp_asn" "text",
    "is_proxy_detected" boolean DEFAULT false,
    "visitor_rank" "text",
    "previous_visit_count" integer DEFAULT 0,
    "traffic_source" "text",
    "traffic_medium" "text",
    "utm_adgroup" "text",
    "device_model" "text",
    "ads_target_id" "text",
    "ads_adposition" "text",
    "ads_feed_item_id" "text",
    "loc_interest_ms" "text",
    "loc_physical_ms" "text",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[],
    "geo_city" "text",
    "geo_district" "text",
    "geo_source" "text",
    "geo_updated_at" timestamp with time zone
);
ALTER TABLE ONLY "public"."sessions_2026_02" ALTER COLUMN "site_id" SET STATISTICS 1000;


ALTER TABLE "public"."sessions_2026_02" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions_2026_03" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "created_month" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "entry_page" "text",
    "exit_page" "text",
    "total_duration_sec" integer DEFAULT 0,
    "event_count" integer DEFAULT 0,
    "attribution_source" "text",
    "device_type" "text",
    "city" "text",
    "district" "text",
    "fingerprint" "text",
    "lead_score" integer DEFAULT 0,
    "ai_score" integer DEFAULT 0,
    "ai_summary" "text",
    "ai_tags" "text"[],
    "user_journey_path" "text",
    "utm_term" "text",
    "matchtype" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "ads_network" "text",
    "ads_placement" "text",
    "device_os" "text",
    "telco_carrier" "text",
    "browser" "text",
    "browser_language" "text",
    "device_memory" integer,
    "hardware_concurrency" integer,
    "screen_width" integer,
    "screen_height" integer,
    "pixel_ratio" numeric,
    "gpu_renderer" "text",
    "connection_type" "text",
    "is_returning" boolean DEFAULT false,
    "referrer_host" "text",
    "max_scroll_percentage" integer DEFAULT 0,
    "cta_hover_count" integer DEFAULT 0,
    "form_focus_duration" integer DEFAULT 0,
    "total_active_seconds" integer DEFAULT 0,
    "engagement_score" integer DEFAULT 0,
    "isp_asn" "text",
    "is_proxy_detected" boolean DEFAULT false,
    "visitor_rank" "text",
    "previous_visit_count" integer DEFAULT 0,
    "traffic_source" "text",
    "traffic_medium" "text",
    "utm_adgroup" "text",
    "device_model" "text",
    "ads_target_id" "text",
    "ads_adposition" "text",
    "ads_feed_item_id" "text",
    "loc_interest_ms" "text",
    "loc_physical_ms" "text",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[],
    "geo_city" "text",
    "geo_district" "text",
    "geo_source" "text",
    "geo_updated_at" timestamp with time zone
);
ALTER TABLE ONLY "public"."sessions_2026_03" ALTER COLUMN "site_id" SET STATISTICS 1000;


ALTER TABLE "public"."sessions_2026_03" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions_default" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "gclid" "text",
    "wbraid" "text",
    "gbraid" "text",
    "created_month" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "entry_page" "text",
    "exit_page" "text",
    "total_duration_sec" integer DEFAULT 0,
    "event_count" integer DEFAULT 0,
    "attribution_source" "text",
    "device_type" "text",
    "city" "text",
    "district" "text",
    "fingerprint" "text",
    "lead_score" integer DEFAULT 0,
    "ai_score" integer DEFAULT 0,
    "ai_summary" "text",
    "ai_tags" "text"[],
    "user_journey_path" "text",
    "utm_term" "text",
    "matchtype" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "ads_network" "text",
    "ads_placement" "text",
    "device_os" "text",
    "telco_carrier" "text",
    "browser" "text",
    "browser_language" "text",
    "device_memory" integer,
    "hardware_concurrency" integer,
    "screen_width" integer,
    "screen_height" integer,
    "pixel_ratio" numeric,
    "gpu_renderer" "text",
    "connection_type" "text",
    "is_returning" boolean DEFAULT false,
    "referrer_host" "text",
    "max_scroll_percentage" integer DEFAULT 0,
    "cta_hover_count" integer DEFAULT 0,
    "form_focus_duration" integer DEFAULT 0,
    "total_active_seconds" integer DEFAULT 0,
    "engagement_score" integer DEFAULT 0,
    "isp_asn" "text",
    "is_proxy_detected" boolean DEFAULT false,
    "visitor_rank" "text",
    "previous_visit_count" integer DEFAULT 0,
    "traffic_source" "text",
    "traffic_medium" "text",
    "utm_adgroup" "text",
    "device_model" "text",
    "ads_target_id" "text",
    "ads_adposition" "text",
    "ads_feed_item_id" "text",
    "loc_interest_ms" "text",
    "loc_physical_ms" "text",
    "consent_at" timestamp with time zone,
    "consent_scopes" "text"[] DEFAULT '{}'::"text"[],
    "geo_city" "text",
    "geo_district" "text",
    "geo_source" "text",
    "geo_updated_at" timestamp with time zone
);
ALTER TABLE ONLY "public"."sessions_default" ALTER COLUMN "site_id" SET STATISTICS 1000;


ALTER TABLE "public"."sessions_default" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shadow_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "aggregate_type" "text" NOT NULL,
    "aggregate_id" "uuid",
    "rejected_gear_or_branch" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shadow_decisions_aggregate_type_check" CHECK (("aggregate_type" = ANY (ARRAY['conversion'::"text", 'signal'::"text", 'pv'::"text"])))
);


ALTER TABLE "public"."shadow_decisions" OWNER TO "postgres";


COMMENT ON TABLE "public"."shadow_decisions" IS 'Singularity: Path-not-taken. Why was Gear X or branch Y rejected? Enables A/B re-simulation on past data.';



CREATE TABLE IF NOT EXISTS "public"."signal_entropy_by_fingerprint" (
    "fingerprint" "text" NOT NULL,
    "failure_count" bigint DEFAULT 0 NOT NULL,
    "total_count" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signal_entropy_by_fingerprint" OWNER TO "postgres";


COMMENT ON TABLE "public"."signal_entropy_by_fingerprint" IS 'Singularity: Per-fingerprint (e.g. hash(IP+UA)) failure rate. High score -> uncertainty_bit for analytics.';



CREATE TABLE IF NOT EXISTS "public"."site_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'analyst'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "site_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'operator'::"text", 'analyst'::"text", 'billing'::"text"])))
);


ALTER TABLE "public"."site_members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."site_members"."role" IS 'RBAC v2 site role: admin|operator|analyst|billing. Site owner is sites.user_id.';



CREATE TABLE IF NOT EXISTS "public"."site_plans" (
    "site_id" "uuid" NOT NULL,
    "plan_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "monthly_limit" integer NOT NULL,
    "soft_limit_enabled" boolean DEFAULT false NOT NULL,
    "hard_cap_multiplier" numeric DEFAULT 2 NOT NULL,
    "overage_price_per_1k" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."site_plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."site_plans" IS 'Revenue Kernel: plan limits per site. Invoice authority remains ingest_idempotency only; this table drives quota/reconciliation.';



COMMENT ON COLUMN "public"."site_plans"."monthly_limit" IS 'Hard limit (events/month).';



COMMENT ON COLUMN "public"."site_plans"."soft_limit_enabled" IS 'If true, over-limit events are OVERAGE not rejected until hard_cap.';



COMMENT ON COLUMN "public"."site_plans"."hard_cap_multiplier" IS 'Hard cap = monthly_limit * this (e.g. 2 = 200% of plan).';



CREATE TABLE IF NOT EXISTS "public"."site_usage_monthly" (
    "site_id" "uuid" NOT NULL,
    "year_month" "text" NOT NULL,
    "event_count" bigint DEFAULT 0 NOT NULL,
    "overage_count" bigint DEFAULT 0 NOT NULL,
    "last_synced_at" timestamp with time zone,
    CONSTRAINT "site_usage_monthly_year_month_format" CHECK (("year_month" ~ '^\d{4}-\d{2}$'::"text"))
);


ALTER TABLE "public"."site_usage_monthly" OWNER TO "postgres";


COMMENT ON TABLE "public"."site_usage_monthly" IS 'Revenue Kernel: monthly usage snapshot for UI. Invoice authority = ingest_idempotency only; this table is filled by reconciliation cron.';



COMMENT ON COLUMN "public"."site_usage_monthly"."year_month" IS 'YYYY-MM (UTC month).';



CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "public_id" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "name" "text",
    "assumed_cpc" numeric DEFAULT 0,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_deal_value" numeric DEFAULT 0,
    "pipeline_stages" "jsonb" DEFAULT '[{"id": "junk", "color": "destructive", "label": "Junk / ├ç├Âp", "order": 0, "is_macro": false, "is_system": true, "value_cents": 0}, {"id": "intent", "color": "secondary", "label": "Yeni ─░leti┼şim", "order": 1, "is_macro": false, "is_system": true, "value_cents": 1000}, {"id": "sealed", "color": "default", "label": "Sat─▒┼ş Kapan─▒┼ş─▒ (Seal)", "order": 99, "is_macro": true, "is_system": true, "value_cents": 500000}]'::"jsonb",
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "locale" "text" DEFAULT 'en-US'::"text" NOT NULL,
    "oci_config" "jsonb",
    "active_modules" "text"[] DEFAULT ARRAY['core_oci'::"text", 'scoring_v1'::"text"] NOT NULL,
    "oci_sync_method" "public"."oci_sync_method" DEFAULT 'script'::"public"."oci_sync_method",
    "default_aov" numeric DEFAULT 100.0 NOT NULL,
    "intent_weights" "jsonb" DEFAULT '{"junk": 0.0, "sealed": 1.0, "pending": 0.02, "qualified": 0.20}'::"jsonb" NOT NULL,
    "daily_lead_limit" integer DEFAULT 1000,
    "oci_api_key" "text",
    "min_conversion_value_cents" bigint DEFAULT 100000,
    "default_country_iso" "text" DEFAULT 'TR'::"text",
    CONSTRAINT "sites_default_deal_value_non_negative" CHECK ((("default_deal_value" IS NULL) OR ("default_deal_value" >= (0)::numeric)))
);

ALTER TABLE ONLY "public"."sites" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sites" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sites"."assumed_cpc" IS 'Optional: assumed cost per click/intent (in site currency) used for budget-saved estimation.';



COMMENT ON COLUMN "public"."sites"."currency" IS 'Currency code for UI/exports (default TRY).';



COMMENT ON COLUMN "public"."sites"."config" IS 'Per-site config: bounty chip values, UI knobs, etc.';



COMMENT ON COLUMN "public"."sites"."default_deal_value" IS 'Average revenue per deal for this site; used when sale_amount is not entered (proxy value from score: 0=0, 1-2=10%%, 3=30%%, 4-5=100%%).';



COMMENT ON COLUMN "public"."sites"."timezone" IS 'IANA timezone for display (e.g. Europe/Istanbul, UTC).';



COMMENT ON COLUMN "public"."sites"."locale" IS 'BCP-47 locale for formatting (e.g. tr-TR, en-US).';



COMMENT ON COLUMN "public"."sites"."oci_config" IS 'Per-site OCI conversion value configuration. Keys: base_value (numeric), currency (text), min_star (1-5), weights ({star: multiplier}).';



COMMENT ON COLUMN "public"."sites"."active_modules" IS 'Tenant feature entitlements. Only listed modules are enabled for this site.';



COMMENT ON COLUMN "public"."sites"."oci_sync_method" IS 'Explicit routing for OCI: api (backend worker push) or script (Google Ads Script pull).';



COMMENT ON COLUMN "public"."sites"."default_aov" IS 'Average Order Value index used for calculating the dynamic Google Ads offline conversion value.';



COMMENT ON COLUMN "public"."sites"."intent_weights" IS 'Mathematical weights per intent stage used for calculating the dynamic Google Ads offline conversion value.';



COMMENT ON COLUMN "public"."sites"."daily_lead_limit" IS 'Max number of leads per 24h before 429 rate limiting.';



COMMENT ON COLUMN "public"."sites"."oci_api_key" IS 'Site-scoped OCI API key for verify/export/ack. Unique, nullable until configured.';



COMMENT ON COLUMN "public"."sites"."min_conversion_value_cents" IS 'Minimum conversion value in minor units (cents); used as floor. Default 100000 = 1000 TRY.';



COMMENT ON COLUMN "public"."sites"."default_country_iso" IS 'DIC: Default country ISO (e.g. TR, US) for E.164 phone normalization and Enhanced Conversions.';



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "tier" "text" NOT NULL,
    "status" "text",
    "provider" "text",
    "provider_customer_id" "text",
    "provider_subscription_id" "text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_provider_check" CHECK (("provider" = ANY (ARRAY['LEMON'::"text", 'IYZICO'::"text", 'MANUAL'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'TRIALING'::"text", 'CANCELED'::"text", 'PAST_DUE'::"text"]))),
    CONSTRAINT "subscriptions_tier_check" CHECK (("tier" = ANY (ARRAY['FREE'::"text", 'STARTER'::"text", 'PRO'::"text", 'AGENCY'::"text", 'SUPER_ADMIN'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS 'Sprint-1: Payment state and explicit tier per site. Tier drives get_entitlements_for_site.';



CREATE TABLE IF NOT EXISTS "public"."sync_dlq" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "site_id" "uuid",
    "qstash_message_id" "text",
    "dedup_event_id" "uuid",
    "stage" "text",
    "error" "text",
    "payload" "jsonb" NOT NULL,
    "replay_count" integer DEFAULT 0 NOT NULL,
    "last_replay_at" timestamp with time zone,
    "last_replay_error" "text"
);


ALTER TABLE "public"."sync_dlq" OWNER TO "postgres";


COMMENT ON TABLE "public"."sync_dlq" IS 'Dead-letter queue for sync worker. Stores non-retryable payloads + error details for manual replay/audit.';



CREATE TABLE IF NOT EXISTS "public"."sync_dlq_replay_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dlq_id" "uuid" NOT NULL,
    "replayed_by_user_id" "uuid",
    "replayed_by_email" "text",
    "replayed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "replay_count_after" integer NOT NULL,
    "error_if_failed" "text"
);


ALTER TABLE "public"."sync_dlq_replay_audit" OWNER TO "postgres";


COMMENT ON TABLE "public"."sync_dlq_replay_audit" IS 'Audit trail for DLQ replay: who replayed which dlq, when, replay_count after.';



CREATE TABLE IF NOT EXISTS "public"."system_integrity_merkle" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "heartbeat_sequence" bigint NOT NULL,
    "merkle_root_hash" "text" NOT NULL,
    "ledger_id_from" bigint NOT NULL,
    "ledger_id_to" bigint NOT NULL,
    "scope_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_integrity_merkle" OWNER TO "postgres";


COMMENT ON TABLE "public"."system_integrity_merkle" IS 'Singularity: Every 1000 causal_dna_ledger entries, hash of those + site_usage snapshot. Proves untampered chain of custody.';



CREATE TABLE IF NOT EXISTS "public"."usage_counters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "month" "date" NOT NULL,
    "revenue_events_count" integer DEFAULT 0 NOT NULL,
    "conversion_sends_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usage_counters" OWNER TO "postgres";


COMMENT ON TABLE "public"."usage_counters" IS 'Sprint-1: Per-site per-month counters for entitlement limit checks. Written only via increment_usage_checked (service_role).';



CREATE TABLE IF NOT EXISTS "public"."user_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_emails" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "email_lc" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_emails_email_lc_lower_check" CHECK (("email_lc" = "lower"("email")))
);


ALTER TABLE "public"."user_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watchtower_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_name" "text" NOT NULL,
    "ok" boolean NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watchtower_checks" OWNER TO "postgres";


COMMENT ON TABLE "public"."watchtower_checks" IS 'Append-only operational health checks (partition drift, triggers, etc.). No public read policies.';



ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_2026_01" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');



ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_2026_02" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');



ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_2026_03" FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');



ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_default" DEFAULT;



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_2026_01" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_2026_02" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_2026_03" FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_default" DEFAULT;



ALTER TABLE ONLY "public"."billing_reconciliation_jobs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."billing_reconciliation_jobs_id_seq"'::"regclass");



ALTER TABLE ONLY "private"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("key_name");



ALTER TABLE ONLY "private"."site_secrets"
    ADD CONSTRAINT "site_secrets_pkey" PRIMARY KEY ("site_id");



ALTER TABLE ONLY "public"."ad_spend_daily"
    ADD CONSTRAINT "ad_spend_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ad_spend_daily"
    ADD CONSTRAINT "ad_spend_daily_site_id_campaign_id_spend_date_key" UNIQUE ("site_id", "campaign_id", "spend_date");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_compensation_failures"
    ADD CONSTRAINT "billing_compensation_failures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_reconciliation_jobs"
    ADD CONSTRAINT "billing_reconciliation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_reconciliation_jobs"
    ADD CONSTRAINT "billing_reconciliation_jobs_site_id_year_month_key" UNIQUE ("site_id", "year_month");



ALTER TABLE ONLY "public"."call_actions"
    ADD CONSTRAINT "call_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_scores"
    ADD CONSTRAINT "call_scores_call_id_key" UNIQUE ("call_id");



ALTER TABLE ONLY "public"."call_scores"
    ADD CONSTRAINT "call_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."calls"
    ADD CONSTRAINT "calls_click_intent_invariants_chk" CHECK ((("source" <> 'click'::"text") OR (("intent_action" = ANY (ARRAY['phone'::"text", 'whatsapp'::"text", 'form'::"text"])) AND ("intent_target" IS NOT NULL) AND ("intent_target" <> ''::"text") AND ("intent_stamp" IS NOT NULL) AND ("intent_stamp" <> ''::"text")))) NOT VALID;



ALTER TABLE "public"."calls"
    ADD CONSTRAINT "calls_form_state_chk" CHECK ((("form_state" IS NULL) OR ("form_state" = ANY (ARRAY['started'::"text", 'attempted'::"text", 'validation_failed'::"text", 'network_failed'::"text", 'success'::"text"])))) NOT VALID;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_site_intent_stamp_uniq" UNIQUE ("site_id", "intent_stamp");



ALTER TABLE ONLY "public"."causal_dna_ledger_failures"
    ADD CONSTRAINT "causal_dna_ledger_failures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."causal_dna_ledger"
    ADD CONSTRAINT "causal_dna_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_links"
    ADD CONSTRAINT "conversation_links_conversation_id_entity_type_entity_id_key" UNIQUE ("conversation_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."conversation_links"
    ADD CONSTRAINT "conversation_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversions"
    ADD CONSTRAINT "conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_invite_audit"
    ADD CONSTRAINT "customer_invite_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_2026_01"
    ADD CONSTRAINT "events_2026_01_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_2026_02"
    ADD CONSTRAINT "events_2026_02_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_2026_03"
    ADD CONSTRAINT "events_2026_03_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_default"
    ADD CONSTRAINT "events_default_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."gdpr_consents"
    ADD CONSTRAINT "gdpr_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gdpr_consents"
    ADD CONSTRAINT "gdpr_consents_site_id_identifier_type_identifier_value_key" UNIQUE ("site_id", "identifier_type", "identifier_value");



ALTER TABLE ONLY "public"."gdpr_erase_requests"
    ADD CONSTRAINT "gdpr_erase_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."google_geo_targets"
    ADD CONSTRAINT "google_geo_targets_pkey" PRIMARY KEY ("criteria_id");



ALTER TABLE ONLY "public"."ingest_fallback_buffer"
    ADD CONSTRAINT "ingest_fallback_buffer_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingest_fraud_quarantine"
    ADD CONSTRAINT "ingest_fraud_quarantine_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingest_idempotency"
    ADD CONSTRAINT "ingest_idempotency_pkey" PRIMARY KEY ("site_id", "idempotency_key");



ALTER TABLE ONLY "public"."ingest_publish_failures"
    ADD CONSTRAINT "ingest_publish_failures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_snapshot"
    ADD CONSTRAINT "invoice_snapshot_pkey" PRIMARY KEY ("site_id", "year_month");



ALTER TABLE ONLY "public"."marketing_signals"
    ADD CONSTRAINT "marketing_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oci_payload_validation_events"
    ADD CONSTRAINT "oci_payload_validation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oci_queue_transitions"
    ADD CONSTRAINT "oci_queue_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offline_conversion_queue"
    ADD CONSTRAINT "offline_conversion_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offline_conversion_queue"
    ADD CONSTRAINT "offline_conversion_queue_sale_id_key" UNIQUE ("sale_id");



ALTER TABLE ONLY "public"."offline_conversion_tombstones"
    ADD CONSTRAINT "offline_conversion_tombstones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offline_conversion_tombstones"
    ADD CONSTRAINT "offline_conversion_tombstones_source_queue_id_key" UNIQUE ("source_queue_id");



ALTER TABLE ONLY "public"."outbox_events"
    ADD CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processed_signals"
    ADD CONSTRAINT "processed_signals_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_credentials"
    ADD CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_credentials"
    ADD CONSTRAINT "provider_credentials_site_id_provider_key_key" UNIQUE ("site_id", "provider_key");



ALTER TABLE ONLY "public"."provider_dispatches"
    ADD CONSTRAINT "provider_dispatches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_health_state"
    ADD CONSTRAINT "provider_health_state_pkey" PRIMARY KEY ("site_id", "provider_key");



ALTER TABLE ONLY "public"."provider_upload_attempts"
    ADD CONSTRAINT "provider_upload_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_upload_metrics"
    ADD CONSTRAINT "provider_upload_metrics_pkey" PRIMARY KEY ("site_id", "provider_key");



ALTER TABLE ONLY "public"."revenue_snapshots"
    ADD CONSTRAINT "revenue_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_2026_01"
    ADD CONSTRAINT "sessions_2026_01_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_2026_02"
    ADD CONSTRAINT "sessions_2026_02_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_2026_03"
    ADD CONSTRAINT "sessions_2026_03_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_default"
    ADD CONSTRAINT "sessions_default_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."shadow_decisions"
    ADD CONSTRAINT "shadow_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signal_entropy_by_fingerprint"
    ADD CONSTRAINT "signal_entropy_by_fingerprint_pkey" PRIMARY KEY ("fingerprint");



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_site_id_user_id_key" UNIQUE ("site_id", "user_id");



ALTER TABLE ONLY "public"."site_plans"
    ADD CONSTRAINT "site_plans_pkey" PRIMARY KEY ("site_id");



ALTER TABLE ONLY "public"."site_usage_monthly"
    ADD CONSTRAINT "site_usage_monthly_pkey" PRIMARY KEY ("site_id", "year_month");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_oci_api_key_key" UNIQUE ("oci_api_key");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_public_id_key" UNIQUE ("public_id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_public_id_unique" UNIQUE ("public_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_dlq"
    ADD CONSTRAINT "sync_dlq_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_dlq_replay_audit"
    ADD CONSTRAINT "sync_dlq_replay_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_integrity_merkle"
    ADD CONSTRAINT "system_integrity_merkle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offline_conversion_queue"
    ADD CONSTRAINT "unique_call_conversion_action" UNIQUE ("call_id", "provider_key");



ALTER TABLE ONLY "public"."usage_counters"
    ADD CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usage_counters"
    ADD CONSTRAINT "usage_counters_site_id_month_key" UNIQUE ("site_id", "month");



ALTER TABLE ONLY "public"."user_credentials"
    ADD CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_credentials"
    ADD CONSTRAINT "user_credentials_user_id_provider_key" UNIQUE ("user_id", "provider");



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_email_lc_key" UNIQUE ("email_lc");



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watchtower_checks"
    ADD CONSTRAINT "watchtower_checks_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "calls_site_signature_hash_uq" ON "public"."calls" USING "btree" ("site_id", "signature_hash") WHERE ("signature_hash" IS NOT NULL);



COMMENT ON INDEX "public"."calls_site_signature_hash_uq" IS 'Call-event DB idempotency: prevents duplicate inserts when Redis replay cache unavailable (multi-instance).';



CREATE INDEX "idx_events_category_created_at" ON ONLY "public"."events" USING "btree" ("event_category", "created_at");



CREATE INDEX "events_2026_01_event_category_created_at_idx" ON "public"."events_2026_01" USING "btree" ("event_category", "created_at");



CREATE INDEX "idx_events_metadata_fingerprint_text" ON ONLY "public"."events" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "events_2026_01_expr_idx" ON "public"."events_2026_01" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "idx_events_metadata_gclid_text" ON ONLY "public"."events" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "events_2026_01_expr_idx1" ON "public"."events_2026_01" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "idx_events_metadata_gin" ON ONLY "public"."events" USING "gin" ("metadata");



CREATE INDEX "events_2026_01_metadata_idx" ON "public"."events_2026_01" USING "gin" ("metadata");



CREATE INDEX "idx_events_session_created" ON ONLY "public"."events" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "events_2026_01_session_id_created_at_idx" ON "public"."events_2026_01" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "idx_events_atomic_filter" ON ONLY "public"."events" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "events_2026_01_session_id_event_category_created_at_idx" ON "public"."events_2026_01" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "idx_events_session_month_date" ON ONLY "public"."events" USING "btree" ("session_id", "session_month", "created_at");



COMMENT ON INDEX "public"."idx_events_session_month_date" IS 'Composite index for events with session join + date range';



CREATE INDEX "events_2026_01_session_id_session_month_created_at_idx" ON "public"."events_2026_01" USING "btree" ("session_id", "session_month", "created_at");



CREATE INDEX "idx_events_month_category" ON ONLY "public"."events" USING "btree" ("session_month", "event_category") WHERE ("event_category" = 'conversion'::"text");



COMMENT ON INDEX "public"."idx_events_month_category" IS 'Partial index for conversion events in get_dashboard_intents';



CREATE INDEX "events_2026_01_session_month_event_category_idx" ON "public"."events_2026_01" USING "btree" ("session_month", "event_category") WHERE ("event_category" = 'conversion'::"text");



CREATE UNIQUE INDEX "idx_events_ingest_dedup_id" ON ONLY "public"."events" USING "btree" ("session_month", "ingest_dedup_id") WHERE ("ingest_dedup_id" IS NOT NULL);



CREATE UNIQUE INDEX "events_2026_01_session_month_ingest_dedup_id_idx" ON "public"."events_2026_01" USING "btree" ("session_month", "ingest_dedup_id") WHERE ("ingest_dedup_id" IS NOT NULL);



CREATE INDEX "idx_events_site_fingerprint_created" ON ONLY "public"."events" USING "btree" ("site_id", (("metadata" ->> 'fingerprint'::"text")), "created_at" DESC) WHERE ((("metadata" ->> 'fingerprint'::"text") IS NOT NULL) AND (("metadata" -> 'gclid'::"text") IS NOT NULL));



COMMENT ON INDEX "public"."idx_events_site_fingerprint_created" IS 'Attribution past-GCLID lookup: site-scoped + fingerprint in SQL; prevents cross-tenant scan.';



CREATE INDEX "events_2026_01_site_id_expr_created_at_idx" ON "public"."events_2026_01" USING "btree" ("site_id", (("metadata" ->> 'fingerprint'::"text")), "created_at" DESC) WHERE ((("metadata" ->> 'fingerprint'::"text") IS NOT NULL) AND (("metadata" -> 'gclid'::"text") IS NOT NULL));



CREATE INDEX "idx_events_site_id" ON ONLY "public"."events" USING "btree" ("site_id");



CREATE INDEX "events_2026_01_site_id_idx" ON "public"."events_2026_01" USING "btree" ("site_id");



CREATE INDEX "events_2026_02_event_category_created_at_idx" ON "public"."events_2026_02" USING "btree" ("event_category", "created_at");



CREATE INDEX "events_2026_02_expr_idx" ON "public"."events_2026_02" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "events_2026_02_expr_idx1" ON "public"."events_2026_02" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "events_2026_02_metadata_idx" ON "public"."events_2026_02" USING "gin" ("metadata");



CREATE INDEX "events_2026_02_session_id_created_at_idx" ON "public"."events_2026_02" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "events_2026_02_session_id_event_category_created_at_idx" ON "public"."events_2026_02" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "events_2026_02_session_id_session_month_created_at_idx" ON "public"."events_2026_02" USING "btree" ("session_id", "session_month", "created_at");



CREATE INDEX "events_2026_02_session_month_event_category_idx" ON "public"."events_2026_02" USING "btree" ("session_month", "event_category") WHERE ("event_category" = 'conversion'::"text");



CREATE UNIQUE INDEX "events_2026_02_session_month_ingest_dedup_id_idx" ON "public"."events_2026_02" USING "btree" ("session_month", "ingest_dedup_id") WHERE ("ingest_dedup_id" IS NOT NULL);



CREATE INDEX "events_2026_02_site_id_expr_created_at_idx" ON "public"."events_2026_02" USING "btree" ("site_id", (("metadata" ->> 'fingerprint'::"text")), "created_at" DESC) WHERE ((("metadata" ->> 'fingerprint'::"text") IS NOT NULL) AND (("metadata" -> 'gclid'::"text") IS NOT NULL));



CREATE INDEX "events_2026_02_site_id_idx" ON "public"."events_2026_02" USING "btree" ("site_id");



CREATE INDEX "events_2026_03_created_at_idx" ON "public"."events_2026_03" USING "btree" ("created_at");



CREATE INDEX "events_2026_03_event_category_created_at_idx" ON "public"."events_2026_03" USING "btree" ("event_category", "created_at");



CREATE INDEX "events_2026_03_expr_idx" ON "public"."events_2026_03" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "events_2026_03_expr_idx1" ON "public"."events_2026_03" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "events_2026_03_metadata_idx" ON "public"."events_2026_03" USING "gin" ("metadata");



CREATE INDEX "events_2026_03_session_id_created_at_idx" ON "public"."events_2026_03" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "events_2026_03_session_id_event_category_created_at_idx" ON "public"."events_2026_03" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "events_2026_03_session_id_session_month_created_at_idx" ON "public"."events_2026_03" USING "btree" ("session_id", "session_month", "created_at");



CREATE INDEX "events_2026_03_session_month_event_category_idx" ON "public"."events_2026_03" USING "btree" ("session_month", "event_category") WHERE ("event_category" = 'conversion'::"text");



CREATE UNIQUE INDEX "events_2026_03_session_month_ingest_dedup_id_idx" ON "public"."events_2026_03" USING "btree" ("session_month", "ingest_dedup_id") WHERE ("ingest_dedup_id" IS NOT NULL);



CREATE INDEX "events_2026_03_site_id_expr_created_at_idx" ON "public"."events_2026_03" USING "btree" ("site_id", (("metadata" ->> 'fingerprint'::"text")), "created_at" DESC) WHERE ((("metadata" ->> 'fingerprint'::"text") IS NOT NULL) AND (("metadata" -> 'gclid'::"text") IS NOT NULL));



CREATE INDEX "events_2026_03_site_id_idx" ON "public"."events_2026_03" USING "btree" ("site_id");



CREATE INDEX "events_default_event_category_created_at_idx" ON "public"."events_default" USING "btree" ("event_category", "created_at");



CREATE INDEX "events_default_expr_idx" ON "public"."events_default" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "events_default_expr_idx1" ON "public"."events_default" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "events_default_metadata_idx" ON "public"."events_default" USING "gin" ("metadata");



CREATE INDEX "events_default_session_id_created_at_idx" ON "public"."events_default" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "events_default_session_id_event_category_created_at_idx" ON "public"."events_default" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "events_default_session_id_session_month_created_at_idx" ON "public"."events_default" USING "btree" ("session_id", "session_month", "created_at");



CREATE INDEX "events_default_session_month_event_category_idx" ON "public"."events_default" USING "btree" ("session_month", "event_category") WHERE ("event_category" = 'conversion'::"text");



CREATE UNIQUE INDEX "events_default_session_month_ingest_dedup_id_idx" ON "public"."events_default" USING "btree" ("session_month", "ingest_dedup_id") WHERE ("ingest_dedup_id" IS NOT NULL);



CREATE INDEX "events_default_site_id_expr_created_at_idx" ON "public"."events_default" USING "btree" ("site_id", (("metadata" ->> 'fingerprint'::"text")), "created_at" DESC) WHERE ((("metadata" ->> 'fingerprint'::"text") IS NOT NULL) AND (("metadata" -> 'gclid'::"text") IS NOT NULL));



CREATE INDEX "events_default_site_id_idx" ON "public"."events_default" USING "btree" ("site_id");



CREATE INDEX "idx_ad_spend_daily_site_date" ON "public"."ad_spend_daily" USING "btree" ("site_id", "spend_date" DESC);



CREATE INDEX "idx_audit_log_action" ON "public"."audit_log" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_audit_log_actor" ON "public"."audit_log" USING "btree" ("actor_id", "created_at" DESC) WHERE ("actor_id" IS NOT NULL);



CREATE INDEX "idx_audit_log_created_at" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_log_entry_reason" ON "public"."audit_log" USING "btree" ((("payload" ->> 'entry_reason'::"text")), "created_at" DESC) WHERE ("payload" ? 'entry_reason'::"text");



CREATE INDEX "idx_audit_log_site_id" ON "public"."audit_log" USING "btree" ("site_id", "created_at" DESC) WHERE ("site_id" IS NOT NULL);



CREATE INDEX "idx_billing_compensation_failures_site_created" ON "public"."billing_compensation_failures" USING "btree" ("site_id", "created_at" DESC);



COMMENT ON INDEX "public"."idx_billing_compensation_failures_site_created" IS 'DLQ reconciliation queries scoped by site and time.';



CREATE INDEX "idx_billing_compensation_failures_unresolved" ON "public"."billing_compensation_failures" USING "btree" ("site_id", "created_at") WHERE ("resolved_at" IS NULL);



CREATE INDEX "idx_billing_reconciliation_jobs_site_year_month" ON "public"."billing_reconciliation_jobs" USING "btree" ("site_id", "year_month");



CREATE INDEX "idx_billing_reconciliation_jobs_status_updated" ON "public"."billing_reconciliation_jobs" USING "btree" ("status", "updated_at");



CREATE INDEX "idx_call_actions_call_id_created_at_desc" ON "public"."call_actions" USING "btree" ("call_id", "created_at" DESC);



CREATE INDEX "idx_call_actions_site_id_action_type_created_at_desc" ON "public"."call_actions" USING "btree" ("site_id", "action_type", "created_at" DESC);



CREATE INDEX "idx_call_scores_site_created" ON "public"."call_scores" USING "btree" ("site_id", "created_at" DESC);



CREATE INDEX "idx_calls_caller_phone_e164" ON "public"."calls" USING "btree" ("caller_phone_e164") WHERE ("caller_phone_e164" IS NOT NULL);



CREATE INDEX "idx_calls_campaign_reporting" ON "public"."calls" USING "btree" ("site_id", "campaign_id", "adgroup_id");



CREATE INDEX "idx_calls_click_coverage" ON "public"."calls" USING "btree" ("site_id", "gclid", "wbraid", "gbraid");



CREATE INDEX "idx_calls_confirmed_at" ON "public"."calls" USING "btree" ("confirmed_at") WHERE ("confirmed_at" IS NOT NULL);



CREATE INDEX "idx_calls_created_at" ON "public"."calls" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_calls_dedupe_intent" ON "public"."calls" USING "btree" ("site_id", "matched_session_id", "source", "created_at") WHERE ("status" = 'intent'::"text");



CREATE INDEX "idx_calls_device_model" ON "public"."calls" USING "btree" ("device_model") WHERE ("device_model" IS NOT NULL);



CREATE INDEX "idx_calls_fingerprint" ON "public"."calls" USING "btree" ("matched_fingerprint");



CREATE INDEX "idx_calls_geo_source" ON "public"."calls" USING "btree" ("geo_source");



CREATE INDEX "idx_calls_geo_target_id" ON "public"."calls" USING "btree" ("geo_target_id") WHERE ("geo_target_id" IS NOT NULL);



CREATE INDEX "idx_calls_intent_fallback_dedupe" ON "public"."calls" USING "btree" ("site_id", "matched_session_id", "intent_action", "intent_target", "created_at") WHERE (("source" = 'click'::"text") AND (("status" = 'intent'::"text") OR ("status" IS NULL)));



CREATE INDEX "idx_calls_matched_at" ON "public"."calls" USING "btree" ("matched_at") WHERE ("matched_at" IS NOT NULL);



CREATE INDEX "idx_calls_matched_session" ON "public"."calls" USING "btree" ("matched_session_id");



COMMENT ON INDEX "public"."idx_calls_matched_session" IS 'Index for loose coupling with partitioned sessions table (no FK constraint).';



CREATE INDEX "idx_calls_session_id" ON "public"."calls" USING "btree" ("matched_session_id");



CREATE INDEX "idx_calls_session_lookup" ON "public"."calls" USING "btree" ("matched_session_id", "session_created_month", "site_id");



CREATE INDEX "idx_calls_site_date" ON "public"."calls" USING "btree" ("site_id", "created_at");



COMMENT ON INDEX "public"."idx_calls_site_date" IS 'Composite index for dashboard RPCs: site_id + date range';



CREATE UNIQUE INDEX "idx_calls_site_event_id_uniq" ON "public"."calls" USING "btree" ("site_id", "event_id") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "idx_calls_site_id" ON "public"."calls" USING "btree" ("site_id");



CREATE INDEX "idx_calls_site_id_created_at" ON "public"."calls" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_calls_site_id_matched_fingerprint" ON "public"."calls" USING "btree" ("site_id", "matched_fingerprint") WHERE ("matched_fingerprint" IS NOT NULL);



COMMENT ON INDEX "public"."idx_calls_site_id_matched_fingerprint" IS 'Visitor history: site_id + matched_fingerprint lookup.';



CREATE INDEX "idx_calls_site_id_status" ON "public"."calls" USING "btree" ("site_id", "status") WHERE ("status" IS NOT NULL);



COMMENT ON INDEX "public"."idx_calls_site_id_status" IS 'Dashboard/intent filters: site_id + status.';



CREATE UNIQUE INDEX "idx_calls_site_intent_stamp_uniq" ON "public"."calls" USING "btree" ("site_id", "intent_stamp") WHERE ("intent_stamp" IS NOT NULL);



CREATE INDEX "idx_calls_site_keyword" ON "public"."calls" USING "btree" ("site_id", "keyword") WHERE ("keyword" IS NOT NULL);



CREATE INDEX "idx_calls_site_oci_status_created_at" ON "public"."calls" USING "btree" ("site_id", "oci_status", "created_at" DESC);



CREATE INDEX "idx_calls_site_sale_review_status" ON "public"."calls" USING "btree" ("site_id", "sale_review_status", "created_at" DESC) WHERE (("sale_review_status" IS NOT NULL) AND ("sale_review_status" <> 'NONE'::"text"));



CREATE INDEX "idx_calls_site_source_created_at" ON "public"."calls" USING "btree" ("site_id", "source", "created_at" DESC);



CREATE INDEX "idx_calls_site_status_created_covering" ON "public"."calls" USING "btree" ("site_id", "status", "created_at" DESC) INCLUDE ("matched_session_id", "session_created_month", "lead_score", "intent_action");



CREATE INDEX "idx_calls_source" ON "public"."calls" USING "btree" ("source") WHERE ("source" IS NOT NULL);



CREATE INDEX "idx_calls_source_type" ON "public"."calls" USING "btree" ("source_type");



CREATE INDEX "idx_calls_status" ON "public"."calls" USING "btree" ("status") WHERE ("status" IS NOT NULL);



CREATE INDEX "idx_calls_status_expires_at" ON "public"."calls" USING "btree" ("status", "expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_calls_status_intent" ON "public"."calls" USING "btree" ("status") WHERE ("status" = 'intent'::"text");



CREATE INDEX "idx_calls_trace_id" ON "public"."calls" USING "btree" ("trace_id") WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_causal_dna_ledger_failures_site_created" ON "public"."causal_dna_ledger_failures" USING "btree" ("site_id", "created_at" DESC);



CREATE INDEX "idx_causal_dna_ledger_id_created" ON "public"."causal_dna_ledger" USING "btree" ("id", "created_at");



CREATE INDEX "idx_causal_dna_ledger_site_created" ON "public"."causal_dna_ledger" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_conversation_links_conversation_id" ON "public"."conversation_links" USING "btree" ("conversation_id");



CREATE UNIQUE INDEX "idx_conversations_site_primary_call" ON "public"."conversations" USING "btree" ("site_id", "primary_call_id") WHERE ("primary_call_id" IS NOT NULL);



CREATE INDEX "idx_conversations_site_status" ON "public"."conversations" USING "btree" ("site_id", "status");



CREATE INDEX "idx_conversions_claimed_at" ON "public"."conversions" USING "btree" ("claimed_at") WHERE ("google_sent_at" IS NULL);



CREATE INDEX "idx_conversions_gclid" ON "public"."conversions" USING "btree" ("gclid");



CREATE INDEX "idx_conversions_pending_worker" ON "public"."conversions" USING "btree" ("next_retry_at", "created_at") WHERE (("google_sent_at" IS NULL) AND ("google_action" IS NOT NULL));



CREATE INDEX "idx_conversions_sealed_pending" ON "public"."conversions" USING "btree" ("next_retry_at", "created_at") WHERE (("google_sent_at" IS NULL) AND ("google_action" IS NOT NULL) AND ("seal_status" = 'sealed'::"text"));



CREATE INDEX "idx_customer_invite_audit_created_at" ON "public"."customer_invite_audit" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_customer_invite_audit_invitee_email_lc" ON "public"."customer_invite_audit" USING "btree" ("invitee_email_lc");



CREATE INDEX "idx_customer_invite_audit_inviter_user_id" ON "public"."customer_invite_audit" USING "btree" ("inviter_user_id");



CREATE INDEX "idx_customer_invite_audit_site_id" ON "public"."customer_invite_audit" USING "btree" ("site_id");



CREATE INDEX "idx_events_2026_01_created_at" ON "public"."events_2026_01" USING "btree" ("created_at");



CREATE INDEX "idx_events_2026_02_created_at" ON "public"."events_2026_02" USING "btree" ("created_at");



CREATE INDEX "idx_events_default_created_at" ON "public"."events_default" USING "btree" ("created_at");



CREATE INDEX "idx_gdpr_consents_site_identifier" ON "public"."gdpr_consents" USING "btree" ("site_id", "identifier_type", "identifier_value");



CREATE INDEX "idx_gdpr_erase_requests_identifier" ON "public"."gdpr_erase_requests" USING "btree" ("identifier_type", "identifier_value");



CREATE INDEX "idx_gdpr_erase_requests_site_id" ON "public"."gdpr_erase_requests" USING "btree" ("site_id");



CREATE INDEX "idx_gdpr_erase_requests_status" ON "public"."gdpr_erase_requests" USING "btree" ("status");



CREATE INDEX "idx_geo_targets_country_code" ON "public"."google_geo_targets" USING "btree" ("country_code");



CREATE INDEX "idx_geo_targets_country_type" ON "public"."google_geo_targets" USING "btree" ("country_code", "target_type");



CREATE INDEX "idx_geo_targets_parent_id" ON "public"."google_geo_targets" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "idx_ingest_fallback_buffer_status_created" ON "public"."ingest_fallback_buffer" USING "btree" ("status", "created_at") WHERE ("status" = 'PENDING'::"public"."ingest_fallback_status");



CREATE INDEX "idx_ingest_fraud_quarantine_reason" ON "public"."ingest_fraud_quarantine" USING "btree" ("reason");



CREATE INDEX "idx_ingest_fraud_quarantine_site_created" ON "public"."ingest_fraud_quarantine" USING "btree" ("site_id", "created_at" DESC);



CREATE INDEX "idx_ingest_idempotency_created_at" ON "public"."ingest_idempotency" USING "btree" ("created_at");



CREATE INDEX "idx_ingest_idempotency_expires_at" ON "public"."ingest_idempotency" USING "btree" ("expires_at");



CREATE INDEX "idx_ingest_idempotency_site_year_month_billable" ON "public"."ingest_idempotency" USING "btree" ("site_id", "year_month") WHERE ("billable" = true);



COMMENT ON INDEX "public"."idx_ingest_idempotency_site_year_month_billable" IS 'Revenue Kernel: reconciliation count by (site_id, year_month) for billable rows. Invoice SoT = this table only.';



CREATE INDEX "idx_ingest_idempotency_site_year_month_billing_billable" ON "public"."ingest_idempotency" USING "btree" ("site_id", "year_month", "billing_state") WHERE ("billable" = true);



COMMENT ON INDEX "public"."idx_ingest_idempotency_site_year_month_billing_billable" IS 'Revenue Kernel: reconciliation by (site_id, year_month, billing_state) for billable rows.';



CREATE INDEX "idx_ingest_idempotency_site_year_month_reason" ON "public"."ingest_idempotency" USING "btree" ("site_id", "year_month", "billing_reason");



CREATE INDEX "idx_ingest_idempotency_site_year_month_version_billable" ON "public"."ingest_idempotency" USING "btree" ("site_id", "year_month", "idempotency_version") WHERE ("billable" = true);



COMMENT ON INDEX "public"."idx_ingest_idempotency_site_year_month_version_billable" IS 'Revenue Kernel PR-2: reconciliation count by site/month/version for billable rows.';



CREATE INDEX "idx_ingest_idempotency_version" ON "public"."ingest_idempotency" USING "btree" ("site_id", "idempotency_version") WHERE ("idempotency_version" = 2);



CREATE INDEX "idx_ingest_publish_failures_created_at" ON "public"."ingest_publish_failures" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ingest_publish_failures_site_created" ON "public"."ingest_publish_failures" USING "btree" ("site_public_id", "created_at" DESC);



CREATE INDEX "idx_marketing_signals_chain" ON "public"."marketing_signals" USING "btree" ("site_id", "call_id", "google_conversion_name", "adjustment_sequence");



CREATE INDEX "idx_marketing_signals_expected_value_cents" ON "public"."marketing_signals" USING "btree" ("expected_value_cents");



CREATE INDEX "idx_marketing_signals_pending" ON "public"."marketing_signals" USING "btree" ("site_id", "created_at") WHERE ("dispatch_status" = 'PENDING'::"text");



CREATE INDEX "idx_marketing_signals_pending_recovery" ON "public"."marketing_signals" USING "btree" ("dispatch_status", "created_at") WHERE ("dispatch_status" = 'PENDING'::"text");



COMMENT ON INDEX "public"."idx_marketing_signals_pending_recovery" IS 'Self-Healing Pulse: efficient scan of PENDING signals for recovery.';



CREATE UNIQUE INDEX "idx_marketing_signals_site_call_gear_seq" ON "public"."marketing_signals" USING "btree" ("site_id", "call_id", "google_conversion_name", "adjustment_sequence") WHERE ("call_id" IS NOT NULL);



COMMENT ON INDEX "public"."idx_marketing_signals_site_call_gear_seq" IS 'Strict Ledger Sequence: One signal per (site, call, gear, sequence). Enables immutable adjustments.';



CREATE INDEX "idx_marketing_signals_site_call_id" ON "public"."marketing_signals" USING "btree" ("site_id", "call_id") WHERE ("call_id" IS NOT NULL);



COMMENT ON INDEX "public"."idx_marketing_signals_site_call_id" IS 'Hot-path: tenant-scoped signal lookups by call_id (dedup, attribution, gear queries).';



CREATE INDEX "idx_marketing_signals_site_occurred_at" ON "public"."marketing_signals" USING "btree" ("site_id", "occurred_at" DESC);



CREATE INDEX "idx_marketing_signals_site_pending_covering" ON "public"."marketing_signals" USING "btree" ("site_id", "created_at") INCLUDE ("call_id", "signal_type", "google_conversion_name", "dispatch_status") WHERE ("dispatch_status" = 'PENDING'::"text");



CREATE INDEX "idx_marketing_signals_site_type" ON "public"."marketing_signals" USING "btree" ("site_id", "signal_type");



COMMENT ON INDEX "public"."idx_marketing_signals_site_type" IS 'Hot-path: gear dedup checks filtered by signal_type (e.g. INTENT_CAPTURED) per site.';



CREATE INDEX "idx_marketing_signals_sys_period" ON "public"."marketing_signals" USING "gist" ("sys_period");



CREATE INDEX "idx_marketing_signals_trace_id" ON "public"."marketing_signals" USING "btree" ("trace_id") WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_marketing_signals_valid_period" ON "public"."marketing_signals" USING "gist" ("valid_period");



CREATE INDEX "idx_ms_history_call_id" ON "public"."marketing_signals_history" USING "btree" ("call_id", "history_recorded_at" DESC);



CREATE UNIQUE INDEX "idx_oci_idempotency_gbraid" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "gbraid", "action", "conversion_time") WHERE ("gbraid" IS NOT NULL);



CREATE UNIQUE INDEX "idx_oci_idempotency_gclid" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "gclid", "action", "conversion_time") WHERE ("gclid" IS NOT NULL);



COMMENT ON INDEX "public"."idx_oci_idempotency_gclid" IS 'Prevents duplicate OCI uploads for the same GCLID/Action/Time.';



CREATE UNIQUE INDEX "idx_oci_idempotency_wbraid" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "wbraid", "action", "conversion_time") WHERE ("wbraid" IS NOT NULL);



CREATE INDEX "idx_oci_payload_validation_events_created_at" ON "public"."oci_payload_validation_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_oci_payload_validation_events_site_queue" ON "public"."oci_payload_validation_events" USING "btree" ("site_id", "queue_id", "created_at" DESC);



CREATE INDEX "idx_oci_queue_transitions_created_at" ON "public"."oci_queue_transitions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_oci_queue_transitions_queue_created_at" ON "public"."oci_queue_transitions" USING "btree" ("queue_id", "created_at" DESC);



CREATE INDEX "idx_oci_queue_transitions_queue_id_desc" ON "public"."oci_queue_transitions" USING "btree" ("queue_id", "id" DESC);



CREATE INDEX "idx_ocq_covering" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "status", "created_at") INCLUDE ("value_cents", "currency");



CREATE INDEX "idx_ocq_site_status_created_covering" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "status", "created_at" DESC) INCLUDE ("call_id", "gclid", "conversion_time", "value_cents") WHERE ("status" = 'COMPLETED'::"text");



CREATE INDEX "idx_offline_conversion_queue_eligible_scan" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "provider_key", "status", "next_retry_at") WHERE ("status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text"]));



CREATE INDEX "idx_offline_conversion_queue_priority_claim_phase23" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "provider_key", "queue_priority" DESC, "next_retry_at" NULLS FIRST, "created_at", "id") WHERE ("status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text"]));



COMMENT ON INDEX "public"."idx_offline_conversion_queue_priority_claim_phase23" IS 'Phase 23A additive claim index. Existing pending indexes remain until Phase 23C cutover.';



CREATE INDEX "idx_offline_conversion_queue_processing_claimed_at" ON "public"."offline_conversion_queue" USING "btree" ("claimed_at") WHERE ("status" = 'PROCESSING'::"text");



CREATE INDEX "idx_offline_conversion_queue_provider_status_retry" ON "public"."offline_conversion_queue" USING "btree" ("provider_key", "status", "next_retry_at") WHERE ("status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text"]));



CREATE INDEX "idx_offline_conversion_queue_site_id" ON "public"."offline_conversion_queue" USING "btree" ("site_id");



CREATE INDEX "idx_offline_conversion_queue_site_occurred_at" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "occurred_at" DESC);



CREATE UNIQUE INDEX "idx_offline_conversion_queue_site_provider_external_id_active" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "provider_key", "external_id") WHERE ("status" <> ALL (ARRAY['VOIDED_BY_REVERSAL'::"text", 'COMPLETED'::"text", 'UPLOADED'::"text", 'COMPLETED_UNVERIFIED'::"text", 'FAILED'::"text"]));



COMMENT ON INDEX "public"."idx_offline_conversion_queue_site_provider_external_id_active" IS 'Deduplication guard: prevents duplicate active OCI conversions for the same logical identity. External_id is now SHA-256-based.';



CREATE UNIQUE INDEX "idx_offline_conversion_queue_site_session_pending" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "session_id") WHERE (("status" = ANY (ARRAY['QUEUED'::"text", 'RETRY'::"text", 'PROCESSING'::"text"])) AND ("session_id" IS NOT NULL));



COMMENT ON INDEX "public"."idx_offline_conversion_queue_site_session_pending" IS 'OCI dedupe: one pending conversion per session per site.';



CREATE INDEX "idx_offline_conversion_queue_status_created_at" ON "public"."offline_conversion_queue" USING "btree" ("status", "created_at");



CREATE INDEX "idx_offline_conversion_queue_uploaded_at" ON "public"."offline_conversion_queue" USING "btree" ("site_id", "provider_key", "uploaded_at") WHERE ("uploaded_at" IS NOT NULL);



CREATE INDEX "idx_offline_conversion_tombstones_site_created" ON "public"."offline_conversion_tombstones" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_outbox_events_pending" ON "public"."outbox_events" USING "btree" ("created_at") WHERE ("status" = 'PENDING'::"text");



CREATE INDEX "idx_outbox_events_site_call_id" ON "public"."outbox_events" USING "btree" ("site_id", "call_id") WHERE ("call_id" IS NOT NULL);



COMMENT ON INDEX "public"."idx_outbox_events_site_call_id" IS 'Hot-path: per-call OCI artifact invalidation (junk/restore/cancel flows).';



CREATE INDEX "idx_outbox_events_site_status" ON "public"."outbox_events" USING "btree" ("site_id", "status");



CREATE INDEX "idx_processed_signals_lookup" ON "public"."processed_signals" USING "btree" ("event_id");



CREATE INDEX "idx_processed_signals_site_id" ON "public"."processed_signals" USING "btree" ("site_id");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_provider_credentials_site_provider" ON "public"."provider_credentials" USING "btree" ("site_id", "provider_key") WHERE ("is_active" = true);



CREATE INDEX "idx_provider_dispatch_pending" ON "public"."provider_dispatches" USING "btree" ("snapshot_id", "provider_key", "next_retry_at") WHERE ("status" = 'PENDING'::"text");



CREATE INDEX "idx_provider_dispatches_snapshot" ON "public"."provider_dispatches" USING "btree" ("snapshot_id");



CREATE INDEX "idx_provider_health_state_next_probe" ON "public"."provider_health_state" USING "btree" ("next_probe_at") WHERE ("state" = 'OPEN'::"public"."provider_circuit_state");



CREATE INDEX "idx_provider_upload_attempts_batch_id" ON "public"."provider_upload_attempts" USING "btree" ("batch_id");



CREATE INDEX "idx_provider_upload_attempts_site_provider_created" ON "public"."provider_upload_attempts" USING "btree" ("site_id", "provider_key", "created_at" DESC);



CREATE INDEX "idx_provider_upload_metrics_updated_at" ON "public"."provider_upload_metrics" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_rev_snapshots_meta_gin" ON "public"."revenue_snapshots" USING "gin" ("meta_json");



CREATE INDEX "idx_rev_snapshots_reasons_gin" ON "public"."revenue_snapshots" USING "gin" ("reasons_json");



CREATE INDEX "idx_revenue_snapshots_call_id" ON "public"."revenue_snapshots" USING "btree" ("call_id") WHERE ("call_id" IS NOT NULL);



CREATE INDEX "idx_revenue_snapshots_site_created" ON "public"."revenue_snapshots" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_sales_conversation_id" ON "public"."sales" USING "btree" ("conversation_id");



CREATE UNIQUE INDEX "idx_sales_site_external_ref" ON "public"."sales" USING "btree" ("site_id", "external_ref") WHERE ("external_ref" IS NOT NULL);



CREATE INDEX "idx_sales_site_occurred_at" ON "public"."sales" USING "btree" ("site_id", "occurred_at" DESC);



CREATE INDEX "idx_sales_site_status" ON "public"."sales" USING "btree" ("site_id", "status");



CREATE INDEX "idx_sales_site_status_occurred_at" ON "public"."sales" USING "btree" ("site_id", "status", "occurred_at" DESC);



CREATE INDEX "idx_sales_status_occurred_at" ON "public"."sales" USING "btree" ("status", "occurred_at" DESC);



COMMENT ON INDEX "public"."idx_sales_status_occurred_at" IS 'Cron enqueue-from-sales: CONFIRMED sales in time window.';



CREATE INDEX "idx_sessions_2026_01_id" ON "public"."sessions_2026_01" USING "btree" ("id");



CREATE INDEX "idx_sessions_2026_02_id" ON "public"."sessions_2026_02" USING "btree" ("id");



CREATE INDEX "idx_sessions_ads_network" ON ONLY "public"."sessions" USING "btree" ("ads_network") WHERE ("ads_network" IS NOT NULL);



CREATE INDEX "idx_sessions_attribution_source" ON ONLY "public"."sessions" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "idx_sessions_default_created_month" ON "public"."sessions_default" USING "btree" ("created_month");



CREATE INDEX "idx_sessions_default_fingerprint" ON "public"."sessions_default" USING "btree" ("fingerprint");



CREATE INDEX "idx_sessions_device_os" ON ONLY "public"."sessions" USING "btree" ("device_os") WHERE ("device_os" IS NOT NULL);



CREATE INDEX "idx_sessions_device_type" ON ONLY "public"."sessions" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "idx_sessions_fingerprint" ON ONLY "public"."sessions" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "idx_sessions_gclid" ON ONLY "public"."sessions" USING "btree" ("gclid");



CREATE INDEX "idx_sessions_matchtype" ON ONLY "public"."sessions" USING "btree" ("matchtype") WHERE ("matchtype" IS NOT NULL);



CREATE INDEX "idx_sessions_site_fingerprint" ON ONLY "public"."sessions" USING "btree" ("site_id", "fingerprint") WHERE ("fingerprint" IS NOT NULL);



COMMENT ON INDEX "public"."idx_sessions_site_fingerprint" IS 'Call-event/GDPR: tenant-scoped fingerprint lookups. Avoids full scan under load.';



CREATE INDEX "idx_sessions_site_id_created_at" ON ONLY "public"."sessions" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_sessions_site_month" ON ONLY "public"."sessions" USING "btree" ("site_id", "created_month");



CREATE INDEX "idx_sessions_site_month_date" ON ONLY "public"."sessions" USING "btree" ("site_id", "created_month", "created_at");



COMMENT ON INDEX "public"."idx_sessions_site_month_date" IS 'Composite index for dashboard RPCs: site_id + partition + date range';



CREATE INDEX "idx_sessions_utm_adgroup" ON ONLY "public"."sessions" USING "btree" ("utm_adgroup") WHERE ("utm_adgroup" IS NOT NULL);



CREATE INDEX "idx_sessions_utm_campaign" ON ONLY "public"."sessions" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "idx_sessions_utm_source" ON ONLY "public"."sessions" USING "btree" ("utm_source") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "idx_sessions_utm_term" ON ONLY "public"."sessions" USING "btree" ("utm_term") WHERE ("utm_term" IS NOT NULL);



CREATE INDEX "idx_sessions_wbraid" ON ONLY "public"."sessions" USING "btree" ("wbraid");



CREATE INDEX "idx_shadow_decisions_aggregate" ON "public"."shadow_decisions" USING "btree" ("aggregate_type", "aggregate_id") WHERE ("aggregate_id" IS NOT NULL);



CREATE INDEX "idx_shadow_decisions_site_created" ON "public"."shadow_decisions" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_signal_entropy_updated" ON "public"."signal_entropy_by_fingerprint" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_site_members_site_id" ON "public"."site_members" USING "btree" ("site_id");



CREATE INDEX "idx_site_members_site_user" ON "public"."site_members" USING "btree" ("site_id", "user_id");



CREATE INDEX "idx_site_members_user_id" ON "public"."site_members" USING "btree" ("user_id");



CREATE INDEX "idx_site_usage_monthly_site_year_month" ON "public"."site_usage_monthly" USING "btree" ("site_id", "year_month");



CREATE INDEX "idx_sites_created_at" ON "public"."sites" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_sites_oci_api_key" ON "public"."sites" USING "btree" ("oci_api_key") WHERE ("oci_api_key" IS NOT NULL);



CREATE INDEX "idx_sites_pipeline_stages" ON "public"."sites" USING "gin" ("pipeline_stages");



CREATE INDEX "idx_sites_public_id" ON "public"."sites" USING "btree" ("public_id");



CREATE INDEX "idx_sync_dlq_dedup_event_id" ON "public"."sync_dlq" USING "btree" ("dedup_event_id");



CREATE INDEX "idx_sync_dlq_last_replay_at" ON "public"."sync_dlq" USING "btree" ("last_replay_at" DESC);



CREATE INDEX "idx_sync_dlq_qstash_message_id" ON "public"."sync_dlq" USING "btree" ("qstash_message_id");



CREATE INDEX "idx_sync_dlq_received_at" ON "public"."sync_dlq" USING "btree" ("received_at" DESC);



CREATE INDEX "idx_sync_dlq_replay_audit_dlq_id" ON "public"."sync_dlq_replay_audit" USING "btree" ("dlq_id");



CREATE INDEX "idx_sync_dlq_replay_audit_replayed_at" ON "public"."sync_dlq_replay_audit" USING "btree" ("replayed_at" DESC);



CREATE INDEX "idx_sync_dlq_site_id" ON "public"."sync_dlq" USING "btree" ("site_id");



CREATE INDEX "idx_system_integrity_merkle_created" ON "public"."system_integrity_merkle" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "idx_system_integrity_merkle_sequence" ON "public"."system_integrity_merkle" USING "btree" ("heartbeat_sequence");



CREATE INDEX "idx_user_emails_email_lc" ON "public"."user_emails" USING "btree" ("email_lc");



CREATE INDEX "idx_watchtower_checks_name_created_at" ON "public"."watchtower_checks" USING "btree" ("check_name", "created_at" DESC);



CREATE UNIQUE INDEX "offline_conversion_queue_call_id_key" ON "public"."offline_conversion_queue" USING "btree" ("call_id") WHERE ("call_id" IS NOT NULL);



CREATE INDEX "sessions_2026_01_ads_network_idx" ON "public"."sessions_2026_01" USING "btree" ("ads_network") WHERE ("ads_network" IS NOT NULL);



CREATE INDEX "sessions_2026_01_attribution_source_idx" ON "public"."sessions_2026_01" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_2026_01_device_os_idx" ON "public"."sessions_2026_01" USING "btree" ("device_os") WHERE ("device_os" IS NOT NULL);



CREATE INDEX "sessions_2026_01_device_type_idx" ON "public"."sessions_2026_01" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_2026_01_fingerprint_idx" ON "public"."sessions_2026_01" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_01_gclid_idx" ON "public"."sessions_2026_01" USING "btree" ("gclid");



CREATE INDEX "sessions_2026_01_matchtype_idx" ON "public"."sessions_2026_01" USING "btree" ("matchtype") WHERE ("matchtype" IS NOT NULL);



CREATE INDEX "sessions_2026_01_site_id_created_at_idx" ON "public"."sessions_2026_01" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_2026_01_site_id_created_month_created_at_idx" ON "public"."sessions_2026_01" USING "btree" ("site_id", "created_month", "created_at");



CREATE INDEX "sessions_2026_01_site_id_created_month_idx" ON "public"."sessions_2026_01" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_2026_01_site_id_fingerprint_idx" ON "public"."sessions_2026_01" USING "btree" ("site_id", "fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_01_utm_adgroup_idx" ON "public"."sessions_2026_01" USING "btree" ("utm_adgroup") WHERE ("utm_adgroup" IS NOT NULL);



CREATE INDEX "sessions_2026_01_utm_campaign_idx" ON "public"."sessions_2026_01" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "sessions_2026_01_utm_source_idx" ON "public"."sessions_2026_01" USING "btree" ("utm_source") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "sessions_2026_01_utm_term_idx" ON "public"."sessions_2026_01" USING "btree" ("utm_term") WHERE ("utm_term" IS NOT NULL);



CREATE INDEX "sessions_2026_01_wbraid_idx" ON "public"."sessions_2026_01" USING "btree" ("wbraid");



CREATE INDEX "sessions_2026_02_ads_network_idx" ON "public"."sessions_2026_02" USING "btree" ("ads_network") WHERE ("ads_network" IS NOT NULL);



CREATE INDEX "sessions_2026_02_attribution_source_idx" ON "public"."sessions_2026_02" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_2026_02_device_os_idx" ON "public"."sessions_2026_02" USING "btree" ("device_os") WHERE ("device_os" IS NOT NULL);



CREATE INDEX "sessions_2026_02_device_type_idx" ON "public"."sessions_2026_02" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_2026_02_fingerprint_idx" ON "public"."sessions_2026_02" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_02_gclid_idx" ON "public"."sessions_2026_02" USING "btree" ("gclid");



CREATE INDEX "sessions_2026_02_matchtype_idx" ON "public"."sessions_2026_02" USING "btree" ("matchtype") WHERE ("matchtype" IS NOT NULL);



CREATE INDEX "sessions_2026_02_site_id_created_at_idx" ON "public"."sessions_2026_02" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_2026_02_site_id_created_month_created_at_idx" ON "public"."sessions_2026_02" USING "btree" ("site_id", "created_month", "created_at");



CREATE INDEX "sessions_2026_02_site_id_created_month_idx" ON "public"."sessions_2026_02" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_2026_02_site_id_fingerprint_idx" ON "public"."sessions_2026_02" USING "btree" ("site_id", "fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_02_utm_adgroup_idx" ON "public"."sessions_2026_02" USING "btree" ("utm_adgroup") WHERE ("utm_adgroup" IS NOT NULL);



CREATE INDEX "sessions_2026_02_utm_campaign_idx" ON "public"."sessions_2026_02" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "sessions_2026_02_utm_source_idx" ON "public"."sessions_2026_02" USING "btree" ("utm_source") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "sessions_2026_02_utm_term_idx" ON "public"."sessions_2026_02" USING "btree" ("utm_term") WHERE ("utm_term" IS NOT NULL);



CREATE INDEX "sessions_2026_02_wbraid_idx" ON "public"."sessions_2026_02" USING "btree" ("wbraid");



CREATE INDEX "sessions_2026_03_ads_network_idx" ON "public"."sessions_2026_03" USING "btree" ("ads_network") WHERE ("ads_network" IS NOT NULL);



CREATE INDEX "sessions_2026_03_attribution_source_idx" ON "public"."sessions_2026_03" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_2026_03_created_month_idx" ON "public"."sessions_2026_03" USING "btree" ("created_month");



CREATE INDEX "sessions_2026_03_device_os_idx" ON "public"."sessions_2026_03" USING "btree" ("device_os") WHERE ("device_os" IS NOT NULL);



CREATE INDEX "sessions_2026_03_device_type_idx" ON "public"."sessions_2026_03" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_2026_03_fingerprint_idx" ON "public"."sessions_2026_03" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_03_fingerprint_idx1" ON "public"."sessions_2026_03" USING "btree" ("fingerprint");



CREATE INDEX "sessions_2026_03_gclid_idx" ON "public"."sessions_2026_03" USING "btree" ("gclid");



CREATE INDEX "sessions_2026_03_id_idx" ON "public"."sessions_2026_03" USING "btree" ("id");



CREATE INDEX "sessions_2026_03_matchtype_idx" ON "public"."sessions_2026_03" USING "btree" ("matchtype") WHERE ("matchtype" IS NOT NULL);



CREATE INDEX "sessions_2026_03_site_id_created_at_idx" ON "public"."sessions_2026_03" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_2026_03_site_id_created_month_created_at_idx" ON "public"."sessions_2026_03" USING "btree" ("site_id", "created_month", "created_at");



CREATE INDEX "sessions_2026_03_site_id_created_month_idx" ON "public"."sessions_2026_03" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_2026_03_site_id_fingerprint_idx" ON "public"."sessions_2026_03" USING "btree" ("site_id", "fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_03_site_id_idx" ON "public"."sessions_2026_03" USING "btree" ("site_id");



CREATE INDEX "sessions_2026_03_site_id_idx1" ON "public"."sessions_2026_03" USING "btree" ("site_id");



CREATE INDEX "sessions_2026_03_site_id_idx2" ON "public"."sessions_2026_03" USING "btree" ("site_id");



CREATE INDEX "sessions_2026_03_utm_adgroup_idx" ON "public"."sessions_2026_03" USING "btree" ("utm_adgroup") WHERE ("utm_adgroup" IS NOT NULL);



CREATE INDEX "sessions_2026_03_utm_campaign_idx" ON "public"."sessions_2026_03" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "sessions_2026_03_utm_source_idx" ON "public"."sessions_2026_03" USING "btree" ("utm_source") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "sessions_2026_03_utm_term_idx" ON "public"."sessions_2026_03" USING "btree" ("utm_term") WHERE ("utm_term" IS NOT NULL);



CREATE INDEX "sessions_2026_03_wbraid_idx" ON "public"."sessions_2026_03" USING "btree" ("wbraid");



CREATE INDEX "sessions_default_ads_network_idx" ON "public"."sessions_default" USING "btree" ("ads_network") WHERE ("ads_network" IS NOT NULL);



CREATE INDEX "sessions_default_attribution_source_idx" ON "public"."sessions_default" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_default_device_os_idx" ON "public"."sessions_default" USING "btree" ("device_os") WHERE ("device_os" IS NOT NULL);



CREATE INDEX "sessions_default_device_type_idx" ON "public"."sessions_default" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_default_fingerprint_idx" ON "public"."sessions_default" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_default_gclid_idx" ON "public"."sessions_default" USING "btree" ("gclid");



CREATE INDEX "sessions_default_id_idx" ON "public"."sessions_default" USING "btree" ("id");



CREATE INDEX "sessions_default_id_idx1" ON "public"."sessions_default" USING "btree" ("id");



CREATE INDEX "sessions_default_id_idx2" ON "public"."sessions_default" USING "btree" ("id");



CREATE INDEX "sessions_default_matchtype_idx" ON "public"."sessions_default" USING "btree" ("matchtype") WHERE ("matchtype" IS NOT NULL);



CREATE INDEX "sessions_default_site_id_created_at_idx" ON "public"."sessions_default" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_default_site_id_created_month_created_at_idx" ON "public"."sessions_default" USING "btree" ("site_id", "created_month", "created_at");



CREATE INDEX "sessions_default_site_id_created_month_idx" ON "public"."sessions_default" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_default_site_id_fingerprint_idx" ON "public"."sessions_default" USING "btree" ("site_id", "fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_default_site_id_idx" ON "public"."sessions_default" USING "btree" ("site_id");



CREATE INDEX "sessions_default_utm_adgroup_idx" ON "public"."sessions_default" USING "btree" ("utm_adgroup") WHERE ("utm_adgroup" IS NOT NULL);



CREATE INDEX "sessions_default_utm_campaign_idx" ON "public"."sessions_default" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "sessions_default_utm_source_idx" ON "public"."sessions_default" USING "btree" ("utm_source") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "sessions_default_utm_term_idx" ON "public"."sessions_default" USING "btree" ("utm_term") WHERE ("utm_term" IS NOT NULL);



CREATE INDEX "sessions_default_wbraid_idx" ON "public"."sessions_default" USING "btree" ("wbraid");



CREATE UNIQUE INDEX "ux_conversions_intent_id" ON "public"."conversions" USING "btree" ("intent_id") WHERE ("intent_id" IS NOT NULL);



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_2026_01_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_2026_01_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_2026_01_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_2026_01_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_2026_01_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_2026_01_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_2026_01_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_session_month_date" ATTACH PARTITION "public"."events_2026_01_session_id_session_month_created_at_idx";



ALTER INDEX "public"."idx_events_month_category" ATTACH PARTITION "public"."events_2026_01_session_month_event_category_idx";



ALTER INDEX "public"."idx_events_ingest_dedup_id" ATTACH PARTITION "public"."events_2026_01_session_month_ingest_dedup_id_idx";



ALTER INDEX "public"."idx_events_site_fingerprint_created" ATTACH PARTITION "public"."events_2026_01_site_id_expr_created_at_idx";



ALTER INDEX "public"."idx_events_site_id" ATTACH PARTITION "public"."events_2026_01_site_id_idx";



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_2026_02_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_2026_02_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_2026_02_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_2026_02_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_2026_02_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_2026_02_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_2026_02_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_session_month_date" ATTACH PARTITION "public"."events_2026_02_session_id_session_month_created_at_idx";



ALTER INDEX "public"."idx_events_month_category" ATTACH PARTITION "public"."events_2026_02_session_month_event_category_idx";



ALTER INDEX "public"."idx_events_ingest_dedup_id" ATTACH PARTITION "public"."events_2026_02_session_month_ingest_dedup_id_idx";



ALTER INDEX "public"."idx_events_site_fingerprint_created" ATTACH PARTITION "public"."events_2026_02_site_id_expr_created_at_idx";



ALTER INDEX "public"."idx_events_site_id" ATTACH PARTITION "public"."events_2026_02_site_id_idx";



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_2026_03_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_2026_03_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_2026_03_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_2026_03_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_2026_03_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_2026_03_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_2026_03_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_session_month_date" ATTACH PARTITION "public"."events_2026_03_session_id_session_month_created_at_idx";



ALTER INDEX "public"."idx_events_month_category" ATTACH PARTITION "public"."events_2026_03_session_month_event_category_idx";



ALTER INDEX "public"."idx_events_ingest_dedup_id" ATTACH PARTITION "public"."events_2026_03_session_month_ingest_dedup_id_idx";



ALTER INDEX "public"."idx_events_site_fingerprint_created" ATTACH PARTITION "public"."events_2026_03_site_id_expr_created_at_idx";



ALTER INDEX "public"."idx_events_site_id" ATTACH PARTITION "public"."events_2026_03_site_id_idx";



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_default_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_default_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_default_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_default_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_default_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_default_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_default_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_session_month_date" ATTACH PARTITION "public"."events_default_session_id_session_month_created_at_idx";



ALTER INDEX "public"."idx_events_month_category" ATTACH PARTITION "public"."events_default_session_month_event_category_idx";



ALTER INDEX "public"."idx_events_ingest_dedup_id" ATTACH PARTITION "public"."events_default_session_month_ingest_dedup_id_idx";



ALTER INDEX "public"."idx_events_site_fingerprint_created" ATTACH PARTITION "public"."events_default_site_id_expr_created_at_idx";



ALTER INDEX "public"."idx_events_site_id" ATTACH PARTITION "public"."events_default_site_id_idx";



ALTER INDEX "public"."idx_sessions_ads_network" ATTACH PARTITION "public"."sessions_2026_01_ads_network_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_2026_01_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_os" ATTACH PARTITION "public"."sessions_2026_01_device_os_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_2026_01_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_2026_01_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_2026_01_gclid_idx";



ALTER INDEX "public"."idx_sessions_matchtype" ATTACH PARTITION "public"."sessions_2026_01_matchtype_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_2026_01_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_2026_01_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month_date" ATTACH PARTITION "public"."sessions_2026_01_site_id_created_month_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_2026_01_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_site_fingerprint" ATTACH PARTITION "public"."sessions_2026_01_site_id_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_utm_adgroup" ATTACH PARTITION "public"."sessions_2026_01_utm_adgroup_idx";



ALTER INDEX "public"."idx_sessions_utm_campaign" ATTACH PARTITION "public"."sessions_2026_01_utm_campaign_idx";



ALTER INDEX "public"."idx_sessions_utm_source" ATTACH PARTITION "public"."sessions_2026_01_utm_source_idx";



ALTER INDEX "public"."idx_sessions_utm_term" ATTACH PARTITION "public"."sessions_2026_01_utm_term_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_2026_01_wbraid_idx";



ALTER INDEX "public"."idx_sessions_ads_network" ATTACH PARTITION "public"."sessions_2026_02_ads_network_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_2026_02_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_os" ATTACH PARTITION "public"."sessions_2026_02_device_os_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_2026_02_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_2026_02_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_2026_02_gclid_idx";



ALTER INDEX "public"."idx_sessions_matchtype" ATTACH PARTITION "public"."sessions_2026_02_matchtype_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_2026_02_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_2026_02_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month_date" ATTACH PARTITION "public"."sessions_2026_02_site_id_created_month_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_2026_02_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_site_fingerprint" ATTACH PARTITION "public"."sessions_2026_02_site_id_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_utm_adgroup" ATTACH PARTITION "public"."sessions_2026_02_utm_adgroup_idx";



ALTER INDEX "public"."idx_sessions_utm_campaign" ATTACH PARTITION "public"."sessions_2026_02_utm_campaign_idx";



ALTER INDEX "public"."idx_sessions_utm_source" ATTACH PARTITION "public"."sessions_2026_02_utm_source_idx";



ALTER INDEX "public"."idx_sessions_utm_term" ATTACH PARTITION "public"."sessions_2026_02_utm_term_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_2026_02_wbraid_idx";



ALTER INDEX "public"."idx_sessions_ads_network" ATTACH PARTITION "public"."sessions_2026_03_ads_network_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_2026_03_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_os" ATTACH PARTITION "public"."sessions_2026_03_device_os_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_2026_03_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_2026_03_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_2026_03_gclid_idx";



ALTER INDEX "public"."idx_sessions_matchtype" ATTACH PARTITION "public"."sessions_2026_03_matchtype_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_2026_03_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_2026_03_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month_date" ATTACH PARTITION "public"."sessions_2026_03_site_id_created_month_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_2026_03_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_site_fingerprint" ATTACH PARTITION "public"."sessions_2026_03_site_id_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_utm_adgroup" ATTACH PARTITION "public"."sessions_2026_03_utm_adgroup_idx";



ALTER INDEX "public"."idx_sessions_utm_campaign" ATTACH PARTITION "public"."sessions_2026_03_utm_campaign_idx";



ALTER INDEX "public"."idx_sessions_utm_source" ATTACH PARTITION "public"."sessions_2026_03_utm_source_idx";



ALTER INDEX "public"."idx_sessions_utm_term" ATTACH PARTITION "public"."sessions_2026_03_utm_term_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_2026_03_wbraid_idx";



ALTER INDEX "public"."idx_sessions_ads_network" ATTACH PARTITION "public"."sessions_default_ads_network_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_default_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_os" ATTACH PARTITION "public"."sessions_default_device_os_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_default_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_default_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_default_gclid_idx";



ALTER INDEX "public"."idx_sessions_matchtype" ATTACH PARTITION "public"."sessions_default_matchtype_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_default_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_default_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month_date" ATTACH PARTITION "public"."sessions_default_site_id_created_month_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_default_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_site_fingerprint" ATTACH PARTITION "public"."sessions_default_site_id_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_utm_adgroup" ATTACH PARTITION "public"."sessions_default_utm_adgroup_idx";



ALTER INDEX "public"."idx_sessions_utm_campaign" ATTACH PARTITION "public"."sessions_default_utm_campaign_idx";



ALTER INDEX "public"."idx_sessions_utm_source" ATTACH PARTITION "public"."sessions_default_utm_source_idx";



ALTER INDEX "public"."idx_sessions_utm_term" ATTACH PARTITION "public"."sessions_default_utm_term_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_default_wbraid_idx";



CREATE OR REPLACE TRIGGER "audit_conversations" AFTER DELETE OR UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."audit_table_change"();



CREATE OR REPLACE TRIGGER "audit_provider_credentials" AFTER DELETE OR UPDATE ON "public"."provider_credentials" FOR EACH ROW EXECUTE FUNCTION "public"."audit_table_change"();



CREATE OR REPLACE TRIGGER "audit_sales" AFTER DELETE OR UPDATE ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."audit_table_change"();



CREATE OR REPLACE TRIGGER "audit_site_members" AFTER DELETE OR UPDATE ON "public"."site_members" FOR EACH ROW EXECUTE FUNCTION "public"."audit_table_change"();



CREATE OR REPLACE TRIGGER "audit_site_plans" AFTER DELETE OR UPDATE ON "public"."site_plans" FOR EACH ROW EXECUTE FUNCTION "public"."audit_table_change"();



CREATE OR REPLACE TRIGGER "calls_enforce_session_created_month" BEFORE INSERT OR UPDATE OF "matched_session_id", "matched_at", "session_created_month" ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."trg_calls_enforce_session_created_month"();



CREATE OR REPLACE TRIGGER "calls_enforce_update_columns" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."calls_enforce_update_columns"();



CREATE OR REPLACE TRIGGER "calls_notify_hunter_ai" AFTER INSERT ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_calls_notify_hunter_ai"();



COMMENT ON TRIGGER "calls_notify_hunter_ai" ON "public"."calls" IS 'POST new high-intent call (source=click, intent_action in phone/whatsapp) to hunter-ai Edge Function.';



CREATE OR REPLACE TRIGGER "calls_set_updated_at" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."calls_updated_at_trigger"();



CREATE OR REPLACE TRIGGER "conversation_links_entity_site_trigger" BEFORE INSERT OR UPDATE OF "conversation_id", "entity_type", "entity_id" ON "public"."conversation_links" FOR EACH ROW EXECUTE FUNCTION "public"."conversation_links_entity_site_check"();



CREATE OR REPLACE TRIGGER "conversations_primary_entity_site_trigger" BEFORE INSERT OR UPDATE OF "site_id", "primary_call_id", "primary_session_id" ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."conversations_primary_entity_site_check"();



CREATE OR REPLACE TRIGGER "conversations_set_updated_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "conversions_set_updated_at" BEFORE UPDATE ON "public"."conversions" FOR EACH ROW EXECUTE FUNCTION "public"."_conversions_set_updated_at"();



CREATE OR REPLACE TRIGGER "enforce_append_only_signals" BEFORE DELETE OR UPDATE ON "public"."marketing_signals" FOR EACH ROW EXECUTE FUNCTION "public"."_marketing_signals_append_only"();



CREATE OR REPLACE TRIGGER "events_set_session_month_from_session" BEFORE INSERT OR UPDATE OF "session_id", "session_month", "site_id" ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."trg_events_set_session_month_from_session"();



CREATE OR REPLACE TRIGGER "invoice_snapshot_no_delete" BEFORE DELETE ON "public"."invoice_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."invoice_snapshot_immutable"();



CREATE OR REPLACE TRIGGER "invoice_snapshot_no_update" BEFORE UPDATE ON "public"."invoice_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."invoice_snapshot_immutable"();



CREATE OR REPLACE TRIGGER "offline_conversion_queue_set_updated_at" BEFORE UPDATE ON "public"."offline_conversion_queue" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "provider_dispatches_no_delete" BEFORE DELETE ON "public"."provider_dispatches" FOR EACH ROW EXECUTE FUNCTION "public"."_provider_dispatches_no_delete"();



CREATE OR REPLACE TRIGGER "provider_dispatches_set_updated_at" BEFORE UPDATE ON "public"."provider_dispatches" FOR EACH ROW EXECUTE FUNCTION "public"."_provider_dispatches_set_updated_at"();



CREATE OR REPLACE TRIGGER "revenue_snapshots_immutable" BEFORE DELETE OR UPDATE ON "public"."revenue_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."_revenue_snapshots_immutable"();



CREATE OR REPLACE TRIGGER "sales_conversation_site_trigger" BEFORE INSERT OR UPDATE OF "site_id", "conversation_id" ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."sales_conversation_site_check"();



CREATE OR REPLACE TRIGGER "sales_finalized_identity_immutable_trigger" BEFORE UPDATE OF "site_id", "occurred_at", "amount_cents", "currency", "external_ref", "customer_hash" ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."sales_finalized_identity_immutable_check"();



CREATE OR REPLACE TRIGGER "sales_set_updated_at" BEFORE UPDATE ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sessions_set_created_month" BEFORE INSERT OR UPDATE OF "created_at", "created_month" ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sessions_set_created_month"();



CREATE OR REPLACE TRIGGER "site_plans_updated_at" BEFORE UPDATE ON "public"."site_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sites_before_insert_identity_trigger" BEFORE INSERT ON "public"."sites" FOR EACH ROW EXECUTE FUNCTION "public"."sites_before_insert_identity"();



CREATE OR REPLACE TRIGGER "trg_assign_offline_conversion_queue_external_id" BEFORE INSERT OR UPDATE OF "provider_key", "action", "sale_id", "call_id", "session_id" ON "public"."offline_conversion_queue" FOR EACH ROW EXECUTE FUNCTION "public"."assign_offline_conversion_queue_external_id"();



CREATE OR REPLACE TRIGGER "trg_calls_last_status_change" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_last_status_change_at"();



CREATE OR REPLACE TRIGGER "trg_calls_standard_expiration" BEFORE INSERT ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_standard_expires_at"();



CREATE OR REPLACE TRIGGER "trg_calls_version_increment" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."fn_increment_calls_version"();



CREATE OR REPLACE TRIGGER "trg_check_caller_phone_update" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."check_caller_phone_update"();



CREATE OR REPLACE TRIGGER "trg_marketing_signals_bitemporal" BEFORE UPDATE ON "public"."marketing_signals" FOR EACH ROW WHEN ((("old"."conversion_value" IS DISTINCT FROM "new"."conversion_value") OR ("old"."expected_value_cents" IS DISTINCT FROM "new"."expected_value_cents") OR ("old"."dispatch_status" IS DISTINCT FROM "new"."dispatch_status"))) EXECUTE FUNCTION "public"."marketing_signals_bitemporal_audit"();



CREATE OR REPLACE TRIGGER "trg_marketing_signals_state_machine" BEFORE UPDATE ON "public"."marketing_signals" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_marketing_signals_state_machine"();



CREATE OR REPLACE TRIGGER "trg_oci_queue_transitions_snapshot" AFTER INSERT ON "public"."oci_queue_transitions" FOR EACH ROW EXECUTE FUNCTION "public"."apply_oci_queue_transition_snapshot"();



CREATE OR REPLACE TRIGGER "trg_offline_conversion_queue_state_machine" BEFORE UPDATE ON "public"."offline_conversion_queue" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_offline_conversion_queue_state_machine"();



CREATE OR REPLACE TRIGGER "trg_void_pending_oci_queue_on_call_reversal" AFTER UPDATE OF "status" ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."void_pending_oci_queue_on_call_reversal"();



ALTER TABLE ONLY "private"."site_secrets"
    ADD CONSTRAINT "site_secrets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ad_spend_daily"
    ADD CONSTRAINT "ad_spend_daily_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_reconciliation_jobs"
    ADD CONSTRAINT "billing_reconciliation_jobs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_actions"
    ADD CONSTRAINT "call_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."call_actions"
    ADD CONSTRAINT "call_actions_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_actions"
    ADD CONSTRAINT "call_actions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_scores"
    ADD CONSTRAINT "call_scores_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_scores"
    ADD CONSTRAINT "call_scores_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."causal_dna_ledger_failures"
    ADD CONSTRAINT "causal_dna_ledger_failures_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."causal_dna_ledger"
    ADD CONSTRAINT "causal_dna_ledger_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_links"
    ADD CONSTRAINT "conversation_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_invite_audit"
    ADD CONSTRAINT "customer_invite_audit_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_invite_audit"
    ADD CONSTRAINT "customer_invite_audit_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE "public"."events"
    ADD CONSTRAINT "events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE "public"."events"
    ADD CONSTRAINT "fk_events_session" FOREIGN KEY ("session_id", "session_month") REFERENCES "public"."sessions"("id", "created_month") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."gdpr_consents"
    ADD CONSTRAINT "gdpr_consents_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gdpr_erase_requests"
    ADD CONSTRAINT "gdpr_erase_requests_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingest_fallback_buffer"
    ADD CONSTRAINT "ingest_fallback_buffer_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingest_fraud_quarantine"
    ADD CONSTRAINT "ingest_fraud_quarantine_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingest_idempotency"
    ADD CONSTRAINT "ingest_idempotency_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_snapshot"
    ADD CONSTRAINT "invoice_snapshot_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketing_signals"
    ADD CONSTRAINT "marketing_signals_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."marketing_signals"
    ADD CONSTRAINT "marketing_signals_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."oci_queue_transitions"
    ADD CONSTRAINT "oci_queue_transitions_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."offline_conversion_queue"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offline_conversion_queue"
    ADD CONSTRAINT "offline_conversion_queue_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offline_conversion_queue"
    ADD CONSTRAINT "offline_conversion_queue_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offline_conversion_tombstones"
    ADD CONSTRAINT "offline_conversion_tombstones_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outbox_events"
    ADD CONSTRAINT "outbox_events_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outbox_events"
    ADD CONSTRAINT "outbox_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."processed_signals"
    ADD CONSTRAINT "processed_signals_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_credentials"
    ADD CONSTRAINT "provider_credentials_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_dispatches"
    ADD CONSTRAINT "provider_dispatches_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."revenue_snapshots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."provider_health_state"
    ADD CONSTRAINT "provider_health_state_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_upload_attempts"
    ADD CONSTRAINT "provider_upload_attempts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_upload_metrics"
    ADD CONSTRAINT "provider_upload_metrics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."revenue_snapshots"
    ADD CONSTRAINT "revenue_snapshots_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."revenue_snapshots"
    ADD CONSTRAINT "revenue_snapshots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE "public"."sessions"
    ADD CONSTRAINT "sessions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shadow_decisions"
    ADD CONSTRAINT "shadow_decisions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_plans"
    ADD CONSTRAINT "site_plans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_usage_monthly"
    ADD CONSTRAINT "site_usage_monthly_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_dlq_replay_audit"
    ADD CONSTRAINT "sync_dlq_replay_audit_dlq_id_fkey" FOREIGN KEY ("dlq_id") REFERENCES "public"."sync_dlq"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_dlq"
    ADD CONSTRAINT "sync_dlq_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usage_counters"
    ADD CONSTRAINT "usage_counters_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_credentials"
    ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Geo targets: authenticated can read" ON "public"."google_geo_targets" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Geo targets: no write for authenticated" ON "public"."google_geo_targets" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "Geo targets: service_role full access" ON "public"."google_geo_targets" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Kullan─▒c─▒lar sadece kendi anahtarlar─▒n─▒ g├Ârebilir" ON "public"."user_credentials" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Public View" ON "public"."events_default" FOR SELECT USING (true);



CREATE POLICY "Site owners and operators can update sites" ON "public"."sites" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."site_id" = "sites"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"()))) WITH CHECK ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."site_id" = "sites"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"())));



COMMENT ON POLICY "Site owners and operators can update sites" ON "public"."sites" IS 'RBAC v2: Only site owner, admin/operator member, or platform admin can UPDATE sites.';



CREATE POLICY "Site owners and site admins can manage members" ON "public"."site_members" USING ((("user_id" = "auth"."uid"()) OR "public"."can_manage_site_members"("site_id"))) WITH CHECK ("public"."can_manage_site_members"("site_id"));



COMMENT ON POLICY "Site owners and site admins can manage members" ON "public"."site_members" IS 'RBAC v2: See own row or manage via can_manage_site_members() (no RLS recursion).';



CREATE POLICY "Strict View for Owner" ON "public"."events_2026_01" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."sites" "st" ON (("s"."site_id" = "st"."id")))
  WHERE (("s"."id" = "events_2026_01"."session_id") AND ("st"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."ad_spend_daily" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ad_spend_daily_select_via_site" ON "public"."ad_spend_daily" FOR SELECT TO "authenticated" USING ("public"."can_access_site"("auth"."uid"(), "site_id"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_select_service_role" ON "public"."audit_log" FOR SELECT TO "service_role" USING (true);



ALTER TABLE "public"."billing_compensation_failures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_reconciliation_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_reconciliation_jobs_select_site_members" ON "public"."billing_reconciliation_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "billing_reconciliation_jobs"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."call_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_actions_insert_owner_operator_admin" ON "public"."call_actions" FOR INSERT WITH CHECK (((( SELECT "s"."user_id"
   FROM "public"."sites" "s"
  WHERE ("s"."id" = "call_actions"."site_id")
 LIMIT 1) = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."user_id" = "auth"."uid"()) AND ("sm"."site_id" = "call_actions"."site_id") AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"())));



COMMENT ON POLICY "call_actions_insert_owner_operator_admin" ON "public"."call_actions" IS 'RBAC v2: Only owner/admin/operator member or platform admin can INSERT call_actions (analyst/billing cannot).';



CREATE POLICY "call_actions_select_accessible" ON "public"."call_actions" FOR SELECT USING (((( SELECT "s"."user_id"
   FROM "public"."sites" "s"
  WHERE ("s"."id" = "call_actions"."site_id")
 LIMIT 1) = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."site_id" = "call_actions"."site_id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."call_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_scores_select_via_site" ON "public"."call_scores" FOR SELECT TO "authenticated" USING ("public"."can_access_site"("auth"."uid"(), "site_id"));



ALTER TABLE "public"."calls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calls_delete_owner_operator_admin" ON "public"."calls" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "calls"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"()))))));



COMMENT ON POLICY "calls_delete_owner_operator_admin" ON "public"."calls" IS 'RBAC v2: Only owner/admin/operator member or platform admin can DELETE calls.';



CREATE POLICY "calls_insert_owner_operator_admin" ON "public"."calls" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "calls"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"()))))));



COMMENT ON POLICY "calls_insert_owner_operator_admin" ON "public"."calls" IS 'RBAC v2: Only owner/admin/operator member or platform admin can INSERT calls.';



CREATE POLICY "calls_select_accessible" ON "public"."calls" FOR SELECT USING (((( SELECT "s"."user_id"
   FROM "public"."sites" "s"
  WHERE ("s"."id" = "calls"."site_id")
 LIMIT 1) = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."site_id" = "calls"."site_id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"())));



COMMENT ON POLICY "calls_select_accessible" ON "public"."calls" IS 'GO 2.1: Owner, any member (incl viewer), or admin can SELECT calls for their site.';



CREATE POLICY "calls_update_owner_operator_admin" ON "public"."calls" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "calls"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "calls"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = ANY (ARRAY['admin'::"text", 'operator'::"text"]))))) OR "public"."is_admin"("auth"."uid"()))))));



COMMENT ON POLICY "calls_update_owner_operator_admin" ON "public"."calls" IS 'RBAC v2: Only owner/admin/operator member or platform admin can UPDATE calls.';



ALTER TABLE "public"."causal_dna_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."causal_dna_ledger_failures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "causal_dna_ledger_service_role" ON "public"."causal_dna_ledger" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."conversation_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_links_via_conversation" ON "public"."conversation_links" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."sites" "s" ON (("s"."id" = "c"."site_id")))
  WHERE (("c"."id" = "conversation_links"."conversation_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "conversation_links_via_conversation_insert" ON "public"."conversation_links" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."sites" "s" ON (("s"."id" = "c"."site_id")))
  WHERE (("c"."id" = "conversation_links"."conversation_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_site_members" ON "public"."conversations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "conversations"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "conversations_site_members_insert" ON "public"."conversations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "conversations"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "conversations_site_members_update" ON "public"."conversations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "conversations"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."conversions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversions_service_role_all" ON "public"."conversions" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."customer_invite_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_2026_01" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_2026_02" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_2026_03" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_default" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_select_accessible" ON "public"."events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sessions" "sess"
     JOIN "public"."sites" "s" ON (("s"."id" = "sess"."site_id")))
  WHERE (("sess"."id" = "events"."session_id") AND ("sess"."created_month" = "events"."session_month") AND (("s"."user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("s"."id"))))));



CREATE POLICY "events_tenant_isolation_iron_dome" ON "public"."events" USING (("session_id" IN ( SELECT "s"."id"
   FROM "public"."sessions" "s"
  WHERE (("s"."site_id" IN ( SELECT "sites"."id"
           FROM "public"."sites"
          WHERE (("sites"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
                   FROM "public"."site_members"
                  WHERE (("site_members"."site_id" = "sites"."id") AND ("site_members"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
                   FROM "public"."profiles"
                  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))))) AND ("s"."created_month" = "events"."session_month"))))) WITH CHECK (("session_id" IN ( SELECT "s"."id"
   FROM "public"."sessions" "s"
  WHERE (("s"."site_id" IN ( SELECT "sites"."id"
           FROM "public"."sites"
          WHERE (("sites"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
                   FROM "public"."site_members"
                  WHERE (("site_members"."site_id" = "sites"."id") AND ("site_members"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
                   FROM "public"."profiles"
                  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))))) AND ("s"."created_month" = "events"."session_month")))));



COMMENT ON POLICY "events_tenant_isolation_iron_dome" ON "public"."events" IS 'Iron Dome Layer 1: Events isolated via session site_id validation (defense in depth)';



ALTER TABLE "public"."gdpr_consents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gdpr_erase_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_geo_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingest_fallback_buffer" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingest_fraud_quarantine" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingest_idempotency" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ingest_idempotency_select_site_members" ON "public"."ingest_idempotency" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "ingest_idempotency"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



COMMENT ON POLICY "ingest_idempotency_select_site_members" ON "public"."ingest_idempotency" IS 'Revenue Kernel: site members can read for dispute export. No INSERT/UPDATE/DELETE for authenticated; only service_role.';



ALTER TABLE "public"."ingest_publish_failures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_snapshot" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_snapshot_select_site_members" ON "public"."invoice_snapshot" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "invoice_snapshot"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."marketing_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketing_signals_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marketing_signals_service_role" ON "public"."marketing_signals" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."oci_payload_validation_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oci_queue_transitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offline_conversion_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "offline_conversion_queue_select_admin" ON "public"."offline_conversion_queue" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."offline_conversion_tombstones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."outbox_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "outbox_events_service_role_only" ON "public"."outbox_events" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."processed_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."provider_credentials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provider_credentials_insert_policy" ON "public"."provider_credentials" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_access_site"("auth"."uid"(), "site_id"));



CREATE POLICY "provider_credentials_select_policy" ON "public"."provider_credentials" FOR SELECT TO "authenticated" USING ("public"."can_access_site"("auth"."uid"(), "site_id"));



CREATE POLICY "provider_credentials_update_policy" ON "public"."provider_credentials" FOR UPDATE TO "authenticated" USING ("public"."can_access_site"("auth"."uid"(), "site_id")) WITH CHECK ("public"."can_access_site"("auth"."uid"(), "site_id"));



ALTER TABLE "public"."provider_dispatches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provider_dispatches_service_role" ON "public"."provider_dispatches" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."provider_health_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_upload_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_upload_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."revenue_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "revenue_snapshots_service_role" ON "public"."revenue_snapshots" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_site_members" ON "public"."sales" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "sales"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "sales_site_members_insert" ON "public"."sales" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "sales"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "sales_site_members_update" ON "public"."sales" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "sales"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_2026_01" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_2026_02" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_2026_03" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_default" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions_select_accessible" ON "public"."sessions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "sessions"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("s"."id"))))));



CREATE POLICY "sessions_tenant_isolation_iron_dome" ON "public"."sessions" USING (("site_id" IN ( SELECT "sites"."id"
   FROM "public"."sites"
  WHERE (("sites"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members"
          WHERE (("site_members"."site_id" = "sites"."id") AND ("site_members"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))))))) WITH CHECK (("site_id" IN ( SELECT "sites"."id"
   FROM "public"."sites"
  WHERE (("sites"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members"
          WHERE (("site_members"."site_id" = "sites"."id") AND ("site_members"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))))));



COMMENT ON POLICY "sessions_tenant_isolation_iron_dome" ON "public"."sessions" IS 'Iron Dome Layer 1: Explicit site_id validation for tenant isolation (defense in depth)';



ALTER TABLE "public"."shadow_decisions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shadow_decisions_service_role" ON "public"."shadow_decisions" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."signal_entropy_by_fingerprint" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signal_entropy_service_role" ON "public"."signal_entropy_by_fingerprint" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."site_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_members_select_accessible" ON "public"."site_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("site_id")));



ALTER TABLE "public"."site_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_plans_delete_admin" ON "public"."site_plans" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "site_plans"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = 'admin'::"text")))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "site_plans_insert_update_delete_admin" ON "public"."site_plans" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "site_plans"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = 'admin'::"text")))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "site_plans_select_site_members" ON "public"."site_plans" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "site_plans"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "site_plans_update_admin" ON "public"."site_plans" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "site_plans"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = 'admin'::"text")))) OR "public"."is_admin"("auth"."uid"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "site_plans"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."role" = 'admin'::"text")))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."site_usage_monthly" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_usage_monthly_select_site_members" ON "public"."site_usage_monthly" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "site_usage_monthly"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



ALTER TABLE "public"."sites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sites_delete_owner" ON "public"."sites" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "sites_insert_owner" ON "public"."sites" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "sites_select_accessible" ON "public"."sites" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."site_id" = "sites"."id") AND ("sm"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_insert_update_service_role" ON "public"."subscriptions" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "subscriptions_select_site_members" ON "public"."subscriptions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "subscriptions"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "subscriptions_update_service_role" ON "public"."subscriptions" FOR UPDATE USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."sync_dlq" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_dlq_replay_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_integrity_merkle" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_integrity_merkle_service_role" ON "public"."system_integrity_merkle" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."usage_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usage_counters_insert_update_service_role" ON "public"."usage_counters" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "usage_counters_select_site_members" ON "public"."usage_counters" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "usage_counters"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."site_members" "sm"
          WHERE (("sm"."site_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"())))) OR "public"."is_admin"("auth"."uid"()))))));



CREATE POLICY "usage_counters_update_service_role" ON "public"."usage_counters" FOR UPDATE USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."user_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watchtower_checks" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."calls";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."events_2026_01";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."events_2026_02";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."events_default";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions_2026_01";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions_2026_02";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions_default";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sites";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_credentials";









REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






































































































































































































































































































































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "private"."get_site_secrets"("p_site_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."get_site_secrets"("p_site_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."set_site_secrets_v1"("p_site_id" "uuid", "p_current_secret" "text", "p_next_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."set_site_secrets_v1"("p_site_id" "uuid", "p_current_secret" "text", "p_next_secret" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_conversions_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."_conversions_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_conversions_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_entitlements_for_tier"("p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_entitlements_for_tier"("p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_entitlements_for_tier"("p_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_entitlements_no_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."_entitlements_no_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_entitlements_no_access"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_jwt_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."_jwt_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_jwt_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_marketing_signals_append_only"() TO "anon";
GRANT ALL ON FUNCTION "public"."_marketing_signals_append_only"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_marketing_signals_append_only"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_provider_dispatches_no_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."_provider_dispatches_no_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_provider_dispatches_no_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_provider_dispatches_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."_provider_dispatches_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_provider_dispatches_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_revenue_snapshots_immutable"() TO "anon";
GRANT ALL ON FUNCTION "public"."_revenue_snapshots_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_revenue_snapshots_immutable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_pipeline_gate_checks"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_pipeline_gate_checks"() TO "anon";
GRANT ALL ON FUNCTION "public"."ai_pipeline_gate_checks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_pipeline_gate_checks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."analyze_gumus_alanlar_funnel"("target_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."analyze_gumus_alanlar_funnel"("target_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."analyze_gumus_alanlar_funnel"("target_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."anonymize_consent_less_data"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."anonymize_consent_less_data"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."anonymize_consent_less_data"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."append_causal_dna_ledger"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_causal_dna" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."append_causal_dna_ledger"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_causal_dna" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_causal_dna_ledger"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_causal_dna" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."append_manual_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."append_manual_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_manual_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."append_rpc_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."append_rpc_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_rpc_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."append_script_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."append_script_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_script_claim_transition_batch"("p_queue_ids" "uuid"[], "p_claimed_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."append_script_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."append_script_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_script_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."append_sweeper_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."append_sweeper_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_sweeper_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."append_worker_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text", "p_error_code" "text", "p_error_category" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."append_worker_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text", "p_error_code" "text", "p_error_category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_worker_transition_batch"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_last_error" "text", "p_error_code" "text", "p_error_category" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."append_worker_transition_batch_v2"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."append_worker_transition_batch_v2"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_worker_transition_batch_v2"("p_queue_ids" "uuid"[], "p_new_status" "text", "p_created_at" timestamp with time zone, "p_error_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb", "p_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb", "p_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb", "p_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_call_action_v1"("p_call_id" "uuid", "p_action_type" "text", "p_payload" "jsonb", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb", "p_version" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_oci_queue_transition_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_oci_queue_transition_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_oci_queue_transition_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_snapshot_batch"("p_queue_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."apply_snapshot_batch"("p_queue_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_snapshot_batch"("p_queue_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."archive_failed_conversions_batch"("p_days_old" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."archive_failed_conversions_batch"("p_days_old" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_failed_conversions_batch"("p_days_old" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_latest_ledger_matches_snapshot"("p_queue_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."assert_latest_ledger_matches_snapshot"("p_queue_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_latest_ledger_matches_snapshot"("p_queue_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_offline_conversion_queue_external_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_offline_conversion_queue_external_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_offline_conversion_queue_external_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_table_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_table_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_table_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_approve_stale_intents_v1"("p_site_id" "uuid", "p_min_age_hours" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."backfill_one_session_utm_from_entry_page"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_one_session_utm_from_entry_page"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_one_session_utm_from_entry_page"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."backfill_one_session_utm_from_events"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_one_session_utm_from_events"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_one_session_utm_from_events"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calls_enforce_update_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."calls_enforce_update_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calls_enforce_update_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calls_updated_at_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."calls_updated_at_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calls_updated_at_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_site"("p_user_id" "uuid", "p_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_site"("p_user_id" "uuid", "p_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_site"("p_user_id" "uuid", "p_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_site_members"("_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_site_members"("_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_site_members"("_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_caller_phone_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_caller_phone_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_caller_phone_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_site_access"("target_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_site_access"("target_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_site_access"("target_site_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."billing_reconciliation_jobs" TO "anon";
GRANT ALL ON TABLE "public"."billing_reconciliation_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_reconciliation_jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_billing_reconciliation_jobs"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_billing_reconciliation_jobs"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_billing_reconciliation_jobs"("p_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."offline_conversion_queue" TO "anon";
GRANT ALL ON TABLE "public"."offline_conversion_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."offline_conversion_queue" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_limit" integer, "p_provider_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_limit" integer, "p_provider_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_limit" integer, "p_provider_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v2"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v3"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v3"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_jobs_v3"("p_site_id" "uuid", "p_provider_key" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_offline_conversion_rows_for_script_export"("p_ids" "uuid"[], "p_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_rows_for_script_export"("p_ids" "uuid"[], "p_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_offline_conversion_rows_for_script_export"("p_ids" "uuid"[], "p_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_outbox_events"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_outbox_events"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_outbox_events"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_auto_junk_stale_intents"("p_days_old" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_auto_junk_stale_intents"("p_days_old" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_auto_junk_stale_intents"("p_days_old" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_marketing_signals_batch"("p_days_old" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_marketing_signals_batch"("p_days_old" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_marketing_signals_batch"("p_days_old" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_oci_queue_batch"("p_days_to_keep" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_oci_queue_batch"("p_days_to_keep" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_oci_queue_batch"("p_days_to_keep" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."close_stale_uploaded_conversions"("p_min_age_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."close_stale_uploaded_conversions"("p_min_age_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_stale_uploaded_conversions"("p_min_age_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_offline_conversion_external_id"("p_provider_key" "text", "p_action" "text", "p_sale_id" "uuid", "p_call_id" "uuid", "p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_offline_conversion_external_id"("p_provider_key" "text", "p_action" "text", "p_sale_id" "uuid", "p_call_id" "uuid", "p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_offline_conversion_external_id"("p_provider_key" "text", "p_action" "text", "p_sale_id" "uuid", "p_call_id" "uuid", "p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_sale_and_enqueue"("p_sale_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_sale_and_enqueue"("p_sale_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_sale_and_enqueue"("p_sale_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."conversation_links_entity_site_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."conversation_links_entity_site_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."conversation_links_entity_site_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."conversations_primary_entity_site_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."conversations_primary_entity_site_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."conversations_primary_entity_site_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_conversation_with_primary_entity"("p_site_id" "uuid", "p_primary_entity_type" "text", "p_primary_entity_id" "uuid", "p_primary_source" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_conversation_with_primary_entity"("p_site_id" "uuid", "p_primary_entity_type" "text", "p_primary_entity_id" "uuid", "p_primary_source" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_conversation_with_primary_entity"("p_site_id" "uuid", "p_primary_entity_type" "text", "p_primary_entity_id" "uuid", "p_primary_source" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_next_month_partitions"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_next_month_partitions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_next_month_partitions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_usage_compensation"("p_site_id" "uuid", "p_month" "date", "p_kind" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_usage_compensation"("p_site_id" "uuid", "p_month" "date", "p_kind" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_usage_compensation"("p_site_id" "uuid", "p_month" "date", "p_kind" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_expired_idempotency_batch"("p_cutoff_iso" timestamp with time zone, "p_batch_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_marketing_signals_state_machine"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_marketing_signals_state_machine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_marketing_signals_state_machine"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_offline_conversion_queue_state_machine"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_offline_conversion_queue_state_machine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_offline_conversion_queue_state_machine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text", "p_form_summary" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text", "p_form_summary" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text", "p_form_summary" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_session_intent_v1"("p_site_id" "uuid", "p_session_id" "uuid", "p_fingerprint" "text", "p_lead_score" integer, "p_intent_action" "text", "p_intent_target" "text", "p_intent_page_url" "text", "p_click_id" "text", "p_form_state" "text", "p_form_summary" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."erase_pii_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."erase_pii_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."erase_pii_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."export_data_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."export_data_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."export_data_for_identifier"("p_site_id" "uuid", "p_identifier_type" "text", "p_identifier_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_increment_calls_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_increment_calls_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_increment_calls_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_standard_expires_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_standard_expires_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_standard_expires_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_last_status_change_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_last_status_change_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_last_status_change_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer, "p_action_types" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer, "p_action_types" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer, "p_action_types" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_activity_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer, "p_action_types" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_and_claim_fallback_batch"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_and_claim_fallback_batch"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_and_claim_fallback_batch"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_attribution_forensic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_attribution_forensic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_attribution_forensic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_call_session_for_oci"("p_call_id" "uuid", "p_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_call_session_for_oci"("p_call_id" "uuid", "p_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_call_session_for_oci"("p_call_id" "uuid", "p_site_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_command_center_p0_stats_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_command_center_p0_stats_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_command_center_p0_stats_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_command_center_p0_stats_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_customer_invite_audit_v1"("p_site_id" "uuid", "p_limit" integer, "p_offset" integer, "p_email_query" "text", "p_outcome" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_customer_invite_audit_v1"("p_site_id" "uuid", "p_limit" integer, "p_offset" integer, "p_email_query" "text", "p_outcome" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_customer_invite_audit_v1"("p_site_id" "uuid", "p_limit" integer, "p_offset" integer, "p_email_query" "text", "p_outcome" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_invite_audit_v1"("p_site_id" "uuid", "p_limit" integer, "p_offset" integer, "p_email_query" "text", "p_outcome" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text", "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text", "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_dimension" "text", "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown_p4"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown_p4"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown_p4"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text", "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text", "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_intents"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_status" "text", "p_search" "text", "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats_v1"("p_site_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats_v1"("p_site_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats_v1"("p_site_id" "uuid", "p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text", "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text", "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_timeline"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_granularity" "text", "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dic_export_for_call"("p_call_id" "uuid", "p_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_entitlements_for_site"("p_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_entitlements_for_site"("p_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entitlements_for_site"("p_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ingest_publish_failures_last_1h"("p_site_public_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_ingest_publish_failures_last_1h"("p_site_public_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ingest_publish_failures_last_1h"("p_site_public_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_intent_details_v1"("p_site_id" "uuid", "p_call_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_intent_ratio_watchdog"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_intent_ratio_watchdog"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_intent_ratio_watchdog"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_kill_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_kill_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_kill_feed_v1"("p_site_id" "uuid", "p_hours_back" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_marketing_signals_as_of"("p_site_id" "uuid", "p_as_of" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_marketing_signals_as_of"("p_site_id" "uuid", "p_as_of" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_marketing_signals_as_of"("p_site_id" "uuid", "p_as_of" timestamp with time zone) TO "service_role";



GRANT ALL ON TABLE "public"."conversions" TO "anon";
GRANT ALL ON TABLE "public"."conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."conversions" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_conversions_for_worker"("p_batch_size" integer, "p_current_time" timestamp with time zone, "p_worker_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_conversions_for_worker"("p_batch_size" integer, "p_current_time" timestamp with time zone, "p_worker_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_conversions_for_worker"("p_batch_size" integer, "p_current_time" timestamp with time zone, "p_worker_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_provider_health_state"("p_site_id" "uuid", "p_provider_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_provider_health_state"("p_site_id" "uuid", "p_provider_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_provider_health_state"("p_site_id" "uuid", "p_provider_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recent_intents_lite_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_minutes_lookback" integer, "p_limit" integer, "p_ads_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_minutes_lookback" integer, "p_limit" integer, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_minutes_lookback" integer, "p_limit" integer, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recent_intents_v1"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_minutes_lookback" integer, "p_limit" integer, "p_ads_only" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recent_intents_v2"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_ads_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_redundant_identities"("p_site_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_redundant_identities"("p_site_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_redundant_identities"("p_site_id" "uuid", "p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_session_details"("p_site_id" "uuid", "p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_session_timeline"("p_site_id" "uuid", "p_session_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sessions_by_fingerprint"("p_site_id" "uuid", "p_fingerprint" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_traffic_source_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_traffic_source_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_traffic_source_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_traffic_source_breakdown_v1"("p_site_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_url_param"("p_url" "text", "p_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_url_param"("p_url" "text", "p_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_url_param"("p_url" "text", "p_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_call_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_call_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_call_status_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."heartbeat_merkle_1000"() TO "anon";
GRANT ALL ON FUNCTION "public"."heartbeat_merkle_1000"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."heartbeat_merkle_1000"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_provider_upload_metrics"("p_site_id" "uuid", "p_provider_key" "text", "p_attempts_delta" bigint, "p_completed_delta" bigint, "p_failed_delta" bigint, "p_retry_delta" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_provider_upload_metrics"("p_site_id" "uuid", "p_provider_key" "text", "p_attempts_delta" bigint, "p_completed_delta" bigint, "p_failed_delta" bigint, "p_retry_delta" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_provider_upload_metrics"("p_site_id" "uuid", "p_provider_key" "text", "p_attempts_delta" bigint, "p_completed_delta" bigint, "p_failed_delta" bigint, "p_retry_delta" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_usage_checked"("p_site_id" "uuid", "p_month" "date", "p_kind" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_usage_checked"("p_site_id" "uuid", "p_month" "date", "p_kind" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_usage_checked"("p_site_id" "uuid", "p_month" "date", "p_kind" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_shadow_decision"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_rejected_gear_or_branch" "text", "p_reason" "text", "p_context" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_shadow_decision"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_rejected_gear_or_branch" "text", "p_reason" "text", "p_context" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_shadow_decision"("p_site_id" "uuid", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_rejected_gear_or_branch" "text", "p_reason" "text", "p_context" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."invoice_snapshot_immutable"() TO "anon";
GRANT ALL ON FUNCTION "public"."invoice_snapshot_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."invoice_snapshot_immutable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ads_session"("sess" "public"."sessions") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ads_session"("sess" "public"."sessions") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ads_session"("sess" "public"."sessions") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ads_session_click_id_only"("sess" "public"."sessions") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ads_session_click_id_only"("sess" "public"."sessions") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ads_session_click_id_only"("sess" "public"."sessions") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ads_session_input"("p_attribution_source" "text", "p_gbraid" "text", "p_gclid" "text", "p_utm_medium" "text", "p_utm_source" "text", "p_wbraid" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_site_admin_member"("p_site_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_site_admin_member"("p_site_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_site_admin_member"("p_site_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_site_admin_member"("p_site_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_site_owner"("_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_site_owner"("_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_site_owner"("_site_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."list_offline_conversion_groups"("p_limit_groups" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."list_offline_conversion_groups"("p_limit_groups" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_offline_conversion_groups"("p_limit_groups" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."log_oci_payload_validation_event"("p_actor" "text", "p_queue_id" "uuid", "p_site_id" "uuid", "p_attempted_status" "text", "p_payload" "jsonb", "p_unknown_keys" "text"[], "p_missing_required" "text"[], "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_oci_payload_validation_event"("p_actor" "text", "p_queue_id" "uuid", "p_site_id" "uuid", "p_attempted_status" "text", "p_payload" "jsonb", "p_unknown_keys" "text"[], "p_missing_required" "text"[], "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_oci_payload_validation_event"("p_actor" "text", "p_queue_id" "uuid", "p_site_id" "uuid", "p_attempted_status" "text", "p_payload" "jsonb", "p_unknown_keys" "text"[], "p_missing_required" "text"[], "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."marketing_signals_bitemporal_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."marketing_signals_bitemporal_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marketing_signals_bitemporal_audit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."oci_attempt_cap"("p_max_attempts" integer, "p_min_age_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."oci_attempt_cap"("p_max_attempts" integer, "p_min_age_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."oci_attempt_cap"("p_max_attempts" integer, "p_min_age_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."oci_transition_payload_allowed_keys"() TO "anon";
GRANT ALL ON FUNCTION "public"."oci_transition_payload_allowed_keys"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."oci_transition_payload_allowed_keys"() TO "service_role";



GRANT ALL ON FUNCTION "public"."oci_transition_payload_missing_required"("p_status" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."oci_transition_payload_missing_required"("p_status" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."oci_transition_payload_missing_required"("p_status" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."oci_transition_payload_unknown_keys"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."oci_transition_payload_unknown_keys"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."oci_transition_payload_unknown_keys"("p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ping"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ping"() TO "anon";
GRANT ALL ON FUNCTION "public"."ping"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ping"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_transition_clear_fields"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_transition_clear_fields"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_transition_clear_fields"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_transition_payload_has_meaningful_patch"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_transition_payload_has_meaningful_patch"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_transition_payload_has_meaningful_patch"("p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_confirmed_sale_queue_v1"("p_sale_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_provider_outcome"("p_site_id" "uuid", "p_provider_key" "text", "p_is_success" boolean, "p_is_transient" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."record_provider_outcome"("p_site_id" "uuid", "p_provider_key" "text", "p_is_success" boolean, "p_is_transient" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_provider_outcome"("p_site_id" "uuid", "p_provider_key" "text", "p_is_success" boolean, "p_is_transient" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."recover_stuck_ingest_fallback"("p_min_age_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."recover_stuck_ingest_fallback"("p_min_age_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recover_stuck_ingest_fallback"("p_min_age_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."recover_stuck_offline_conversion_jobs"("p_min_age_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."recover_stuck_offline_conversion_jobs"("p_min_age_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recover_stuck_offline_conversion_jobs"("p_min_age_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_business_data_before_cutoff_v1"("p_cutoff" timestamp with time zone, "p_dry_run" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."reset_business_data_before_cutoff_v1"("p_cutoff" timestamp with time zone, "p_dry_run" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_business_data_before_cutoff_v1"("p_cutoff" timestamp with time zone, "p_dry_run" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_conversation_with_sale_link"("p_conversation_id" "uuid", "p_status" "text", "p_note" "text", "p_sale_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_conversation_with_sale_link"("p_conversation_id" "uuid", "p_status" "text", "p_note" "text", "p_sale_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_conversation_with_sale_link"("p_conversation_id" "uuid", "p_status" "text", "p_note" "text", "p_sale_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_site_identifier_v1"("p_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_site_identifier_v1"("p_input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_site_identifier_v1"("p_input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_site_identifier_v1"("p_input" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_call_sale_time_v1"("p_call_id" "uuid", "p_action" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."revive_dead_cohort"("p_filter" "jsonb", "p_limit" integer, "p_dry_run" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."revive_dead_cohort"("p_filter" "jsonb", "p_limit" integer, "p_dry_run" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."revive_dead_cohort"("p_filter" "jsonb", "p_limit" integer, "p_dry_run" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rotate_site_secret_v1"("p_site_public_id" "text", "p_current_secret" "text", "p_next_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rotate_site_secret_v1"("p_site_public_id" "text", "p_current_secret" "text", "p_next_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rotate_site_secret_v1"("p_site_public_id" "text", "p_current_secret" "text", "p_next_secret" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rotate_site_secret_v1"("p_site_public_id" "text", "p_current_secret" "text", "p_next_secret" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sales_conversation_site_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."sales_conversation_site_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sales_conversation_site_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sales_finalized_identity_immutable_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."sales_finalized_identity_immutable_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sales_finalized_identity_immutable_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_provider_state_half_open"("p_site_id" "uuid", "p_provider_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_provider_state_half_open"("p_site_id" "uuid", "p_provider_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_provider_state_half_open"("p_site_id" "uuid", "p_provider_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sites_before_insert_identity"() TO "anon";
GRANT ALL ON FUNCTION "public"."sites_before_insert_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sites_before_insert_identity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_dlq_record_replay"("p_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_dlq_record_replay"("p_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_dlq_record_replay"("p_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_user_emails_from_auth"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_emails_from_auth"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_emails_from_auth"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_calls_enforce_session_created_month"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_calls_enforce_session_created_month"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_calls_enforce_session_created_month"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_events_set_session_month_from_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_events_set_session_month_from_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_events_set_session_month_from_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_sessions_set_created_month"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sessions_set_created_month"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sessions_set_created_month"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_calls_notify_hunter_ai"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_calls_notify_hunter_ai"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_calls_notify_hunter_ai"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."undo_last_action_v1"("p_call_id" "uuid", "p_actor_type" "text", "p_actor_id" "uuid", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_fallback_on_publish_failure"("p_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_fallback_on_publish_failure"("p_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_fallback_on_publish_failure"("p_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_offline_conversion_queue_attribution"("p_sale_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_offline_conversion_queue_attribution"("p_sale_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_offline_conversion_queue_attribution"("p_sale_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_queue_status_locked"("p_ids" "uuid"[], "p_site_id" "uuid", "p_action" "text", "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_queue_status_locked"("p_ids" "uuid"[], "p_site_id" "uuid", "p_action" "text", "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_queue_status_locked"("p_ids" "uuid"[], "p_site_id" "uuid", "p_action" "text", "p_clear_errors" boolean, "p_error_code" "text", "p_error_category" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."utc_year_month"("ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."utc_year_month"("ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."utc_year_month"("ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_date_range"("p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."validate_date_range"("p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_date_range"("p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_call_event_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_raw_body" "text", "p_signature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_call_event_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_raw_body" "text", "p_signature" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_call_event_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_raw_body" "text", "p_signature" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_call_event_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_raw_body" "text", "p_signature" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_current_events_partition_exists"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_current_events_partition_exists"() TO "anon";
GRANT ALL ON FUNCTION "public"."verify_current_events_partition_exists"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_current_events_partition_exists"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_gdpr_consent_signature_v1"("p_site_public_id" "text", "p_ts" bigint, "p_nonce" "text", "p_identifier_type" "text", "p_identifier_value" "text", "p_consent_scopes_json" "text", "p_consent_at" "text", "p_signature" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_partition_triggers_exist"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_partition_triggers_exist"() TO "anon";
GRANT ALL ON FUNCTION "public"."verify_partition_triggers_exist"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_partition_triggers_exist"() TO "service_role";



GRANT ALL ON FUNCTION "public"."void_pending_oci_queue_on_call_reversal"() TO "anon";
GRANT ALL ON FUNCTION "public"."void_pending_oci_queue_on_call_reversal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."void_pending_oci_queue_on_call_reversal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."watchtower_partition_drift_check_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."watchtower_partition_drift_check_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."watchtower_partition_drift_check_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."watchtower_partition_drift_check_v1"() TO "service_role";






























GRANT ALL ON TABLE "public"."ad_spend_daily" TO "anon";
GRANT ALL ON TABLE "public"."ad_spend_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."ad_spend_daily" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."billing_compensation_failures" TO "anon";
GRANT ALL ON TABLE "public"."billing_compensation_failures" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_compensation_failures" TO "service_role";



GRANT ALL ON SEQUENCE "public"."billing_reconciliation_jobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."billing_reconciliation_jobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."billing_reconciliation_jobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."call_actions" TO "anon";
GRANT ALL ON TABLE "public"."call_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."call_actions" TO "service_role";



GRANT ALL ON TABLE "public"."call_scores" TO "anon";
GRANT ALL ON TABLE "public"."call_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."call_scores" TO "service_role";



GRANT ALL ON TABLE "public"."calls" TO "anon";
GRANT ALL ON TABLE "public"."calls" TO "authenticated";
GRANT ALL ON TABLE "public"."calls" TO "service_role";



GRANT ALL ON TABLE "public"."causal_dna_ledger" TO "anon";
GRANT ALL ON TABLE "public"."causal_dna_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."causal_dna_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."causal_dna_ledger_failures" TO "anon";
GRANT ALL ON TABLE "public"."causal_dna_ledger_failures" TO "authenticated";
GRANT ALL ON TABLE "public"."causal_dna_ledger_failures" TO "service_role";



GRANT ALL ON SEQUENCE "public"."causal_dna_ledger_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."causal_dna_ledger_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."causal_dna_ledger_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_links" TO "anon";
GRANT ALL ON TABLE "public"."conversation_links" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_links" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."customer_invite_audit" TO "anon";
GRANT ALL ON TABLE "public"."customer_invite_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_invite_audit" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."events_2026_01" TO "anon";
GRANT ALL ON TABLE "public"."events_2026_01" TO "authenticated";
GRANT ALL ON TABLE "public"."events_2026_01" TO "service_role";



GRANT ALL ON TABLE "public"."events_2026_02" TO "anon";
GRANT ALL ON TABLE "public"."events_2026_02" TO "authenticated";
GRANT ALL ON TABLE "public"."events_2026_02" TO "service_role";



GRANT ALL ON TABLE "public"."events_2026_03" TO "anon";
GRANT ALL ON TABLE "public"."events_2026_03" TO "authenticated";
GRANT ALL ON TABLE "public"."events_2026_03" TO "service_role";



GRANT ALL ON TABLE "public"."events_default" TO "anon";
GRANT ALL ON TABLE "public"."events_default" TO "authenticated";
GRANT ALL ON TABLE "public"."events_default" TO "service_role";



GRANT ALL ON TABLE "public"."gdpr_consents" TO "anon";
GRANT ALL ON TABLE "public"."gdpr_consents" TO "authenticated";
GRANT ALL ON TABLE "public"."gdpr_consents" TO "service_role";



GRANT ALL ON TABLE "public"."gdpr_erase_requests" TO "anon";
GRANT ALL ON TABLE "public"."gdpr_erase_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."gdpr_erase_requests" TO "service_role";



GRANT ALL ON TABLE "public"."google_geo_targets" TO "anon";
GRANT ALL ON TABLE "public"."google_geo_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."google_geo_targets" TO "service_role";



GRANT ALL ON TABLE "public"."ingest_fallback_buffer" TO "anon";
GRANT ALL ON TABLE "public"."ingest_fallback_buffer" TO "authenticated";
GRANT ALL ON TABLE "public"."ingest_fallback_buffer" TO "service_role";



GRANT ALL ON TABLE "public"."ingest_fraud_quarantine" TO "anon";
GRANT ALL ON TABLE "public"."ingest_fraud_quarantine" TO "authenticated";
GRANT ALL ON TABLE "public"."ingest_fraud_quarantine" TO "service_role";



GRANT ALL ON TABLE "public"."ingest_idempotency" TO "anon";
GRANT ALL ON TABLE "public"."ingest_idempotency" TO "authenticated";
GRANT ALL ON TABLE "public"."ingest_idempotency" TO "service_role";



GRANT ALL ON TABLE "public"."ingest_publish_failures" TO "anon";
GRANT ALL ON TABLE "public"."ingest_publish_failures" TO "authenticated";
GRANT ALL ON TABLE "public"."ingest_publish_failures" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_snapshot" TO "anon";
GRANT ALL ON TABLE "public"."invoice_snapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_snapshot" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_signals" TO "anon";
GRANT ALL ON TABLE "public"."marketing_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_signals" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_signals_history" TO "anon";
GRANT ALL ON TABLE "public"."marketing_signals_history" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_signals_history" TO "service_role";



GRANT ALL ON TABLE "public"."oci_payload_validation_events" TO "anon";
GRANT ALL ON TABLE "public"."oci_payload_validation_events" TO "authenticated";
GRANT ALL ON TABLE "public"."oci_payload_validation_events" TO "service_role";



GRANT ALL ON TABLE "public"."oci_queue_transitions" TO "anon";
GRANT ALL ON TABLE "public"."oci_queue_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."oci_queue_transitions" TO "service_role";



GRANT ALL ON TABLE "public"."offline_conversion_tombstones" TO "anon";
GRANT ALL ON TABLE "public"."offline_conversion_tombstones" TO "authenticated";
GRANT ALL ON TABLE "public"."offline_conversion_tombstones" TO "service_role";



GRANT ALL ON TABLE "public"."outbox_events" TO "anon";
GRANT ALL ON TABLE "public"."outbox_events" TO "authenticated";
GRANT ALL ON TABLE "public"."outbox_events" TO "service_role";



GRANT ALL ON TABLE "public"."processed_signals" TO "anon";
GRANT ALL ON TABLE "public"."processed_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."processed_signals" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."provider_credentials" TO "anon";
GRANT ALL ON TABLE "public"."provider_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_credentials" TO "service_role";



GRANT ALL ON TABLE "public"."provider_dispatches" TO "anon";
GRANT ALL ON TABLE "public"."provider_dispatches" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_dispatches" TO "service_role";



GRANT ALL ON TABLE "public"."provider_health_state" TO "anon";
GRANT ALL ON TABLE "public"."provider_health_state" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_health_state" TO "service_role";



GRANT ALL ON TABLE "public"."provider_upload_attempts" TO "anon";
GRANT ALL ON TABLE "public"."provider_upload_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_upload_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."provider_upload_metrics" TO "anon";
GRANT ALL ON TABLE "public"."provider_upload_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_upload_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."revenue_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."revenue_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."revenue_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_2026_01" TO "anon";
GRANT ALL ON TABLE "public"."sessions_2026_01" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_2026_01" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_2026_02" TO "anon";
GRANT ALL ON TABLE "public"."sessions_2026_02" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_2026_02" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_2026_03" TO "anon";
GRANT ALL ON TABLE "public"."sessions_2026_03" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_2026_03" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_default" TO "anon";
GRANT ALL ON TABLE "public"."sessions_default" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_default" TO "service_role";



GRANT ALL ON TABLE "public"."shadow_decisions" TO "anon";
GRANT ALL ON TABLE "public"."shadow_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."shadow_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."signal_entropy_by_fingerprint" TO "anon";
GRANT ALL ON TABLE "public"."signal_entropy_by_fingerprint" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_entropy_by_fingerprint" TO "service_role";



GRANT ALL ON TABLE "public"."site_members" TO "anon";
GRANT ALL ON TABLE "public"."site_members" TO "authenticated";
GRANT ALL ON TABLE "public"."site_members" TO "service_role";



GRANT ALL ON TABLE "public"."site_plans" TO "anon";
GRANT ALL ON TABLE "public"."site_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."site_plans" TO "service_role";



GRANT ALL ON TABLE "public"."site_usage_monthly" TO "anon";
GRANT ALL ON TABLE "public"."site_usage_monthly" TO "authenticated";
GRANT ALL ON TABLE "public"."site_usage_monthly" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."sync_dlq" TO "anon";
GRANT ALL ON TABLE "public"."sync_dlq" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_dlq" TO "service_role";



GRANT ALL ON TABLE "public"."sync_dlq_replay_audit" TO "anon";
GRANT ALL ON TABLE "public"."sync_dlq_replay_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_dlq_replay_audit" TO "service_role";



GRANT ALL ON TABLE "public"."system_integrity_merkle" TO "anon";
GRANT ALL ON TABLE "public"."system_integrity_merkle" TO "authenticated";
GRANT ALL ON TABLE "public"."system_integrity_merkle" TO "service_role";



GRANT ALL ON TABLE "public"."usage_counters" TO "anon";
GRANT ALL ON TABLE "public"."usage_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_counters" TO "service_role";



GRANT ALL ON TABLE "public"."user_credentials" TO "anon";
GRANT ALL ON TABLE "public"."user_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."user_credentials" TO "service_role";



GRANT ALL ON TABLE "public"."user_emails" TO "anon";
GRANT ALL ON TABLE "public"."user_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."user_emails" TO "service_role";



GRANT ALL ON TABLE "public"."watchtower_checks" TO "anon";
GRANT ALL ON TABLE "public"."watchtower_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."watchtower_checks" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































