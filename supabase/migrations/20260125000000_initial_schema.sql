-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sites table (multi-tenant)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    public_id TEXT NOT NULL UNIQUE,
    domain TEXT,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table (partitioned by month)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    ip_address INET,
    entry_page TEXT,
    exit_page TEXT,
    gclid TEXT,
    wbraid TEXT,
    gbraid TEXT,
    total_duration_sec INTEGER DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    created_month DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_month);

-- Events table (partitioned by month)
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    session_month DATE NOT NULL,
    url TEXT NOT NULL,
    event_category TEXT NOT NULL,
    event_action TEXT NOT NULL,
    event_label TEXT,
    event_value NUMERIC,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (session_id, session_month) REFERENCES sessions(id, created_month) ON DELETE CASCADE
) PARTITION BY RANGE (session_month);

-- Calls table (phone call tracking)
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    matched_session_id UUID,
    matched_fingerprint TEXT,
    lead_score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User credentials (OAuth tokens for Google Ads API)
CREATE TABLE IF NOT EXISTS user_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_public_id ON sites(public_id);
CREATE INDEX IF NOT EXISTS idx_sessions_site_id ON sessions(site_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_month ON sessions(created_month);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session_month ON events(session_month);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(event_category);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_calls_site_id ON calls(site_id);
CREATE INDEX IF NOT EXISTS idx_calls_matched_session ON calls(matched_session_id);

-- Create partitions for current month
DO $$
DECLARE
    current_month DATE := DATE_TRUNC('month', CURRENT_DATE);
    next_month DATE := current_month + INTERVAL '1 month';
    partition_name_sessions TEXT;
    partition_name_events TEXT;
BEGIN
    -- Sessions partition
    partition_name_sessions := 'sessions_' || TO_CHAR(current_month, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF sessions FOR VALUES FROM (%L) TO (%L)',
        partition_name_sessions, current_month, next_month);
    
    -- Events partition
    partition_name_events := 'events_' || TO_CHAR(current_month, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
        partition_name_events, current_month, next_month);
END $$;

-- Row Level Security
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own sites"
    ON sites FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sites"
    ON sites FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sites"
    ON sites FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view sessions for their sites"
    ON sessions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM sites WHERE sites.id = sessions.site_id AND sites.user_id = auth.uid()
    ));

CREATE POLICY "Users can view events for their sites"
    ON events FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM sites 
        JOIN sessions ON sites.id = sessions.site_id 
        WHERE sessions.id = events.session_id AND sites.user_id = auth.uid()
    ));

CREATE POLICY "Users can view calls for their sites"
    ON calls FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM sites WHERE sites.id = calls.site_id AND sites.user_id = auth.uid()
    ));

CREATE POLICY "Users can manage their own credentials"
    ON user_credentials FOR ALL
    USING (auth.uid() = user_id);
