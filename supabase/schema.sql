


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


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."admin_sites_list"("search" "text" DEFAULT NULL::"text", "limit_count" integer DEFAULT 50, "offset_count" integer DEFAULT 0) RETURNS TABLE("site_id" "uuid", "name" "text", "domain" "text", "public_id" "text", "owner_user_id" "uuid", "owner_email" "text", "last_event_at" timestamp with time zone, "last_category" "text", "last_label" "text", "minutes_ago" integer, "status" "text")
    LANGUAGE "plpgsql"
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



CREATE OR REPLACE FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) RETURNS TABLE("sessions_count" bigint, "leads_count" bigint, "calls_count" bigint, "conversions_count" bigint, "last_event_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
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



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "phone_number" "text" NOT NULL,
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
    CONSTRAINT "calls_status_check" CHECK ((("status" = ANY (ARRAY['intent'::"text", 'confirmed'::"text", 'junk'::"text", 'qualified'::"text", 'real'::"text"])) OR ("status" IS NULL)))
);

ALTER TABLE ONLY "public"."calls" REPLICA IDENTITY FULL;


ALTER TABLE "public"."calls" OWNER TO "postgres";


COMMENT ON COLUMN "public"."calls"."matched_at" IS 'Timestamp when match occurred';



COMMENT ON COLUMN "public"."calls"."status" IS 'Call status: intent (soft click), confirmed (intent confirmed), junk, qualified, real (actual call)';



COMMENT ON COLUMN "public"."calls"."lead_score_at_match" IS 'Lead score at the time of match (snapshot)';



COMMENT ON COLUMN "public"."calls"."score_breakdown" IS 'Detailed score calculation breakdown: {conversionPoints, interactionPoints, bonuses, cappedAt100}';



COMMENT ON COLUMN "public"."calls"."source" IS 'Source of call: click (phone/whatsapp click), api (call-event API), manual';



COMMENT ON COLUMN "public"."calls"."confirmed_at" IS 'Timestamp when intent was confirmed by user';



COMMENT ON COLUMN "public"."calls"."confirmed_by" IS 'User ID who confirmed the intent';



COMMENT ON COLUMN "public"."calls"."note" IS 'Manual note for the call';



CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
)
PARTITION BY RANGE ("session_month");

ALTER TABLE ONLY "public"."events" REPLICA IDENTITY FULL;


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events_2026_01" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);

ALTER TABLE ONLY "public"."events_2026_01" REPLICA IDENTITY FULL;


ALTER TABLE "public"."events_2026_01" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events_2026_02" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."events_2026_02" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events_default" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "session_month" "date" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "event_category" "text" DEFAULT 'interaction'::"text",
    "event_action" "text" DEFAULT 'view'::"text",
    "event_label" "text",
    "event_value" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);

ALTER TABLE ONLY "public"."events_default" REPLICA IDENTITY FULL;


ALTER TABLE "public"."events_default" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


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
    "fingerprint" "text"
)
PARTITION BY RANGE ("created_month");

ALTER TABLE ONLY "public"."sessions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sessions"."attribution_source" IS 'Computed attribution source: First Click (Paid), Paid (UTM), Ads Assisted, Paid Social, or Organic';



COMMENT ON COLUMN "public"."sessions"."device_type" IS 'Normalized device type: desktop, mobile, or tablet';



COMMENT ON COLUMN "public"."sessions"."city" IS 'City name from geo headers or metadata';



COMMENT ON COLUMN "public"."sessions"."district" IS 'District name from geo headers or metadata';



COMMENT ON COLUMN "public"."sessions"."fingerprint" IS 'Browser fingerprint hash for session matching';



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
    "fingerprint" "text"
);

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
    "fingerprint" "text"
);


ALTER TABLE "public"."sessions_2026_02" OWNER TO "postgres";


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
    "fingerprint" "text"
);


ALTER TABLE "public"."sessions_default" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "site_members_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'editor'::"text", 'owner'::"text"])))
);


ALTER TABLE "public"."site_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "public_id" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "name" "text"
);

ALTER TABLE ONLY "public"."sites" REPLICA IDENTITY FULL;


ALTER TABLE "public"."sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_credentials" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_credentials" OWNER TO "postgres";


ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_2026_01" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');



ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_2026_02" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');



ALTER TABLE ONLY "public"."events" ATTACH PARTITION "public"."events_default" DEFAULT;



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_2026_01" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_2026_02" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');



