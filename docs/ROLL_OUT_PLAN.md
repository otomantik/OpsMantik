# V2 Rollout Plan (DUAL mode → V2 default → V1 sunset)

## Phase 0 — Ship safely (DUAL mode)
- **Keep V1 working**: browser-signed calls continue to hit `POST /api/call-event`.
- **Introduce V2**: proxy-signed calls hit `POST /api/call-event/v2`.
- **Tracker** prefers proxy:
  - `data-ops-proxy-url` → proxy-first (unsigned from browser)
  - fallback to `data-ops-secret` (legacy V1)

**Success criteria**
- No increase in 5xx for `/api/call-event`.
- Stable call volume and conversion counts.
- 401/429 rates within expectations.

## Phase 1 — V2 default for new installs
- Documentation + onboarding uses **only** `data-ops-proxy-url`.
- WordPress proxy plugin becomes the default recommended integration.
- V1 secret (`data-ops-secret`) marked deprecated in docs.

## Phase 2 — Gradual V1 sunset
- Communicate cutover window per customer.
- Rotate secrets as needed; ensure proxies are installed.
- Add observability dashboards / alerts for:
  - V1 usage percentage
  - V2 success rate
  - 401/429 anomalies

## Phase 3 — Disable V1 (final)
- Remove V1 embed snippets from public docs.
- Optionally gate V1 endpoint behind stricter rules or remove it entirely.

## Rollback plan
- If proxy rollout breaks a customer:
  - Temporarily remove `data-ops-proxy-url` from embed.
  - Use V1 fallback (`data-ops-secret`) while fixing the proxy.
- If signing causes incident:
  - Set `CALL_EVENT_SIGNING_DISABLED=1` (rollback only).
  - Verify `/api/health` shows `signing_disabled: true` in production and Sentry warning is emitted.

