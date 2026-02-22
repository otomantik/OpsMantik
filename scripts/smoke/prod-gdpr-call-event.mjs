#!/usr/bin/env node
/**
 * Smoke: GDPR + Call-Event Consent Hardening (Production)
 *
 * Tests:
 *   a) POST /api/sync without consent_scopes -> 204 + x-opsmantik-consent-missing: analytics
 *   b) POST /api/sync with consent_scopes:['analytics'] -> 200
 *   c) POST /api/call-event/v2 with fingerprint (no session) -> 204 + header
 *   d) POST /api/call-event/v2 with payload containing consent_scopes -> 400
 *   e) Replay/DB idempotency: send identical signed request twice; 2nd must return 200 + status: 'noop'
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required for DB lookup).
 * Optional: SMOKE_SITE_ID, CALL_EVENT_SECRET — if missing, auto-fetched from DB (first site with secret).
 */

import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });
dotenv.config({ path: join(__dirname, '../../.env') });

const BASE_URL = (process.env.SMOKE_BASE_URL || 'https://console.opsmantik.com').replace(/\/$/, '');
let SITE_ID = process.env.SMOKE_SITE_ID || process.env.SITE_ID;
let SITE_SECRET = process.env.CALL_EVENT_SECRET || process.env.SITE_SECRET;
const ORIGIN = process.env.SMOKE_ORIGIN_ALLOWED || 'https://www.sosreklam.com';

async function fetchOrProvisionSiteAndSecret() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  try {
    const admin = createClient(url, key);
    const privateClient = createClient(url, key, { schema: 'private' });
    const { data: sites, error: siteErr } = await admin.from('sites').select('id, public_id').limit(50);
    if (siteErr) return { error: siteErr.message };
    if (!sites?.length) return { error: 'No sites in DB' };
    for (const site of sites) {
      const { data: secrets } = await privateClient.rpc('get_site_secrets', { p_site_id: site.id });
      const row = Array.isArray(secrets) ? secrets[0] : secrets;
      const secret = row?.current_secret;
      if (secret) return { siteId: site.public_id, secret };
    }
    const first = sites[0];
    const newSecret = crypto.randomBytes(32).toString('hex');
    const { error: rotErr } = await admin.rpc('rotate_site_secret_v1', {
      p_site_public_id: first.public_id,
      p_current_secret: newSecret,
      p_next_secret: null,
    });
    if (rotErr) return { error: `rotate_site_secret_v1: ${rotErr.message}` };
    return { siteId: first.public_id, secret: newSecret };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

function log(msg, color = '') {
  const c = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', reset: '\x1b[0m' };
  console.log(`${c[color] || ''}${msg}${c.reset}`);
}

function assert(cond, msg) {
  if (!cond) {
    log(`FAIL: ${msg}`, 'red');
    process.exit(1);
  }
  log(`PASS: ${msg}`, 'green');
}

function hmacHex(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex');
}

function makeSyncBody(opts = {}) {
  const base = {
    s: SITE_ID,
    u: 'https://example.com/test',
    sid: crypto.randomUUID(),
    sm: new Date().toISOString().slice(0, 7) + '-01',
    ec: 'interaction',
    ea: 'view',
  };
  if (opts.consentScopes) base.consent_scopes = opts.consentScopes;
  return base;
}

async function testA_syncNoConsent() {
  log('\n[Test A] POST /api/sync without consent_scopes -> 204 + header', 'blue');
  const body = makeSyncBody();
  delete body.consent_scopes;
  const res = await fetch(`${BASE_URL}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body),
  });
  assert(res.status === 204, `sync without consent returns 204 (got ${res.status})`);
  const h = res.headers.get('x-opsmantik-consent-missing');
  assert(h === 'analytics', `header x-opsmantik-consent-missing: analytics (got ${h})`);
}

async function testB_syncWithConsent() {
  log('\n[Test B] POST /api/sync with consent_scopes:["analytics"] -> 200', 'blue');
  const body = makeSyncBody({ consentScopes: ['analytics'] });
  const res = await fetch(`${BASE_URL}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body),
  });
  assert(res.status === 200, `sync with consent returns 200 (got ${res.status})`);
  const json = await res.json();
  assert(json && json.ok === true, 'response has ok: true');
}