ALTER TABLE ONLY "public"."sessions" ATTACH PARTITION "public"."sessions_default" DEFAULT;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_2026_01"
    ADD CONSTRAINT "events_2026_01_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_2026_02"
    ADD CONSTRAINT "events_2026_02_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."events_default"
    ADD CONSTRAINT "events_default_pkey" PRIMARY KEY ("id", "session_month");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_2026_01"
    ADD CONSTRAINT "sessions_2026_01_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_2026_02"
    ADD CONSTRAINT "sessions_2026_02_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."sessions_default"
    ADD CONSTRAINT "sessions_default_pkey" PRIMARY KEY ("id", "created_month");



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_site_id_user_id_key" UNIQUE ("site_id", "user_id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_public_id_key" UNIQUE ("public_id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_public_id_unique" UNIQUE ("public_id");



ALTER TABLE ONLY "public"."user_credentials"
    ADD CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_credentials"
    ADD CONSTRAINT "user_credentials_user_id_provider_key" UNIQUE ("user_id", "provider");



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



CREATE INDEX "events_2026_02_event_category_created_at_idx" ON "public"."events_2026_02" USING "btree" ("event_category", "created_at");



CREATE INDEX "events_2026_02_expr_idx" ON "public"."events_2026_02" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "events_2026_02_expr_idx1" ON "public"."events_2026_02" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "events_2026_02_metadata_idx" ON "public"."events_2026_02" USING "gin" ("metadata");



CREATE INDEX "events_2026_02_session_id_created_at_idx" ON "public"."events_2026_02" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "events_2026_02_session_id_event_category_created_at_idx" ON "public"."events_2026_02" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "events_default_event_category_created_at_idx" ON "public"."events_default" USING "btree" ("event_category", "created_at");



CREATE INDEX "events_default_expr_idx" ON "public"."events_default" USING "btree" ((("metadata" ->> 'fingerprint'::"text"))) WHERE (("metadata" ->> 'fingerprint'::"text") IS NOT NULL);



CREATE INDEX "events_default_expr_idx1" ON "public"."events_default" USING "btree" ((("metadata" ->> 'gclid'::"text"))) WHERE (("metadata" ->> 'gclid'::"text") IS NOT NULL);



CREATE INDEX "events_default_metadata_idx" ON "public"."events_default" USING "gin" ("metadata");



CREATE INDEX "events_default_session_id_created_at_idx" ON "public"."events_default" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "events_default_session_id_event_category_created_at_idx" ON "public"."events_default" USING "btree" ("session_id", "event_category", "created_at" DESC);



CREATE INDEX "idx_calls_confirmed_at" ON "public"."calls" USING "btree" ("confirmed_at") WHERE ("confirmed_at" IS NOT NULL);



CREATE INDEX "idx_calls_created_at" ON "public"."calls" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_calls_dedupe_intent" ON "public"."calls" USING "btree" ("site_id", "matched_session_id", "source", "created_at") WHERE ("status" = 'intent'::"text");



CREATE INDEX "idx_calls_fingerprint" ON "public"."calls" USING "btree" ("matched_fingerprint");



CREATE INDEX "idx_calls_matched_at" ON "public"."calls" USING "btree" ("matched_at") WHERE ("matched_at" IS NOT NULL);



CREATE INDEX "idx_calls_session_id" ON "public"."calls" USING "btree" ("matched_session_id");



CREATE INDEX "idx_calls_site_id" ON "public"."calls" USING "btree" ("site_id");



CREATE INDEX "idx_calls_site_id_created_at" ON "public"."calls" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_calls_source" ON "public"."calls" USING "btree" ("source") WHERE ("source" IS NOT NULL);



CREATE INDEX "idx_calls_status" ON "public"."calls" USING "btree" ("status") WHERE ("status" IS NOT NULL);



CREATE INDEX "idx_calls_status_intent" ON "public"."calls" USING "btree" ("status") WHERE ("status" = 'intent'::"text");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_sessions_attribution_source" ON ONLY "public"."sessions" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "idx_sessions_device_type" ON ONLY "public"."sessions" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "idx_sessions_fingerprint" ON ONLY "public"."sessions" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "idx_sessions_gclid" ON ONLY "public"."sessions" USING "btree" ("gclid");



CREATE INDEX "idx_sessions_site_id_created_at" ON ONLY "public"."sessions" USING "btree" ("site_id", "created_at");



CREATE INDEX "idx_sessions_site_month" ON ONLY "public"."sessions" USING "btree" ("site_id", "created_month");



CREATE INDEX "idx_sessions_wbraid" ON ONLY "public"."sessions" USING "btree" ("wbraid");



CREATE INDEX "idx_site_members_site_id" ON "public"."site_members" USING "btree" ("site_id");



