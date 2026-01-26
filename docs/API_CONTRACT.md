# API Contract (Source of Truth)

**Last Updated:** 2026-01-27  
**Version:** 1.0.2-bulletproof  
**Status:** Canonical

This document defines the authoritative request/response schemas and security behaviors for the OpsMantik API.

---

## 🔐 Global Security Rules (CORS)

All tracking endpoints enforce a "Fail-Closed" CORS policy.

### CORS Header Behavior
- **Vary:** MUST always include `Origin`.
- **Access-Control-Allow-Origin (ACAO):**
  - **Allowed Origin:** Set to the exact requesting `Origin`.
  - **Denied Origin:** Header MUST be **absent** from the response (no echo, no wildcard).
- **Preflight (OPTIONS):**
  - Allowed: `200 OK`
  - Denied: `403 Forbidden`
- **Actual Request (POST):**
  - Denied: `403 Forbidden`

---

## 🔌 Endpoints

### 1. `POST /api/sync`
Main event tracking endpoint. Accepts compressed atomic payloads.

#### Request Body
```json
{
  "s": "site_public_id (string)",
  "u": "full_url (string)",
  "sid": "session_id (uuid)",
  "sm": "session_month (YYYY-MM-01)",
  "ec": "category (interaction|conversion|acquisition|system)",
  "ea": "action (view|click|scroll|heartbeat|...)",
  "el": "label (string, optional)",
  "ev": "value (number, optional)",
  "meta": { "fp": "fingerprint", "gclid": "...", "duration_sec": 120 },
  "r": "referrer (string, optional)"
}
```

#### Success Response (`200 OK`)
```json
{
  "ok": true,
  "score": 15,
  "status": "synced"
}
```

#### Error Response (`400`, `403`, `404`, `500`)
```json
{
  "ok": false,
  "score": null,
  "message": "Error details here"
}
```

---

### 2. `POST /api/call-event`
Bridge between phone/whatsapp clicks and session matching.

#### Request Body
```json
{
  "site_id": "site_public_id",
  "phone_number": "string",
  "fingerprint": "string"
}
```

#### Success Response (`200 OK`)
```json
{
  "status": "matched",
  "call_id": "uuid",
  "session_id": "uuid|null",
  "lead_score": 75
}
```

---

## 📋 Status Codes Mapping

| Code | Meaning | Response Schema |
|:---|:---|:---|
| `200` | Success | `{ ok: true, ... }` |
| `400` | Validation Fail | `{ ok: false, score: null, message: "Invalid ..." }` |
| `403` | CORS Denied | Redacted (No ACAO header) |
| `404` | Not Found | `{ ok: false, score: null, message: "Site not found" }` |
| `429` | Rate Limited | `{ error: "Rate limit exceeded", retryAfter: 60 }` |
| `500` | Server Error | `{ ok: false, score: null, message: "Internal..." }` |

---

## 📝 Change Log (Doc Drift Fixes)
- **2026-01-27:** Standardized `/api/sync` to `{ ok, score, status }` format.
- **2026-01-27:** Updated CORS semantics to omit ACAO on 403 denial.
- **2026-01-27:** Deprecated legacy `{ status: "synced", score: ... }` format.
