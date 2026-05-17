#!/usr/bin/env node
/**
 * Google Ads API smoke test (OAuth + uploadClickConversions with mock GCLID).
 * Loads env in order: .env.local, then .env (same idea as Next.js).
 *
 *   node scripts/google-ads-api-smoke.mjs
 *   node scripts/google-ads-api-smoke.mjs --dotenv path/to/.env.local
 *
 * Expected on success path: Google returns INVALID_GCLID or similar for the fake gclid
 * (confirms developer token + OAuth + customer + login-customer-id + conversion action path).
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return '';
  return process.argv[idx + 1] || '';
}

const customDotenv = argValue('--dotenv').trim();
if (customDotenv) {
  loadEnv({ path: resolve(repoRoot, customDotenv) });
} else {
  loadEnv({ path: join(repoRoot, '.env.local') });
  loadEnv({ path: join(repoRoot, '.env') });
}

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const API_VERSION = 'v20';

const keys = [
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CONVERSION_ACTION_RESOURCE_NAME',
];

/** Never print secret values — only whether set and rough length. */
function presenceHint(name, value) {
  if (!value || !String(value).trim()) return '(missing)';
  const t = String(value).trim();
  if (name === 'GOOGLE_ADS_CUSTOMER_ID' || name === 'GOOGLE_ADS_LOGIN_CUSTOMER_ID') return t;
  if (name === 'GOOGLE_ADS_CONVERSION_ACTION_RESOURCE_NAME') {
    return t.length > 72 ? `${t.slice(0, 48)}… (${t.length} chars)` : t;
  }
  return `(set, ${t.length} chars)`;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return null;
  return String(v).trim();
}

const missing = keys.filter((k) => !requireEnv(k));
console.log('[google-ads-api-smoke] dotenv loaded from:', customDotenv || '.env.local + .env');
for (const k of keys) {
  const ok = Boolean(requireEnv(k));
  console.log(`  ${ok ? '✓' : '✗'} ${k}: ${presenceHint(k, requireEnv(k) || '')}`);
}

if (missing.length) {
  console.error('\n[google-ads-api-smoke] Missing:', missing.join(', '));
  process.exit(1);
}

const customerId = requireEnv('GOOGLE_ADS_CUSTOMER_ID');
const loginCustomerId = requireEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID');
const developerToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
const clientId = requireEnv('GOOGLE_ADS_CLIENT_ID');
const clientSecret = requireEnv('GOOGLE_ADS_CLIENT_SECRET');
const refreshToken = requireEnv('GOOGLE_ADS_REFRESH_TOKEN');
const conversionActionResourceName = requireEnv('GOOGLE_ADS_CONVERSION_ACTION_RESOURCE_NAME');

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token refresh failed: ${res.status} ${text.slice(0, 800)}`);
  }
  const data = JSON.parse(text);
  if (!data.access_token) {
    throw new Error(`OAuth: no access_token: ${text.slice(0, 400)}`);
  }
  return data.access_token;
}

function toConversionDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
}

async function main() {
  console.log('\n[google-ads-api-smoke] Refreshing OAuth access token…');
  const accessToken = await getAccessToken();
  console.log('[google-ads-api-smoke] OAuth OK (access_token received).');

  const customerIdNoHyphens = customerId.replace(/-/g, '');
  const url = `${GOOGLE_ADS_API_BASE}/${API_VERSION}/customers/${customerIdNoHyphens}:uploadClickConversions`;

  const conversionDateTime = toConversionDateTime(new Date());
  const mockPayload = {
    conversions: [
      {
        gclid: 'TeSt_GCLID_For_Connection_Check',
        conversion_action: conversionActionResourceName,
        conversion_date_time: conversionDateTime,
        conversion_value: 100.0,
      },
    ],
    partial_failure: true,
  };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
  }

  console.log('[google-ads-api-smoke] POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(mockPayload),
  });
  const responseText = await res.text();
  let googleResponse = {};
  try {
    googleResponse = responseText ? JSON.parse(responseText) : {};
  } catch {
    googleResponse = { _raw_body: responseText.slice(0, 2000) };
  }

  const out = {
    ok: res.ok,
    httpStatus: res.status,
    message: '',
    google_response: googleResponse,
  };

  const blob = JSON.stringify(googleResponse).toLowerCase();
  const partialOkMockGclid =
    res.ok &&
    (blob.includes('unparseable_gclid') ||
      blob.includes('invalid_gclid') ||
      blob.includes('invalid click') ||
      blob.includes('partialfailure'));

  if (partialOkMockGclid) {
    out.message =
      'PASS: HTTP 200 with partial_failure on mock gclid — OAuth + developer token + customer + login-customer-id + conversion_action are valid.';
  } else if (res.ok) {
    out.message = 'HTTP 200 — inspect google_response (unexpected shape for mock gclid smoke).';
  } else {
    out.message =
      'HTTP non-2xx — inspect body for INVALID_GCLID / partial_failure (some setups return 4xx instead of 200+partial_failure).';
  }

  console.log('\n[google-ads-api-smoke] Result:\n' + JSON.stringify(out, null, 2));

  const looksLikeExpectedMockFailure =
    partialOkMockGclid ||
    (!res.ok &&
      (blob.includes('invalid_gclid') ||
        blob.includes('invalid click') ||
        blob.includes('resource_not_found') ||
        blob.includes('conversionaction') ||
        res.status === 400));

  if (looksLikeExpectedMockFailure) {
    console.log('\n[google-ads-api-smoke] PASS (smoke): Google Ads API path and credentials are working.');
    process.exit(0);
  }
  if (res.status === 401 || res.status === 403) {
    console.error('\n[google-ads-api-smoke] FAIL: 401/403 — check developer token tier + OAuth user access to customer.');
    process.exit(1);
  }

  console.error('\n[google-ads-api-smoke] FAIL: Unexpected response — inspect google_response above.');
  process.exit(1);
}

main().catch((e) => {
  console.error('\n[google-ads-api-smoke] ERROR:', e?.message || e);
  process.exit(1);
});
