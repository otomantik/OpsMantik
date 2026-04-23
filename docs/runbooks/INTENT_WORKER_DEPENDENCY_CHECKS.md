# Intent Worker Dependency Checks

Use this checklist when `/api/sync` accepts events but intents do not appear.

## 1) Environment contract

Run:

```bash
npm run smoke:intent-worker-deps
```

Must be present:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `NEXT_PUBLIC_APP_URL` (or `VERCEL_URL` fallback must resolve absolute URL)

## 2) Worker auth/delivery contract

- QStash delivery must hit `/api/workers/ingest/telemetry` (or conversion lane).
- Signature check must pass (`lib/qstash/require-signature.ts`).
- In local-only mode, direct worker can be enabled with:
  - `OPSMANTIK_SYNC_DIRECT_WORKER=1`
  - `ALLOW_INSECURE_DEV_WORKER=true`

## 3) Gate diagnostics

Worker now logs `WORKERS_INGEST_GATE_REJECT` with:

- `reason`
- `site_id`
- `lane`
- `qstash_message_id`
- `ingest_id`
- `trace_id`

If this log appears, inspect `reason` first:

- `duplicate`
- `quota_reject`
- `entitlements_reject`
- `idempotency_error`

## 4) Data confirmation sequence

For the same trace/request:

1. `processed_signals` row exists
2. `events` row exists
3. `calls` row exists
4. queue RPC (`get_recent_intents_lite_v1`) returns row

If step 1 fails -> delivery/gate issue.  
If step 1 passes but 2/3 fails -> processing/RPC issue.  
If 1/2/3 pass but queue empty -> visibility/filter issue.
