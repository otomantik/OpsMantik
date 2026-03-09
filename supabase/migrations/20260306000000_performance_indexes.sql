-- =============================================================================
-- Performance Indexes (Hızlandırma İksiri)
-- ORDER BY created_at DESC, JOIN ve fingerprint aramalarını hızlandırır.
-- Not: CONCURRENTLY migration transaction'da çalışmaz; plain CREATE INDEX kullanıldı.
--      Partition'lar dinamik (events_YYYY_MM, sessions_YYYY_MM) veya default yok;
--      sadece mevcut tablolara index eklenir.
-- =============================================================================

-- Helper: Create index only if table exists
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['events_default','events_2026_01','events_2026_02','events_2026_03'])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_created_at ON public.%I USING btree (created_at)', t, t);
    END IF;
  END LOOP;
END $$;

-- Sessions: default partition gets created_month + fingerprint; named partitions get id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions_default') THEN
    CREATE INDEX IF NOT EXISTS idx_sessions_default_created_month ON public.sessions_default USING btree (created_month);
    CREATE INDEX IF NOT EXISTS idx_sessions_default_fingerprint ON public.sessions_default USING btree (fingerprint);
  END IF;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['sessions_2026_01','sessions_2026_02','sessions_2026_03'])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_id ON public.%I USING btree (id)', t, t);
    END IF;
  END LOOP;
END $$;

-- 3. Ingest Idempotency: mükerrer veri engelleme mekanizmasını hızlandırır
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_created_at ON public.ingest_idempotency USING btree (created_at);
