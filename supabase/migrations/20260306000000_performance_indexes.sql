-- =============================================================================
-- Performance Indexes (Hızlandırma İksiri)
-- ORDER BY created_at DESC, JOIN ve fingerprint aramalarını hızlandırır.
-- Not: CONCURRENTLY migration transaction'da çalışmaz; plain CREATE INDEX kullanıldı.
--      Kısa süreli kilit oluşur (düşük trafik saatinde push önerilir).
-- =============================================================================

-- 1. Events: ORDER BY created_at DESC sorgularını hızlandırır
CREATE INDEX IF NOT EXISTS idx_events_default_created_at ON public.events_default USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_events_2026_01_created_at ON public.events_2026_01 USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_events_2026_02_created_at ON public.events_2026_02 USING btree (created_at);

-- 2. Sessions: Events ile JOIN ve partition taramasını hızlandırır
CREATE INDEX IF NOT EXISTS idx_sessions_default_created_month ON public.sessions_default USING btree (created_month);
CREATE INDEX IF NOT EXISTS idx_sessions_2026_01_id ON public.sessions_2026_01 USING btree (id);
CREATE INDEX IF NOT EXISTS idx_sessions_2026_02_id ON public.sessions_2026_02 USING btree (id);

-- Fingerprint aramalarını hızlandırır
CREATE INDEX IF NOT EXISTS idx_sessions_default_fingerprint ON public.sessions_default USING btree (fingerprint);

-- 3. Ingest Idempotency: mükerrer veri engelleme mekanizmasını hızlandırır
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_created_at ON public.ingest_idempotency USING btree (created_at);
