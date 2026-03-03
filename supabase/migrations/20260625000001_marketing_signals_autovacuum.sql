-- =============================================================================
-- Precision Logic: marketing_signals agresif autovacuum (index bloat önleme)
-- Append-only tablo, sık INSERT; dead tuple birikimi index bloat'a yol açar.
-- =============================================================================

ALTER TABLE public.marketing_signals SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 2,
  autovacuum_vacuum_cost_limit = 1000
);

COMMENT ON TABLE public.marketing_signals IS
  'Aggressive autovacuum (scale 0.02) to prevent index bloat on high-insert append-only table.';
