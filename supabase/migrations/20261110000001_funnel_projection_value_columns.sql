-- Add value_cents, currency for V5 export (projection-based export)
ALTER TABLE call_funnel_projection
  ADD COLUMN IF NOT EXISTS value_cents integer,
  ADD COLUMN IF NOT EXISTS currency text;