CREATE INDEX "idx_site_members_site_user" ON "public"."site_members" USING "btree" ("site_id", "user_id");



CREATE INDEX "idx_site_members_user_id" ON "public"."site_members" USING "btree" ("user_id");



CREATE INDEX "idx_sites_created_at" ON "public"."sites" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_sites_public_id" ON "public"."sites" USING "btree" ("public_id");



CREATE INDEX "sessions_2026_01_attribution_source_idx" ON "public"."sessions_2026_01" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_2026_01_device_type_idx" ON "public"."sessions_2026_01" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_2026_01_fingerprint_idx" ON "public"."sessions_2026_01" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_01_gclid_idx" ON "public"."sessions_2026_01" USING "btree" ("gclid");



CREATE INDEX "sessions_2026_01_site_id_created_at_idx" ON "public"."sessions_2026_01" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_2026_01_site_id_created_month_idx" ON "public"."sessions_2026_01" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_2026_01_wbraid_idx" ON "public"."sessions_2026_01" USING "btree" ("wbraid");



CREATE INDEX "sessions_2026_02_attribution_source_idx" ON "public"."sessions_2026_02" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_2026_02_device_type_idx" ON "public"."sessions_2026_02" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_2026_02_fingerprint_idx" ON "public"."sessions_2026_02" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_2026_02_gclid_idx" ON "public"."sessions_2026_02" USING "btree" ("gclid");



CREATE INDEX "sessions_2026_02_site_id_created_at_idx" ON "public"."sessions_2026_02" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_2026_02_site_id_created_month_idx" ON "public"."sessions_2026_02" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_2026_02_wbraid_idx" ON "public"."sessions_2026_02" USING "btree" ("wbraid");



CREATE INDEX "sessions_default_attribution_source_idx" ON "public"."sessions_default" USING "btree" ("attribution_source") WHERE ("attribution_source" IS NOT NULL);



CREATE INDEX "sessions_default_device_type_idx" ON "public"."sessions_default" USING "btree" ("device_type") WHERE ("device_type" IS NOT NULL);



CREATE INDEX "sessions_default_fingerprint_idx" ON "public"."sessions_default" USING "btree" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



CREATE INDEX "sessions_default_gclid_idx" ON "public"."sessions_default" USING "btree" ("gclid");



CREATE INDEX "sessions_default_site_id_created_at_idx" ON "public"."sessions_default" USING "btree" ("site_id", "created_at");



CREATE INDEX "sessions_default_site_id_created_month_idx" ON "public"."sessions_default" USING "btree" ("site_id", "created_month");



CREATE INDEX "sessions_default_wbraid_idx" ON "public"."sessions_default" USING "btree" ("wbraid");



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_2026_01_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_2026_01_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_2026_01_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_2026_01_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_2026_01_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_2026_01_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_2026_01_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_2026_02_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_2026_02_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_2026_02_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_2026_02_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_2026_02_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_2026_02_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_2026_02_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_category_created_at" ATTACH PARTITION "public"."events_default_event_category_created_at_idx";



ALTER INDEX "public"."idx_events_metadata_fingerprint_text" ATTACH PARTITION "public"."events_default_expr_idx";



ALTER INDEX "public"."idx_events_metadata_gclid_text" ATTACH PARTITION "public"."events_default_expr_idx1";



ALTER INDEX "public"."idx_events_metadata_gin" ATTACH PARTITION "public"."events_default_metadata_idx";



ALTER INDEX "public"."events_pkey" ATTACH PARTITION "public"."events_default_pkey";



ALTER INDEX "public"."idx_events_session_created" ATTACH PARTITION "public"."events_default_session_id_created_at_idx";



ALTER INDEX "public"."idx_events_atomic_filter" ATTACH PARTITION "public"."events_default_session_id_event_category_created_at_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_2026_01_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_2026_01_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_2026_01_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_2026_01_gclid_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_2026_01_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_2026_01_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_2026_01_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_2026_01_wbraid_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_2026_02_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_2026_02_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_2026_02_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_2026_02_gclid_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_2026_02_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_2026_02_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_2026_02_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_2026_02_wbraid_idx";



ALTER INDEX "public"."idx_sessions_attribution_source" ATTACH PARTITION "public"."sessions_default_attribution_source_idx";



ALTER INDEX "public"."idx_sessions_device_type" ATTACH PARTITION "public"."sessions_default_device_type_idx";



ALTER INDEX "public"."idx_sessions_fingerprint" ATTACH PARTITION "public"."sessions_default_fingerprint_idx";



