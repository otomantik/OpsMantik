-- Migration: Critical Database Fixes (P0)
-- Date: 2026-01-28
--
-- Fixes:
-- 1. intent_stamp UNIQUE index (partial, WHERE NOT NULL) - Beton Idempotency
-- 2. phone_number NULLABLE - Genel Intent tablosu uyumluluğu
-- 3. UUID function migration: uuid_generate_v4() -> gen_random_uuid() (remove uuid-ossp dependency)
-- 4. Verify events FK is clean (no duplicate FK constraints on partitions)
-- 5. Add index for calls.matched_session_id (loose coupling support)

BEGIN;

-- ============================================================================
-- 1. MÜHÜR KORUMASI: intent_stamp UNIQUE Index (Partial, WHERE NOT NULL)
-- ============================================================================
-- Note: The constraint in 20260128036100 allows NULLs (UNIQUE allows multiple NULLs).
-- But we also want a partial index for performance and explicit NULL handling.
-- This ensures: same intent_stamp + same site_id = only 1 row (when stamp is NOT NULL)

DO $$
BEGIN
  -- Drop the full UNIQUE constraint if it exists (we'll use partial index instead)
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'calls_site_intent_stamp_uniq'
      AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE public.calls
      DROP CONSTRAINT calls_site_intent_stamp_uniq;
  END IF;

  -- Create partial UNIQUE index (allows multiple NULLs, enforces uniqueness for non-NULLs)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'calls'
      AND indexname = 'idx_calls_site_intent_stamp_uniq'
  ) THEN
    CREATE UNIQUE INDEX idx_calls_site_intent_stamp_uniq
    ON public.calls(site_id, intent_stamp)
    WHERE intent_stamp IS NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. PHONE_NUMBER NULLABLE: Genel Intent Tablosu Uyumluluğu
-- ============================================================================
-- Rationale: calls tablosu artık genel bir "Intent" tablosu.
-- phone_number zorunlu olmamalı çünkü:
-- - Contact Form intents (no phone)
-- - WhatsApp links without visible number (wa.me/...)
-- - Future intent types may not have phone_number
-- 
-- intent_target column already exists for normalized target storage.

DO $$
BEGIN
  -- Check if column is NOT NULL
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'calls'
      AND column_name = 'phone_number'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.calls
      ALTER COLUMN phone_number DROP NOT NULL;
    
    COMMENT ON COLUMN public.calls.phone_number IS 
      'Legacy/extracted phone number. Use intent_target for normalized target storage.';
  END IF;
END $$;

-- ============================================================================
-- 3. UUID FUNCTION MIGRATION: uuid_generate_v4() -> gen_random_uuid()
-- ============================================================================
-- Rationale: gen_random_uuid() is PostgreSQL native (9.4+), no extension needed.
-- uuid-ossp extension is legacy. Migrate all tables to use gen_random_uuid().
--
-- Note: This only affects DEFAULT values for NEW rows. Existing rows keep their UUIDs.
-- We update DEFAULT clauses, not existing data.

DO $$
BEGIN
  -- Sites table
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sites'
      AND column_name = 'id'
      AND column_default LIKE '%uuid_generate_v4%'
  ) THEN
    ALTER TABLE public.sites
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;

  -- Events table
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'id'
      AND column_default LIKE '%uuid_generate_v4%'
  ) THEN
    ALTER TABLE public.events
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;

  -- Calls table
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'calls'
      AND column_name = 'id'
      AND column_default LIKE '%uuid_generate_v4%'
  ) THEN
    ALTER TABLE public.calls
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;

  -- User credentials table
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_credentials'
      AND column_name = 'id'
      AND column_default LIKE '%uuid_generate_v4%'
  ) THEN
    ALTER TABLE public.user_credentials
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END $$;

-- ============================================================================
-- 4. EVENTS FK CLEANUP: Verify no duplicate FK constraints on partitions
-- ============================================================================
-- Rationale: Partitioned tables should have FK on parent table only.
-- PostgreSQL automatically enforces FK on all partitions.
-- If duplicate FKs exist on partitions, they should be removed.
--
-- Note: We check but don't auto-remove (manual review recommended).
-- The initial_schema.sql already has correct FK on parent events table.

DO $$
DECLARE
  partition_record RECORD;
  fk_count INTEGER;
BEGIN
  -- Check for partitions with duplicate FK constraints
  FOR partition_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'events_%'
      AND tablename ~ '^events_\d{4}_\d{2}$'
  LOOP
    SELECT COUNT(*) INTO fk_count
    FROM pg_constraint
    WHERE conrelid = (partition_record.schemaname || '.' || partition_record.tablename)::regclass
      AND contype = 'f'
      AND conname LIKE '%session%';
    
    IF fk_count > 0 THEN
      RAISE WARNING 'Partition % has % FK constraint(s). FK should only be on parent events table.', 
        partition_record.tablename, fk_count;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 5. CALLS -> SESSIONS INDEX: Loose coupling support (already exists, verify)
-- ============================================================================
-- Rationale: calls.matched_session_id has no FK (sessions is partitioned).
-- Index exists for join performance. Verify it exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'calls'
      AND indexname = 'idx_calls_matched_session'
  ) THEN
    CREATE INDEX idx_calls_matched_session
    ON public.calls(matched_session_id);
    
    COMMENT ON INDEX idx_calls_matched_session IS 
      'Index for loose coupling with partitioned sessions table (no FK constraint).';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run manually after migration)
-- ============================================================================
-- 
-- 1. Verify intent_stamp unique index:
--    SELECT indexname, indexdef FROM pg_indexes 
--    WHERE tablename = 'calls' AND indexname = 'idx_calls_site_intent_stamp_uniq';
--
-- 2. Verify phone_number is nullable:
--    SELECT column_name, is_nullable FROM information_schema.columns 
--    WHERE table_name = 'calls' AND column_name = 'phone_number';
--
-- 3. Verify UUID defaults use gen_random_uuid():
--    SELECT table_name, column_name, column_default FROM information_schema.columns 
--    WHERE column_default LIKE '%gen_random_uuid%' AND table_schema = 'public';
--
-- 4. Test idempotency (should fail on duplicate):
--    INSERT INTO calls (site_id, intent_stamp, source) 
--    VALUES ('test-site-id', 'test-stamp-123', 'click');
--    INSERT INTO calls (site_id, intent_stamp, source) 
--    VALUES ('test-site-id', 'test-stamp-123', 'click'); -- Should fail with unique violation
