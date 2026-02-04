-- Migration: Lazy Antiques Dealer — Proxy Value Strategy (Step 1)
-- Date: 2026-02-04
-- Purpose: Add default_deal_value to sites for tiered proxy valuation when user does not enter price.
-- calls.sale_amount is already nullable (see 20260130100000_casino_kasa_calls_sites.sql).

BEGIN;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS default_deal_value numeric DEFAULT 0;

COMMENT ON COLUMN public.sites.default_deal_value IS 'Average revenue per deal for this site; used when sale_amount is not entered (proxy value from score: 0=0, 1-2=10%%, 3=30%%, 4-5=100%%).';

-- Ensure non-negative when set
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_default_deal_value_non_negative;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_default_deal_value_non_negative
  CHECK (default_deal_value IS NULL OR default_deal_value >= 0);

COMMIT;
