-- Migration: Phase 0 Audit & Analysis
-- Date: 2026-01-28
-- Purpose: Comprehensive database audit for PRO Dashboard Migration v2.1
-- Note: This migration contains diagnostic queries only, no schema changes

-- ============================================
-- QUERY 1: Table Audit Map
-- ============================================
DO $$
DECLARE
    result_text TEXT := '';
    rec RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 1: TABLE AUDIT MAP';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT 
            t.table_name,
            pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) as size,
            (SELECT count(*) FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = t.table_name) as columns,
            EXISTS(
                SELECT 1 FROM information_schema.table_constraints 
                WHERE table_schema = 'public'
                AND table_name = t.table_name 
                AND constraint_type = 'FOREIGN KEY'
            ) as has_fk,
            CASE 
                WHEN t.table_name LIKE '%_2026_%' OR t.table_name LIKE '%_default' THEN 'PARTITION'
                ELSE 'MAIN'
            END as table_type
        FROM information_schema.tables t
        WHERE t.table_schema = 'public'
        AND t.table_name IN ('sessions', 'events', 'calls', 'sites', 'profiles', 'site_members', 'user_credentials')
        ORDER BY t.table_name
    LOOP
        RAISE NOTICE 'Table: % | Size: % | Columns: % | Has FK: % | Type: %', 
            rec.table_name, rec.size, rec.columns, rec.has_fk, rec.table_type;
    END LOOP;
END $$;

-- ============================================
-- QUERY 2: Row Estimates (Approximate)
-- ============================================
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 2: ROW ESTIMATES';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT 
            schemaname,
            relname as tablename,
            n_live_tup as estimated_rows,
            n_dead_tup as dead_rows,
            last_vacuum,
            last_autovacuum
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        AND relname IN ('sessions', 'events', 'calls', 'sites', 'profiles', 'site_members', 'user_credentials')
        ORDER BY n_live_tup DESC
    LOOP
        RAISE NOTICE 'Table: % | Rows: % | Dead: % | Last Vacuum: %', 
            rec.tablename, rec.estimated_rows, rec.dead_rows, 
            COALESCE(rec.last_vacuum::text, rec.last_autovacuum::text, 'Never');
    END LOOP;
END $$;

-- ============================================
-- QUERY 3: Index Analysis
-- ============================================
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 3: INDEX ANALYSIS';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT 
            t.table_name,
            i.indexname,
            i.indexdef,
            pg_size_pretty(pg_relation_size(quote_ident(i.indexname))) as index_size,
            COALESCE(s.idx_scan, 0) as scans,
            COALESCE(s.idx_tup_read, 0) as tuples_read,
            COALESCE(s.idx_tup_fetch, 0) as tuples_fetched
        FROM pg_indexes i
        JOIN information_schema.tables t ON i.tablename = t.table_name
        LEFT JOIN pg_stat_user_indexes s ON s.schemaname = i.schemaname 
            AND s.indexrelname = i.indexname
        WHERE i.schemaname = 'public'
        AND t.table_schema = 'public'
        AND t.table_name IN ('sessions', 'events', 'calls', 'sites')
        ORDER BY t.table_name, i.indexname
    LOOP
        RAISE NOTICE 'Table: % | Index: % | Size: % | Scans: % | Reads: % | Fetches: %', 
            rec.table_name, rec.indexname, rec.index_size, rec.scans, rec.tuples_read, rec.tuples_fetched;
        RAISE NOTICE '  Definition: %', rec.indexdef;
    END LOOP;
END $$;

-- ============================================
-- QUERY 4: Missing Indexes on Critical Columns
-- ============================================
DO $$
DECLARE
    rec RECORD;
    missing_count INT := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 4: MISSING INDEXES ANALYSIS';
    RAISE NOTICE '========================================';
    
    -- Check for site_id indexes
    FOR rec IN
        SELECT 
            t.table_name,
            c.column_name,
            CASE 
                WHEN EXISTS (
                    SELECT 1 FROM pg_indexes 
                    WHERE tablename = t.table_name 
                    AND indexdef LIKE '%' || c.column_name || '%'
                ) THEN 'EXISTS'
                ELSE 'MISSING'
            END as index_status
        FROM information_schema.columns c
        JOIN information_schema.tables t ON c.table_name = t.table_name
        WHERE t.table_schema = 'public'
        AND c.table_schema = 'public'
        AND c.column_name IN ('site_id', 'created_at', 'created_month', 'session_month', 'status')
        AND t.table_name IN ('sessions', 'events', 'calls')
        AND NOT (t.table_name LIKE '%_2026_%' OR t.table_name LIKE '%_default')
        ORDER BY t.table_name, c.column_name
    LOOP
        IF rec.index_status = 'MISSING' THEN
            missing_count := missing_count + 1;
            RAISE NOTICE '⚠️  MISSING: %.%', rec.table_name, rec.column_name;
        END IF;
    END LOOP;
    
    IF missing_count = 0 THEN
        RAISE NOTICE '✅ All critical columns have indexes';
    ELSE
        RAISE NOTICE '⚠️  Total missing indexes: %', missing_count;
    END IF;
END $$;