ALTER INDEX "public"."idx_sessions_gclid" ATTACH PARTITION "public"."sessions_default_gclid_idx";



ALTER INDEX "public"."sessions_pkey" ATTACH PARTITION "public"."sessions_default_pkey";



ALTER INDEX "public"."idx_sessions_site_id_created_at" ATTACH PARTITION "public"."sessions_default_site_id_created_at_idx";



ALTER INDEX "public"."idx_sessions_site_month" ATTACH PARTITION "public"."sessions_default_site_id_created_month_idx";



ALTER INDEX "public"."idx_sessions_wbraid" ATTACH PARTITION "public"."sessions_default_wbraid_idx";



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE "public"."events"
    ADD CONSTRAINT "fk_events_session" FOREIGN KEY ("session_id", "session_month") REFERENCES "public"."sessions"("id", "created_month") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."sessions"
    ADD CONSTRAINT "sessions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_members"
    ADD CONSTRAINT "site_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_credentials"
    ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Kullanıcılar sadece kendi anahtarlarını görebilir" ON "public"."user_credentials" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Public View" ON "public"."events_default" FOR SELECT USING (true);



CREATE POLICY "Strict View for Owner" ON "public"."events_2026_01" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."sites" "st" ON (("s"."site_id" = "st"."id")))
  WHERE (("s"."id" = "events_2026_01"."session_id") AND ("st"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."calls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calls_select_accessible" ON "public"."calls" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "calls"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("s"."id"))))));



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_2026_01" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_2026_02" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events_default" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_select_accessible" ON "public"."events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sessions" "sess"
     JOIN "public"."sites" "s" ON (("s"."id" = "sess"."site_id")))
  WHERE (("sess"."id" = "events"."session_id") AND ("sess"."created_month" = "events"."session_month") AND (("s"."user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("s"."id"))))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_2026_01" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_2026_02" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions_default" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions_select_accessible" ON "public"."sessions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."id" = "sessions"."site_id") AND (("s"."user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("s"."id"))))));



ALTER TABLE "public"."site_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_members_modify_owner_or_admin" ON "public"."site_members" TO "authenticated" USING (("public"."is_admin"() OR "public"."is_site_owner"("site_id"))) WITH CHECK (("public"."is_admin"() OR "public"."is_site_owner"("site_id")));



CREATE POLICY "site_members_select_accessible" ON "public"."site_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_site_owner"("site_id")));



ALTER TABLE "public"."sites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sites_delete_owner" ON "public"."sites" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "sites_insert_owner" ON "public"."sites" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "sites_select_accessible" ON "public"."sites" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."site_members" "sm"
  WHERE (("sm"."site_id" = "sites"."id") AND ("sm"."user_id" = "auth"."uid"()))))));



CREATE POLICY "sites_update_owner" ON "public"."sites" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_credentials" ENABLE ROW LEVEL SECURITY;




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



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_sites_list"("search" "text", "limit_count" integer, "offset_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_cards"("p_site_id" "uuid", "p_since" timestamp with time zone, "p_until" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_site_owner"("_site_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_site_owner"("_site_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_site_owner"("_site_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."calls" TO "anon";
GRANT ALL ON TABLE "public"."calls" TO "authenticated";
GRANT ALL ON TABLE "public"."calls" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."events_2026_01" TO "anon";
GRANT ALL ON TABLE "public"."events_2026_01" TO "authenticated";
GRANT ALL ON TABLE "public"."events_2026_01" TO "service_role";



GRANT ALL ON TABLE "public"."events_2026_02" TO "anon";
GRANT ALL ON TABLE "public"."events_2026_02" TO "authenticated";
GRANT ALL ON TABLE "public"."events_2026_02" TO "service_role";



GRANT ALL ON TABLE "public"."events_default" TO "anon";
GRANT ALL ON TABLE "public"."events_default" TO "authenticated";
GRANT ALL ON TABLE "public"."events_default" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_2026_01" TO "anon";
GRANT ALL ON TABLE "public"."sessions_2026_01" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_2026_01" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_2026_02" TO "anon";
GRANT ALL ON TABLE "public"."sessions_2026_02" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_2026_02" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_default" TO "anon";
GRANT ALL ON TABLE "public"."sessions_default" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_default" TO "service_role";



GRANT ALL ON TABLE "public"."site_members" TO "anon";
GRANT ALL ON TABLE "public"."site_members" TO "authenticated";
GRANT ALL ON TABLE "public"."site_members" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";



GRANT ALL ON TABLE "public"."user_credentials" TO "anon";
GRANT ALL ON TABLE "public"."user_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."user_credentials" TO "service_role";









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