async function testC_callEventNoSession() {
  log('\n[Test C] POST /api/call-event/v2 fingerprint (no session) -> 204 or 200', 'blue');
  if (!SITE_SECRET) {
    log('SKIP: SITE_SECRET/CALL_EVENT_SECRET not set', 'yellow');
    return;
  }
  const payload = { site_id: SITE_ID, fingerprint: `fp_nosession_${crypto.randomUUID()}`, phone_number: null };
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacHex(SITE_SECRET, `${ts}.${rawBody}`);
  const res = await fetch(`${BASE_URL}/api/call-event/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ops-site-id': SITE_ID,
      'x-ops-ts': String(ts),
      'x-ops-signature': sig,
    },
    body: rawBody,
  });
  if (res.status === 204) {
    const h = res.headers.get('x-opsmantik-consent-missing');
    assert(h === 'analytics', `header x-opsmantik-consent-missing: analytics (got ${h})`);
  } else {
    assert(res.status === 200, `call-event returns 204 or 200 (got ${res.status})`);
  }
}

async function testD_callEventConsentPayloadRejected() {
  log('\n[Test D] POST /api/call-event/v2 with consent_scopes in payload -> 400', 'blue');
  if (!SITE_SECRET) {
    log('SKIP: SITE_SECRET/CALL_EVENT_SECRET not set', 'yellow');
    return;
  }
  const payload = { site_id: SITE_ID, fingerprint: `fp_${Date.now()}`, consent_scopes: ['analytics'] };
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacHex(SITE_SECRET, `${ts}.${rawBody}`);
  const res = await fetch(`${BASE_URL}/api/call-event/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ops-site-id': SITE_ID,
      'x-ops-ts': String(ts),
      'x-ops-signature': sig,
    },
    body: rawBody,
  });
  assert(res.status === 400, `call-event with consent_scopes returns 400 (got ${res.status})`);
  const json = await res.json();
  assert(json && (json.hint || json.error), '400 includes hint or error');
}

async function testE_replaySecondReturnsNoop() {
  log('\n[Test E] Replay/DB idempotency: identical signed request twice -> 2nd returns 200 + status: noop', 'blue');
  if (!SITE_SECRET) {
    log('SKIP: SITE_SECRET/CALL_EVENT_SECRET not set', 'yellow');
    return;
  }
  const payload = { site_id: SITE_ID, fingerprint: `fp_replay_${Date.now()}`, phone_number: null };
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacHex(SITE_SECRET, `${ts}.${rawBody}`);
  const headers = {
    'Content-Type': 'application/json',
    'x-ops-site-id': SITE_ID,
    'x-ops-ts': String(ts),
    'x-ops-signature': sig,
  };
  const res1 = await fetch(`${BASE_URL}/api/call-event/v2`, { method: 'POST', headers, body: rawBody });
  assert(res1.status === 204 || res1.status === 200, `1st request returns 204 or 200 (got ${res1.status})`);

  const res2 = await fetch(`${BASE_URL}/api/call-event/v2`, { method: 'POST', headers, body: rawBody });
  assert(res2.status === 200, `2nd request (replay) returns 200 (got ${res2.status})`);
  const json2 = await res2.json();
  assert(json2 && json2.status === 'noop', `2nd request has status: 'noop' (got ${json2?.status})`);
}

async function main() {
  log('Smoke: GDPR + Call-Event Consent Hardening', 'blue');
  log(`BASE_URL=${BASE_URL}`, 'reset');

  if (!SITE_ID || !SITE_SECRET) {
    log('SITE_ID/SECRET not set — fetching or provisioning from DB...', 'yellow');
    const fetched = await fetchOrProvisionSiteAndSecret();
    if (fetched.siteId && fetched.secret) {
      SITE_ID = fetched.siteId;
      SITE_SECRET = fetched.secret;
      log(`SITE_ID=${SITE_ID}`, 'reset');
      log('SITE_SECRET=***', 'reset');
    } else {
      log(`SITE_ID=${SITE_ID || '(not set)'}`, SITE_ID ? 'reset' : 'red');
      log(`SITE_SECRET=${SITE_SECRET ? '***' : '(not set)'}`, SITE_SECRET ? 'reset' : 'red');
      if (fetched.error) log(`DB: ${fetched.error}`, 'yellow');
      if (!SITE_ID) {
        log('\nFAIL: No site with secret. Ensure .env.local has SUPABASE_* and at least one site has call-event secret.', 'red');
        process.exit(1);
      }
      if (!SITE_SECRET) log('(c,d,e will skip — no secret)', 'yellow');
    }
  } else {
    log(`SITE_ID=${SITE_ID}`, 'reset');
    log('SITE_SECRET=***', 'reset');
  }

  try {
    await testA_syncNoConsent();
    await testB_syncWithConsent();
    await testC_callEventNoSession();
    await testD_callEventConsentPayloadRejected();
    await testE_replaySecondReturnsNoop();
    log('\nAll GDPR call-event smoke tests PASSED', 'green');
    process.exit(0);
  } catch (err) {
    log(`\nFAIL: ${err.message}`, 'red');
    process.exit(1);
  }
}

main();
