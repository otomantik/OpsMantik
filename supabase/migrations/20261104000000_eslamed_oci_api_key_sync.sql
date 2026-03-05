-- Sync Eslamed Quantum Engine script key with sites.oci_api_key so x-api-key auth succeeds.
-- Script: scripts/google-ads-oci/deploy/Eslamed-OCI-Quantum.js CONFIG.X_API_KEY
-- Site: public_id = 81d957f3c7534f53b12ff305f9f07ae7 (Eslamed)
UPDATE sites
SET oci_api_key = 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1'
WHERE public_id = '81d957f3c7534f53b12ff305f9f07ae7'
  AND (oci_api_key IS DISTINCT FROM 'becaef33f722de5f08691091bbe2cbb7fba0594e56ccbfb4c8a15b3ebedd2cf1');
