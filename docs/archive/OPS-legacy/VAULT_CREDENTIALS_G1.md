# PR-G1: Vault & Provider Credentials

- **Table:** `public.provider_credentials` (encrypted ad provider credentials per site).
- **Encryption:** Libsodium sealed box (`crypto_box_seal`). Key derived from `OPSMANTIK_VAULT_KEY` (base64 32-byte seed).
- **RLS:** Authenticated users can INSERT/UPDATE/SELECT only for sites they can access (`can_access_site`). API must never return `encrypted_payload` to the client; worker uses service_role to decrypt server-side.
- **Endpoints:**
  - `POST /api/providers/credentials` — body: `site_id`, `provider_key`, `credentials_json`; response: `{ ok: true }`.
  - `POST /api/providers/credentials/test` — body: `site_id`, `provider_key`; server decrypts and calls `provider.verifyCredentials()`.
- **Env:** `OPSMANTIK_VAULT_KEY`: base64-encoded 32-byte seed. Generate with `openssl rand -base64 32` or equivalent. Rotating the key invalidates existing ciphertexts.
