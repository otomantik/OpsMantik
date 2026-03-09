-- Ensure pgcrypto extension for gen_random_bytes() used by sites_before_insert_identity trigger.
-- Without this, site creation fails with: function gen_random_bytes(integer) does not exist (42883).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMENT ON EXTENSION pgcrypto IS 'Required for sites_before_insert_identity (public_id and oci_api_key generation).';
