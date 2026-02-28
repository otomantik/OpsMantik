/**
 * Iron Seal — Identity Boundary & Handshake
 *
 * Tests POST /api/oci/v2/verify: UUID rejection, invalid credentials, valid handshake.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { config } from 'dotenv';

config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function stashEnv(keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of Object.keys(snap)) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

// ---------------------------------------------------------------------------
// 1. UUID as siteId → 400 Identity Boundary
// ---------------------------------------------------------------------------

test('POST /api/oci/v2/verify: UUID as siteId returns 400 Identity Boundary', async () => {
  const { POST } = await import('../app/api/oci/v2/verify/route');
  const req = new NextRequest('http://localhost/api/oci/v2/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'any-key' },
    body: JSON.stringify({ siteId: '550e8400-e29b-41d4-a716-446655440000' }),
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.code, 'IDENTITY_BOUNDARY');
  assert.ok(
    json.message?.includes('public_id') || json.message?.includes('UUID'),
    `Expected Identity Boundary message, got: ${json.message}`
  );
});

// ---------------------------------------------------------------------------
// 2. Valid public_id + wrong x-api-key → 401 INVALID_CREDENTIALS
// ---------------------------------------------------------------------------

test('POST /api/oci/v2/verify: valid public_id with wrong x-api-key returns 401', async () => {
  const { POST } = await import('../app/api/oci/v2/verify/route');
  const req = new NextRequest('http://localhost/api/oci/v2/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'wrong-api-key-xyz' },
    body: JSON.stringify({ siteId: 'site-nonexistent-public-id-99' }),
  });
  const res = await POST(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.code, 'INVALID_CREDENTIALS');
});

// ---------------------------------------------------------------------------
// 3. Valid public_id + valid x-api-key → 200 with session_token
// ---------------------------------------------------------------------------

test('POST /api/oci/v2/verify: valid public_id and x-api-key returns 200 with session_token', async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.warn('Skipping verify handshake test: missing Supabase env');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find a site with public_id and oci_api_key
  const { data: site, error } = await admin
    .from('sites')
    .select('id, public_id, oci_api_key')
    .not('oci_api_key', 'is', null)
    .limit(1)
    .maybeSingle();

  if (error || !site?.public_id || !site?.oci_api_key) {
    console.warn('Skipping verify handshake test: no site with oci_api_key found');
    return;
  }

  const saved = stashEnv(['OCI_SESSION_SECRET', 'CRON_SECRET']);
  try {
    process.env.OCI_SESSION_SECRET = process.env.OCI_SESSION_SECRET || process.env.CRON_SECRET || 'test-session-secret';

    const { POST } = await import('../app/api/oci/v2/verify/route');
    const req = new NextRequest('http://localhost/api/oci/v2/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': site.oci_api_key,
      },
      body: JSON.stringify({ siteId: site.public_id }),
    });
    const res = await POST(req);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const json = await res.json();
    assert.ok(json.session_token, 'must return session_token');
    assert.ok(json.expires_at, 'must return expires_at');

    // Expires_at should be ~5 min from now
    const expires = new Date(json.expires_at).getTime();
    const now = Date.now();
    const fiveMinMs = 5 * 60 * 1000;
    assert.ok(expires > now, 'expires_at must be in the future');
    assert.ok(expires - now <= fiveMinMs + 5000, 'expires_at should be ~5 min');
  } finally {
    restoreEnv(saved);
  }
});
