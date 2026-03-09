-- Funnel Kernel: call_funnel_ledger, call_funnel_projection, funnel_invariant_violations
-- OpsMantik Funnel Kernel Charter v1
-- See: docs/architecture/FUNNEL_CONTRACT.md, PROJECTION_REDUCER_SPEC.md

-- call_funnel_ledger: append-only event table
CREATE TABLE IF NOT EXISTS call_funnel_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'V2_CONTACT','V2_SYNTHETIC','V3_QUALIFIED','V4_INTENT','V5_SEALED',
    'REPAIR_ATTEMPTED','REPAIR_COMPLETED','REPAIR_FAILED'
  )),
  event_family text NOT NULL DEFAULT 'FUNNEL' CHECK (event_family IN ('FUNNEL','ATTRIBUTION','EXPORT','OPERATOR')),
  event_source text NOT NULL CHECK (event_source IN ('TRACK','SYNC','CALL_EVENT','OUTBOX_CRON','SEAL_ROUTE','WORKER','REPAIR')),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  causation_id uuid,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  policy_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_ledger_idempotency ON call_funnel_ledger(site_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_funnel_ledger_call_site ON call_funnel_ledger(call_id, site_id);
CREATE INDEX IF NOT EXISTS idx_funnel_ledger_site_created ON call_funnel_ledger(site_id, created_at DESC);

-- call_funnel_projection: one row per call_id, SSOT for export
CREATE TABLE IF NOT EXISTS call_funnel_projection (
  call_id uuid PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  highest_stage text NOT NULL CHECK (highest_stage IN ('V2','V3','V4','V5')),
  current_stage text NOT NULL DEFAULT 'V2' CHECK (current_stage IN ('V2','V3','V4','V5','WAITING_FOR_ATTRIBUTION')),
  v2_at timestamptz,
  v3_at timestamptz,
  v4_at timestamptz,
  v5_at timestamptz,
  v2_source text CHECK (v2_source IN ('REAL','SYNTHETIC')),
  synthetic_flags_json jsonb,
  quality_score smallint CHECK (quality_score IS NULL OR (quality_score BETWEEN 1 AND 5)),
  confidence numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  attribution_status text CHECK (attribution_status IN ('FULL','PARTIAL','NONE','PENDING')),
  funnel_completeness text NOT NULL DEFAULT 'incomplete' CHECK (funnel_completeness IN ('incomplete','partial','complete')),
  export_status text NOT NULL DEFAULT 'NOT_READY' CHECK (export_status IN ('NOT_READY','READY','EXPORTED','ACKED','FAILED','BLOCKED')),
  export_ready boolean GENERATED ALWAYS AS (export_status = 'READY') STORED,
  missing_requirements_json jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_proj_site_export ON call_funnel_projection(site_id, export_status, v5_at DESC) WHERE export_status IN ('READY','EXPORTED','ACKED');

-- funnel_invariant_violations: operational audit, duplicate suppression
CREATE TABLE IF NOT EXISTS funnel_invariant_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  violation_code text NOT NULL,
  details_json jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_violations_open_unique
  ON funnel_invariant_violations(site_id, call_id, violation_code)
  WHERE resolved_at IS NULL;
