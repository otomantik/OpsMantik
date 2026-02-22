# Call-Event Consent Hardening

**Scope:** Backend engine only. No UI. No schema refactor.  
**Objective:** Ensure call-event ingestion is fully compliant with consent invariants.

---

## Route Order (Frozen)

```
1) HMAC verify     ← MUST be first. Consent before HMAC = signature brute-force risk.
2) Replay check
3) Rate limit
4) Session lookup
5) Analytics consent gate
6) Insert
7) OCI enqueue (on seal)
```

---

## 1. Analytics Consent Gate

| Condition | Action |
|-----------|--------|
| No matched session | 204, header `x-opsmantik-consent-missing: analytics`, no insert |
| Session exists, `analytics` ∉ consent_scopes | 204, same header, no insert |
| Session exists, `analytics` ∈ consent_scopes | Proceed to insert |

**Side-channel mitigation:** 204 response is identical for (no session) and (no analytics) — same body (null), same headers. Prevents session-existence inference via response differences.

---

## 2. Marketing Consent on OCI Enqueue

Before any insert into `offline_conversion_queue`:
- `hasMarketingConsentForCall(siteId, callId)` must be true
- Enforced in: `enqueueSealConversion`, `PipelineService`, `confirm_sale_and_enqueue` RPC

---

## 3. Consent Escalation Prevention

Call-event must NOT:
- Set or modify consent_scopes
- Modify session consent fields
- Accept consent fields in payload

**Reject 400** if payload contains: `consent_scopes`, `consent_at`

---

## 4. Replay & Abuse Guard

- **HMAC:** `verify_call_event_signature_v1` (timestamp ±5 min)
- **Replay cache:** 10 min TTL. Key: `siteId + sha256(signature)` — signature preferred over eventId to prevent replay bypass via client-generated eventId
- **Rate limit:** Per site|proxy|client: 150/min (v2), 80/min (v1). Per fingerprint: 20/min (brute-force probing guard)

---

## 5. SQL / Index Requirements

- `sessions(site_id, id, created_month)` — consent lookup by session id
- `idx_sessions_site_fingerprint` on `sessions(site_id, fingerprint)` — tenant-scoped fingerprint lookups (export, erase, match); avoids full scan under load

---

## 6. Smoke Test

```bash
# A) No session → 204
# POST /api/call-event/v2 with fingerprint that has no matching session
# Expect: 204, x-opsmantik-consent-missing: analytics

# B) Session without analytics consent → 204
# Create session with consent_scopes=[] or ['marketing'] only, then POST call-event
# Expect: 204

# C) Payload with consent_scopes → 400
curl -X POST "$BASE/api/call-event/v2" \
  -H "Content-Type: application/json" \
  -H "X-Ops-Site-Id: $SITE" \
  -H "X-Ops-Ts: $(date +%s)" \
  -H "X-Ops-Signature: $SIG" \
  -d '{"site_id":"'$SITE'","fingerprint":"fp1","consent_scopes":["analytics"]}'
# Expect: 400, consent_scopes not allowed
```

---

## 7. Rollback Notes

1. Revert analytics gate: remove consent check block; restore insert when matchedSessionId is null
2. Revert consent rejection: remove `consent_scopes`/`consent_at` payload check
3. `match-session-by-fingerprint` change is backward-compatible (adds consentScopes field)
