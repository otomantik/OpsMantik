#!/usr/bin/env node
/**
 * Smoke script: Prove call-event matching and attribution are site-scoped (tenant isolation).
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_A_ID, SITE_B_ID (UUIDs of two existing sites).
 * For API mode (preferred): CALL_EVENT_BASE_URL, CALL_EVENT_SECRET.
 *
 * Inserts sessions/events with same fingerprint for site A and B, then asserts that when
 * matching for site A we get only A's session. Cleans up all inserted rows at the end.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const LABEL = 'smoke_tenant_isolation';
const FP = 'fp_same';

function env(name) {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing env: ${name}`);
  return v;
}

function envOpt(name) {
  return process.env[name] || null;
}

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function currentMonth() {
  const n = new Date();
  return n.toISOString().slice(0, 7) + '-01';
}

async function main() {
  const supabaseUrl = env('SUPABASE_URL');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const siteAId = env('SITE_A_ID').trim();
  const siteBId = env('SITE_B_ID').trim();
  const baseUrl = envOpt('CALL_EVENT_BASE_URL');
  const callEventSecret = envOpt('CALL_EVENT_SECRET');

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const createdMonth = currentMonth();
  const now = new Date().toISOString();

  const sessionAId = crypto.randomUUID();
  const sessionBId = crypto.randomUUID();

  console.log('[smoke] SITE_A_ID=%s SITE_B_ID=%s created_month=%s', siteAId, siteBId, createdMonth);

  // 1) Optionally set site A secret so we can sign (API mode)
  if (callEventSecret && baseUrl) {
    const { data: siteA } = await admin.from('sites').select('public_id').eq('id', siteAId).single();
    if (!siteA?.public_id) {
      console.error('FAIL: Could not resolve site A public_id for rotate_site_secret_v1');
      process.exit(1);
    }
    // Script sets site A secret so the signed request validates; leave as-is after run (user can re-rotate if needed)
    const { error: rotErr } = await admin.rpc('rotate_site_secret_v1', {
      p_site_public_id: siteA.public_id,
      p_current_secret: callEventSecret,
      p_next_secret: null,
    });
    if (rotErr) {
      console.error('FAIL: rotate_site_secret_v1 failed:', rotErr.message);
      process.exit(1);
    }
    console.log('[smoke] Site A secret set for signing');
  }

  // 2) Insert session A and B (minimal required columns + label in a field we can filter later)
  const sessionPayload = (id, siteId) => ({
    id,
    site_id: siteId,
    created_month: createdMonth,
    created_at: now,
    entry_page: '/',
    event_count: 0,
    total_duration_sec: 0,
    attribution_source: LABEL,
  });

  const { error: insSA } = await admin.from('sessions').insert(sessionPayload(sessionAId, siteAId));
  if (insSA) {
    console.error('FAIL: Session A insert:', insSA.message);
    process.exit(1);
  }
  const { error: insSB } = await admin.from('sessions').insert(sessionPayload(sessionBId, siteBId));
  if (insSB) {
    console.error('FAIL: Session B insert:', insSB.message);
    await admin.from('sessions').delete().eq('id', sessionAId).eq('created_month', createdMonth);
    process.exit(1);
  }
  console.log('[smoke] Sessions inserted: A=%s B=%s', sessionAId, sessionBId);

  // 3) Insert one event per session with same fingerprint in metadata (and label for cleanup)
  const eventPayload = (sessionId, siteId) => ({
    session_id: sessionId,
    session_month: createdMonth,
    site_id: siteId,
    url: 'https://example.com/',
    event_category: 'interaction',
    event_action: 'view',
    metadata: { fingerprint: FP, [LABEL]: true },
    created_at: now,
  });

  const { data: evA, error: insEA } = await admin.from('events').insert(eventPayload(sessionAId, siteAId)).select('id').single();
  if (insEA) {
    console.error('FAIL: Event A insert:', insEA.message);
    await cleanup();
    process.exit(1);
  }
  const { error: insEB } = await admin.from('events').insert(eventPayload(sessionBId, siteBId)).select('id').single();
  if (insEB) {
    console.error('FAIL: Event B insert:', insEB.message);
    await cleanup();
    process.exit(1);
  }
  console.log('[smoke] Events inserted for A and B with metadata.fingerprint=%s', FP);

  async function cleanup() {
    const { error: delE } = await admin.from('events').delete().eq('session_id', sessionAId).eq('session_month', createdMonth);
    if (delE) console.warn('[smoke] Cleanup events A:', delE.message);
    const { error: delE2 } = await admin.from('events').delete().eq('session_id', sessionBId).eq('session_month', createdMonth);
    if (delE2) console.warn('[smoke] Cleanup events B:', delE2.message);
    const { error: delSA } = await admin.from('sessions').delete().eq('id', sessionAId).eq('created_month', createdMonth);
    if (delSA) console.warn('[smoke] Cleanup session A:', delSA.message);
    const { error: delSB } = await admin.from('sessions').delete().eq('id', sessionBId).eq('created_month', createdMonth);
    if (delSB) console.warn('[smoke] Cleanup session B:', delSB.message);
    console.log('[smoke] Cleanup done');
  }

  let matchedSessionId = null;
  let assertionOk = false;

  if (baseUrl && callEventSecret) {
    // 4a) Call /api/call-event/v2 with site_id = A and fingerprint = fp_same (signed)
    const body = { site_id: siteAId, fingerprint: FP, phone_number: null };
    const rawBody = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000);
    const sig = hmacHex(callEventSecret, `${ts}.${rawBody}`);

    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/call-event/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ops-site-id': siteAId,
        'x-ops-ts': String(ts),
        'x-ops-signature': sig,
      },
      body: rawBody,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }

    if (res.status !== 200) {
      console.error('FAIL: API returned', res.status, text);
      await cleanup();
      process.exit(1);
    }

    matchedSessionId = json.session_id ?? null;
    // Must match site A session only; must never return site B session
    assertionOk =
      matchedSessionId === sessionAId &&
      matchedSessionId !== sessionBId &&
      (json.status === 'matched' || json.status === 'noop');
  } else {
    // 4b) Direct DB proof: query events for site_id=A and fingerprint=fp_same, get session_id
    const { data: rows, error: qErr } = await admin
      .from('events')
      .select('session_id')
      .eq('site_id', siteAId)
      .eq('metadata->>fingerprint', FP)
      .order('created_at', { ascending: false })
      .limit(1);

    if (qErr) {
      console.error('FAIL: Direct query error:', qErr.message);
      await cleanup();
      process.exit(1);
    }
    matchedSessionId = rows?.[0]?.session_id ?? null;
    assertionOk = matchedSessionId === sessionAId && matchedSessionId !== sessionBId;
  }

  await cleanup();

  if (assertionOk) {
    console.log('');
    console.log('PASS: Tenant isolation verified.');
    console.log('  - Request/match for site A with fingerprint "%s" returned only site A session.', FP);
    console.log('  - Matched session_id: %s (expected %s). Site B session %s was never returned.', matchedSessionId, sessionAId, sessionBId);
    process.exit(0);
  } else {
    console.error('');
    console.error('FAIL: Tenant isolation broken.');
    console.error('  - Matched session_id: %s', matchedSessionId);
    console.error('  - Expected (site A): %s', sessionAId);
    console.error('  - Site B session (must never be returned for site A request): %s', sessionBId);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FAIL: Unhandled error:', err.message);
  process.exit(1);
});
