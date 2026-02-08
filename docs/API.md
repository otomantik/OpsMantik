# OpsMantik - API Specification

## 🔐 Global Security Logic

### CORS Policy (Fail-Closed)
All tracking endpoints enforce a strict "Fail-Closed" CORS policy to prevent unauthorized data injection.
- **Allowed Origins**: Requests from domains not on the explicit allowlist (configured in `ALLOWED_ORIGINS` env var) will return a `403 Forbidden`.
- **Preflight (OPTIONS)**: Denied origins will result in an immediate `403` with no `Access-Control-Allow-Origin` header returned.
- **Vary Header**: Success responses always include `Vary: Origin`.

### Rate Limiting
Endpoints are protected by Redis-backed rate limiting to prevent DoS attacks.
- `/api/sync`: 100 requests per minute per IP.
- `/api/call-event`: 50 requests per minute per IP.

---

## 🔌 Primary Endpoints

### 1. `POST /api/sync`
The primary ingestion point for event tracking and session heartbeats.

#### Request Body (Ingest Payload)
Keys are abbreviated to minimize payload size during high-frequency tracking.
```json
{
  "s": "site_public_id",
  "u": "full_url (string)",
  "sid": "session_id (uuid)",
  "sm": "session_month (YYYY-MM-01)",
  "ec": "category (interaction | conversion | system)",
  "ea": "action (view | click | scroll | heartbeat)",
  "el": "label (optional string)",
  "ev": "value (optional number)",
  "meta": {
    "fp": "fingerprint",
    "gclid": "google_click_id (optional)",
    "duration_sec": 120
  },
  "r": "referrer (string)"
}
```

#### Responses
- **`200 OK`**: `{ "ok": true, "score": number, "status": "synced" }`
- **`400 Bad Request`**: Structural or business validation failure.
- **`429 Too Many Requests`**: Rate limit exceeded.

---

### 2. `POST /api/call-event/v2`
Captures conversion signals from first-party proxies or UI clicks and matches them to an existing tracked session.

#### Request Body
```json
{
  "event_id": "uuid",
  "site_id": "site_public_id",
  "phone_number": "string",
  "fingerprint": "string",
  "action": "phone | whatsapp",
  "url": "full_origin_url"
}
```

#### Security
This endpoint requires a cryptographic signature in the `X-Ops-Signature` header calculated using the site's secret key, unless explicitly disabled for development.

#### Responses
- **`200 OK`**: `{ "status": "matched", "session_id": "uuid", "lead_score": 85 }`
- **`401 Unauthorized`**: Signature mismatch or missing secret.

---

### 3. `GET /api/health`
Monitoring endpoint for uptime verification and system diagnostics.

#### Responses
- **`200 OK`**: `{ "status": "healthy", "version": "v1.x.x", "timestamp": "ISO-DATE" }`

---

## 📋 Status Code Definitions

| Code | Meaning | Outcome |
|:---|:---|:---|
| `200` | Success | Operation confirmed; data queued/saved. |
| `400` | Validation Fail | Check payload structure or missing required fields. |
| `401` | Unauthorized | Signature verification failed (Call-Event only). |
| `403` | Forbidden | Domain not on CORS allowlist. |
| `429` | Rate Limit | Too many requests from this IP. |
| `500` | Server Error | Check Sentry logs for underlying exception. |
