# AI Score Pipeline Gate — Diagnostic Runbook

**Purpose:** Verify the AI score pipeline is configured (no pipeline code changes). Run the smoke script for automated checks; use this runbook for manual verification.

---

## 1. Env: OPENAI_API_KEY

- **Edge Function** (hunter-ai) uses **Supabase Edge Function secrets**, not `.env.local`.
- **Check:** Dashboard → Edge Functions → hunter-ai → **Secrets** → `OPENAI_API_KEY` must be set (value must not be shown in runbook or script output).
- **Local/CI:** If you run something that needs the key locally, set `OPENAI_API_KEY` in env; **never print or log it**.

**Smoke:** Script checks `process.env.OPENAI_API_KEY` exists (truthy); does **not** print the value. If missing in process env, script reports "OPENAI_API_KEY not in process env" (Edge Function uses Dashboard secrets).

---

## 2. hunter-ai Function Deployed / Reachable

- **Check:** Supabase Dashboard → **Edge Functions** → list includes **hunter-ai**.
- **Deploy:** `supabase functions deploy hunter-ai` (with `supabase link`).
- **Reachable:** HTTP POST to `{SUPABASE_URL}/functions/v1/hunter-ai` with `Authorization: Bearer {service_role_key}` and JSON body. Response **404** = not deployed; **400/401/500** = deployed (auth or payload issue).

**Smoke:** POST to hunter-ai URL with service role; no secrets in output. **404** → FAIL (not deployed). Non-404 → function is reachable.

---

## 3. pg_net Enabled

- **Check:** Dashboard → **Database** → **Extensions** → **pg_net** = Enabled.
- **SQL:** `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net');` → `t`.

**Smoke:** Calls RPC `public.ai_pipeline_gate_checks()` which returns `pg_net_enabled: true/false` (no raw SQL from client).

---

## 4. Trigger Path: calls INSERT → sessions.ai_score Update

1. **INSERT** into `public.calls` with `source = 'click'` and `intent_action IN ('phone','whatsapp')`.
2. **Trigger** `calls_notify_hunter_ai` (AFTER INSERT ON public.calls) runs.
3. Trigger reads **private.api_keys** (`project_url`, `service_role_key`), then **pg_net.http_post** to `{project_url}/functions/v1/hunter-ai`.
4. **hunter-ai** Edge Function receives payload, fetches session/timeline, calls OpenAI, **UPDATEs** `sessions` SET `ai_score`, `ai_summary`, `ai_tags` for `matched_session_id`.

**Check trigger exists:** `SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'calls' AND t.tgname = 'calls_notify_hunter_ai');` → `t`.

**Check api_keys:** `SELECT key_name FROM private.api_keys WHERE key_name IN ('project_url','service_role_key');` → 2 rows (do **not** select key_value).

**Smoke:** RPC `ai_pipeline_gate_checks()` returns `trigger_exists`, `api_keys_configured`; smoke asserts both true for PASS.

---

## Smoke Script

- **Script:** `scripts/smoke/ai-pipeline-gate.mjs`
- **Run:** `npm run smoke:ai-pipeline-gate`
- **Checks:** OPENAI_API_KEY in process env (not printed), hunter-ai reachable (POST, no 404), RPC `ai_pipeline_gate_checks()` → pg_net_enabled, trigger_exists, api_keys_configured.
- **Output:** PASS or FAIL; **no secrets printed**.

**Prerequisite:** Migration `20260130251300_ai_pipeline_gate_checks.sql` applied so the RPC exists.

---

## Proof

- **Script output:** Run `npm run smoke:ai-pipeline-gate`; output is PASS or FAIL plus one-line status per check. No secret values appear (OPENAI_API_KEY, service_role_key, or `private.api_keys` values are never printed).
- **No secrets printed:** The script only reports "OPENAI_API_KEY: set (not printed)" or "not in process env"; hunter-ai uses status code only; RPC returns booleans (`pg_net_enabled`, `trigger_exists`, `api_keys_configured`), not key values.
