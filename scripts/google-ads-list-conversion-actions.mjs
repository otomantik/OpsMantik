#!/usr/bin/env node
/**
 * List conversion_action resource_name + name for GOOGLE_ADS_CUSTOMER_ID (dotenv from .env.local + .env).
 * Usage: node scripts/google-ads-list-conversion-actions.mjs
 */

import { config as loadEnv } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
loadEnv({ path: join(repoRoot, '.env.local') });
loadEnv({ path: join(repoRoot, '.env') });

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BASE = 'https://googleads.googleapis.com/v20';

function req(name) {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing ${name}`);
  return v.trim();
}

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: req('GOOGLE_ADS_CLIENT_ID'),
    client_secret: req('GOOGLE_ADS_CLIENT_SECRET'),
    refresh_token: req('GOOGLE_ADS_REFRESH_TOKEN'),
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${text.slice(0, 500)}`);
  const j = JSON.parse(text);
  if (!j.access_token) throw new Error('No access_token');
  return j.access_token;
}

async function main() {
  const customerId = req('GOOGLE_ADS_CUSTOMER_ID').replace(/-/g, '');
  const loginId = req('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/-/g, '');
  const developerToken = req('GOOGLE_ADS_DEVELOPER_TOKEN');
  const accessToken = await getAccessToken();

  const query = `
    SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.type
    FROM conversion_action
    ORDER BY conversion_action.name
    LIMIT 50
  `.trim();

  const url = `${BASE}/customers/${customerId}/googleAds:search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'login-customer-id': loginId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('Search failed', res.status, text.slice(0, 1200));
    process.exit(1);
  }
  const data = JSON.parse(text);
  const rows = data.results || [];
  if (!rows.length) {
    console.log('No conversion_action rows returned (empty account or no permissions).');
    process.exit(0);
  }
  console.log('resource_name\tname\tstatus\ttype');
  const parsed = [];
  for (const r of rows) {
    const ca = r.conversionAction || r.conversion_action;
    if (!ca) continue;
    const rn = ca.resourceName || ca.resource_name;
    const nm = ca.name || '';
    const st = ca.status || '';
    const ty = ca.type || '';
    console.log(`${rn}\t${nm}\t${st}\t${ty}`);
    parsed.push({ rn, nm });
  }
  const preferred =
    parsed.find((p) => /OpsMantik_Won/i.test(p.nm)) ||
    parsed.find((p) => /upload|click|offline/i.test(p.nm)) ||
    parsed[0];
  if (preferred?.rn) {
    console.log('\n# Add to .env.local (prefers OpsMantik_Won when present):');
    console.log(`GOOGLE_ADS_CONVERSION_ACTION_RESOURCE_NAME=${preferred.rn}`);
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
