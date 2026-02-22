# Production Go-Live: GDPR + Call-Event Consent Hardening

**Scope:** Production rollout only. No new features. No UI.
**Artifacts:** Go/No-Go checklist, phased rollout, rollback playbook.

---

## 1. Go/No-Go Checklist

| # | Check | Expected | Status |
|---|-------|----------|--------|
| 1 | idx_sessions_site_fingerprint exists | See SQL below; indexdef must include (site_id, fingerprint). If missing: apply OPTIONAL_idx_sessions_site_fingerprint.sql manually. | [] |
| 2 | Replay cache key = siteId + sha256(signature) | ReplayCacheService uses signature when available | [] |
| 3 | Replay cache TTL = 10 min | checkAndStore 10*60*1000 | [] |
| 4 | Marketing check in confirm_sale_and_enqueue | RPC checks marketing in consent_scopes | [] |
| 5 | Sync consent gate before idempotency | validateSiteFn before consentScopes before tryInsert | [] |
| 6 | Call-event HMAC before consent | HMAC verify then Replay then Rate limit then Session then Consent | [] |
| 7 | Call-event 204 same for no-session and no-analytics | Single CONSENT_MISSING_HEADERS response | [] |
| 8 | Smoke script passes | node scripts/smoke/prod-gdpr-call-event.mjs exit 0 | [] |
| 9 | **Replay test** | Same signature, 2nd request → 200 + `status: 'noop'` (idempotent). Smoke script covers replay (test E). | [] |
| 10 | Replay second attempt returns noop (no duplicate insert) | Smoke test E passes | [] |
| 11 | Fingerprint rate limit 429 confirmed | Manual abuse test: >20 req/min per fingerprint → 429 | [] |
| 12 | No unexpected 500s under abuse simulation | Phase 2 gate | [] |
| 13 | calls_site_signature_hash_uq exists | Partial unique index on calls(site_id, signature_hash) WHERE signature_hash IS NOT NULL | [] |

**idx_sessions_site_fingerprint verification SQL:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'sessions'
  AND indexname = 'idx_sessions_site_fingerprint';
```
Expected: 1 row; indexdef must include `(site_id, fingerprint)`. If missing, apply `supabase/migrations/OPTIONAL_idx_sessions_site_fingerprint.sql` manually. DO NOT auto-apply.

**calls_site_signature_hash_uq verification:**
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'calls' AND indexname = 'calls_site_signature_hash_uq';
```
Expected: 1 row; indexdef must include `(site_id, signature_hash)` and `WHERE signature_hash IS NOT NULL`.

**Call-event execution order (frozen):**
1. HMAC verify → 2. Replay check → 3. Rate limit → 4. Session lookup → 5. Analytics consent gate → 6. Insert call → 7. Marketing enqueue check  
Any deviation from this order breaks compliance invariants.

### Optional (e) — OCI enqueue skip when marketing missing
- Create session with consent_scopes=[] or ['analytics'] only.
- Seal a call, trigger confirm_sale_and_enqueue. Assert OCI enqueue is skipped.
- Cannot be fully automated without DB/env; run manually if required.

---

## 2. Phased Rollout Plan

### Phase 1: Soft Deploy (24-48h)
- Deploy code to production. No traffic diversion.
- Run smoke script post-deploy.
- Monitor error_rate for /api/sync and /api/call-event/v2.
- **Gate criteria:**
  - /api/sync error_rate < baseline + 0.5%
  - /api/call-event/v2 error_rate &lt; 1%
  - 204 consent ratio within expected range (0–30%)
  - replay_reject_count spike threshold alert configured

### Phase 2: Abuse Tests (24h)
- Run 204/400 paths to verify gates.
- **Replay test:** Send same signed payload twice; 2nd request must return 200 + `status: 'noop'` (no duplicate insert).
- Confirm fingerprint rate limit 429.
- Gate: No unexpected 500s.

### Phase 3: Monitoring Lock (7 days)
- Add counters (see MONITORING_METRICS_GDPR_CALL_EVENT.md).
- Configure alerts. Gate: No critical alerts.
- **Abuse indicators:** Spikes in `fingerprint_rate_limit_count`, `replay_reject_count`, `oci_enqueue_skipped_marketing_missing_count` may indicate abuse or probing — investigate.

---

## 3. Rollback Playbook

### What to Revert
1. **Sync / Call-event:** Temporarily disable consent enforcement via config flag if emergency. Do NOT reorder sync execution unless catastrophic failure. Compliance order must remain frozen.
2. Consent rejection: Remove consent_scopes/consent_at payload check (call-event).
3. Replay key: Revert to prefer eventId over signature (only if necessary).
4. Fingerprint rate limit: Remove per-fingerprint block (only if necessary).

### What NOT to Drop
- Do NOT drop idx_sessions_site_fingerprint.
- Do NOT drop gdpr/audit migrations without separate rollback.
- Do NOT drop confirm_sale marketing check without product sign-off.
