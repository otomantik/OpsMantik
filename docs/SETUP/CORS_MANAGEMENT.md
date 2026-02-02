# 🌐 CORS Management & Allowlist Guide

To track events from a new domain, you MUST add its origin to the `ALLOWED_ORIGINS` environment variable in your production environment (e.g., Vercel).

## 📋 Standard Matching Rules (Fail-Closed)

Our API uses strict, scheme-aware matching for maximum security:
1. **Exact Match**: `https://example.com` matches exactly `https://example.com`.
2. **Strict Subdomain**: `https://www.example.com` matches if `https://example.com` is in the list.
3. **Protocol Enforcement**: `http` never matches `https` unless both are explicitly listed.
4. **No wildcards**: Wildcards are disabled in production to prevent data hijacking.

## 🛠️ How to Add a New Site

1. Go to **Vercel Dashboard** -> **Settings** -> **Environment Variables**.
2. Find `ALLOWED_ORIGINS`.
3. Add the target origin(s) separated by commas.
   - **Recommendation**: Always include both apex and www if both serve traffic.
   - Example: `https://sosreklam.com,https://www.sosreklam.com,https://poyrazantika.com,https://www.poyrazantika.com`
4. **IMPORTANT**: You must trigger a **Redeploy** for the changes to take effect. Saving the variable is not enough.

## 🧪 Verification via CLI

Run these tests to verify your configuration:

### 1. Preflight Success (OPTIONS)
```bash
curl -i -X OPTIONS "https://console.opsmantik.com/api/sync" \
  -H "Origin: https://www.poyrazantika.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```
**Expected**: `HTTP 204` or `200` + `Access-Control-Allow-Origin: https://www.poyrazantika.com`

### 2. Blocked Origin (Fail-Closed)
```bash
curl -i -X OPTIONS "https://console.opsmantik.com/api/sync" \
  -H "Origin: https://evil-hacker.com" \
  -H "Access-Control-Request-Method: POST"
```
**Expected**: `HTTP 403` and **NO** `Access-Control-Allow-Origin` header.

### 3. POST Success
```bash
curl -i "https://console.opsmantik.com/api/sync" \
  -H "Origin: https://www.poyrazantika.com" \
  -H "Content-Type: application/json" \
  --data '{"s":"e740358019614bcaaddd81802fa657b6","u":"https://www.poyrazantika.com/test","sid":"test-session-id","sm":"2026-01-01"}'
```
**Expected**: Check for `Access-Control-Allow-Origin` in headers.