-- ============================================
-- QUERY 5: Partition Strategy Verification
-- ============================================
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 5: PARTITION STRATEGY';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT 
            n.nspname as schemaname,
            parent.relname as parent_table,
            child.relname as partition_name,
            pg_size_pretty(pg_total_relation_size(child.oid)) as partition_size,
            (SELECT n_live_tup FROM pg_stat_user_tables WHERE relid = child.oid) as row_count_estimate
        FROM pg_class parent
        JOIN pg_namespace n ON n.oid = parent.relnamespace
        JOIN pg_inherits i ON i.inhparent = parent.oid
        JOIN pg_class child ON child.oid = i.inhrelid
        WHERE n.nspname = 'public'
        AND parent.relkind = 'p'  -- 'p' = partitioned table
        AND parent.relname IN ('sessions', 'events')
        ORDER BY parent.relname, child.relname
    LOOP
        RAISE NOTICE 'Parent: % | Partition: % | Size: % | Rows: %', 
            rec.parent_table, rec.partition_name, rec.partition_size, 
            COALESCE(rec.row_count_estimate::text, 'N/A');
    END LOOP;
END $$;

-- ============================================
-- QUERY 6: RLS Policy Gap Analysis
-- ============================================
DO $$
DECLARE
    rec RECORD;
    policy_rec RECORD;
    policy_count INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 6: RLS POLICY ANALYSIS';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT 
            schemaname,
            tablename,
            rowsecurity as rls_enabled
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN ('sessions', 'events', 'calls', 'sites', 'profiles', 'site_members')
        ORDER BY tablename
    LOOP
        SELECT count(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = rec.schemaname
        AND tablename = rec.tablename;
        
        RAISE NOTICE 'Table: % | RLS Enabled: % | Policies: %', 
            rec.tablename, rec.rls_enabled, policy_count;
        
        -- List policies
        FOR policy_rec IN
            SELECT 
                policyname,
                permissive,
                roles,
                cmd as command,
                qual as using_expression
            FROM pg_policies
            WHERE schemaname = rec.schemaname
            AND tablename = rec.tablename
            ORDER BY policyname
        LOOP
            RAISE NOTICE '  Policy: % | Command: % | Roles: %', 
                policy_rec.policyname, policy_rec.command, policy_rec.roles;
        END LOOP;
    END LOOP;
END $$;

-- ============================================
-- QUERY 7: Touch List - Column Usage Analysis
-- ============================================
-- This query identifies which columns are actually used
-- Note: This is a static analysis - actual usage patterns from codebase

DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 7: TOUCH LIST - COLUMN USAGE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Note: This is based on schema analysis.';
    RAISE NOTICE 'Codebase analysis should be done separately.';
    RAISE NOTICE '';
    
    -- Sessions columns
    RAISE NOTICE 'SESSIONS TABLE COLUMNS:';
    FOR rec IN
        SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'sessions'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE '  - % (%)', rec.column_name, rec.data_type;
    END LOOP;
    
    -- Events columns
    RAISE NOTICE '';
    RAISE NOTICE 'EVENTS TABLE COLUMNS:';
    FOR rec IN
        SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'events'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE '  - % (%)', rec.column_name, rec.data_type;
    END LOOP;
    
    -- Calls columns
    RAISE NOTICE '';
    RAISE NOTICE 'CALLS TABLE COLUMNS:';
    FOR rec IN
        SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'calls'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE '  - % (%)', rec.column_name, rec.data_type;
    END LOOP;
END $$;

-- ============================================
-- QUERY 8: Foreign Key Relationships
-- ============================================
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 8: FOREIGN KEY RELATIONSHIPS';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            tc.constraint_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name IN ('sessions', 'events', 'calls', 'sites', 'site_members')
        ORDER BY tc.table_name, kcu.column_name
    LOOP
        RAISE NOTICE 'Table: % | Column: % → %.%', 
            rec.table_name, rec.column_name, rec.foreign_table_name, rec.foreign_column_name;
    END LOOP;
END $$;

-- ============================================
-- QUERY 9: Query Performance Indicators
-- ============================================
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'QUERY 9: PERFORMANCE INDICATORS';
    RAISE NOTICE '========================================';
    
    FOR rec IN
        SELECT 
            schemaname,
            relname as tablename,
            seq_scan as sequential_scans,
            seq_tup_read as seq_tuples_read,
            idx_scan as index_scans,
            idx_tup_fetch as idx_tuples_fetched,
            n_tup_ins as inserts,
            n_tup_upd as updates,
            n_tup_del as deletes,
            n_live_tup as live_tuples,
            n_dead_tup as dead_tuples,
            CASE 
                WHEN seq_scan + idx_scan > 0 
                THEN ROUND((seq_scan::numeric / (seq_scan + idx_scan)::numeric) * 100, 2)
                ELSE 0
            END as seq_scan_percentage
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        AND relname IN ('sessions', 'events', 'calls', 'sites')
        ORDER BY n_live_tup DESC
    LOOP
        RAISE NOTICE 'Table: %', rec.tablename;
        RAISE NOTICE '  Sequential Scans: % (% percent) | Index Scans: %', 
            rec.sequential_scans, rec.seq_scan_percentage, rec.index_scans;
        RAISE NOTICE '  Inserts: % | Updates: % | Deletes: %', 
            rec.inserts, rec.updates, rec.deletes;
        RAISE NOTICE '  Live Tuples: % | Dead Tuples: %', 
            rec.live_tuples, rec.dead_tuples;
    END LOOP;
END $$;

-- ============================================
-- Final Summary
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'PHASE 0 AUDIT COMPLETE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Review the output above for:';
    RAISE NOTICE '1. Table sizes and row estimates';
    RAISE NOTICE '2. Index coverage (especially site_id, date columns)';
    RAISE NOTICE '3. Partition strategy verification';
    RAISE NOTICE '4. RLS policy gaps';
    RAISE NOTICE '5. Performance indicators';
    RAISE NOTICE '========================================';
END $$;
