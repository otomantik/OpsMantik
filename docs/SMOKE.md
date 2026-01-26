# API Smoke Testing Guide

**Last Updated:** 2026-01-27  
**Status:** Canonical

This document explains how to perform automated health checks on the production API.

---

## 🚀 Execution Commands

### 1. Local Production Test
Run this to verify the LIVE console endpoints.

```powershell
# Required environment variables
$env:SMOKE_BASE_URL="https://console.opsmantik.com"
$env:SMOKE_SITE_ID="e740358019614bcaaddd81802fa657b6" # Format: public_id (32 chars)
$env:SMOKE_ORIGIN_ALLOWED="https://www.sosreklam.com"

npm run smoke:api
```

### 2. Local Development Test
Run this while `npm run dev` is active.

```powershell
$env:SMOKE_BASE_URL="http://localhost:3000"
$env:SMOKE_SITE_ID="your_test_site_id"
npm run smoke:api
```

---

## 🔑 Configuration & Secrets

The smoke test requires specific values to pass successfully.

### `SMOKE_SITE_ID` (Critical)
- **What it is:** The `public_id` of a site (the 32-character key generated when a site is created).
- **Where to find it:** In the database `sites` table (`public_id` column) or via the Admin Dashboard.
- **Type:** String (not the database internal UUID `id`).

### GitHub Secrets
Production CI/CD uses these secrets:
- `SMOKE_BASE_URL`: Base URL of the deployment.
- `SMOKE_SITE_ID`: Valid site key for testing payloads.
- `SMOKE_ORIGIN_ALLOWED`: A domain listed in your `ALLOWED_ORIGINS` config.

---

## 🧪 Test Cases & Expectations

| Test | Endpoint | Success Criteria | Security Behavior |
|:---|:---|:---|:---|
| **CORS Allow** | `OPTIONS` | `200 OK` | `ACAO` header matches requested Origin. |
| **CORS Deny** | `OPTIONS` | `403 Forbidden` | `ACAO` header is **ABSENT** (No echo). |
| **Validation** | `POST` | `400 Bad Request` | Returns `{ ok: false, score: null, ... }`. |
| **Happy Path** | `POST` | `200 OK` | Returns `{ ok: true, score: <num>, status: "synced" }`. |

---

## 🔴 Troubleshooting FAIL Results

1.  **Deny test returns 200:** The server is not strictly enforcing CORS. Check `lib/cors.ts` and `ALLOWED_ORIGINS` env var.
2.  **Happy Path returns 404:** The `SMOKE_SITE_ID` Provided does not exist in the database.
3.  **Happy Path returns 403:** The `SMOKE_ORIGIN_ALLOWED` env var does not match any entry in the server's `ALLOWED_ORIGINS` list.
