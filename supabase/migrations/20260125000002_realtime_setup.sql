-- Enable Realtime for partitioned tables
-- Note: Realtime requires REPLICA IDENTITY FULL for partitioned tables

-- Enable Realtime publication (check if exists first)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- Add tables to Realtime publication (ignore errors if already added)
-- SQLSTATE 42710 = "already member of publication"
DO $$
BEGIN
    -- Add events table
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE events;
    EXCEPTION
        WHEN OTHERS THEN
            -- Ignore if already in publication (SQLSTATE 42710)
            IF SQLSTATE != '42710' THEN RAISE; END IF;
    END;

    -- Add calls table
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE calls;
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLSTATE != '42710' THEN RAISE; END IF;
    END;

    -- Add sessions table
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLSTATE != '42710' THEN RAISE; END IF;
    END;
END $$;

-- Set REPLICA IDENTITY FULL for partitioned tables (required for Realtime)
-- Note: This must be done on the parent table, not partitions
ALTER TABLE events REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;

-- Calls table (not partitioned, but ensure Realtime works)
ALTER TABLE calls REPLICA IDENTITY FULL;
