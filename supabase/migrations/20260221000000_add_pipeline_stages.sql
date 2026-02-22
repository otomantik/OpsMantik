-- Up Migration
ALTER TABLE public.sites
ADD COLUMN pipeline_stages JSONB DEFAULT '[
  {
    "id": "junk",
    "label": "Junk / Çöp",
    "value_cents": 0,
    "is_macro": false,
    "color": "destructive",
    "order": 0,
    "is_system": true
  },
  {
    "id": "intent",
    "label": "Yeni İletişim",
    "value_cents": 1000,
    "is_macro": false,
    "color": "secondary",
    "order": 1,
    "is_system": true
  },
  {
    "id": "sealed",
    "label": "Satış Kapanışı (Seal)",
    "value_cents": 500000,
    "is_macro": true,
    "color": "default",
    "order": 99,
    "is_system": true
  }
]'::jsonb;

-- Add a GIN index for high-performance JSONB querying
CREATE INDEX idx_sites_pipeline_stages ON public.sites USING GIN (pipeline_stages);

-- Down Migration (for rollback purposes, keep commented out at the bottom or separate if using a specific tool)
-- DROP INDEX IF EXISTS public.idx_sites_pipeline_stages;
-- ALTER TABLE public.sites DROP COLUMN IF EXISTS pipeline_stages;
