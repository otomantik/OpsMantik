-- PR-9J.5: per-site Google Ads script heartbeat/version registry.

BEGIN;

CREATE TABLE IF NOT EXISTS public.oci_script_versions (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  script_version text NOT NULL,
  script_hash text NULL,
  last_modified text NULL,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oci_script_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oci_script_versions FROM PUBLIC;
REVOKE ALL ON TABLE public.oci_script_versions FROM anon;
REVOKE ALL ON TABLE public.oci_script_versions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oci_script_versions TO service_role;

COMMIT;
