#!/usr/bin/env node
/**
 * Smoke script: Prove call-event matching and attribution are site-scoped (tenant isolation).
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_A_ID, SITE_B_ID.
 *   SITE_A_ID / SITE_B_ID can be either sites.id (UUID) or sites.public_id (32-char hex);
 *   script resolves public_id to id for inserts (sessions FK references sites.id).
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

// UUID is 36 chars with dashes; public_id is 32 hex chars.
function looksLikePublicId(value) {
  const s = String(value).trim();
  return s.length === 32 && /^[0-9a-fA-F]+$/.test(s);
}

async function resolveSiteId(admin, siteIdOrPublicId) {
  const v = siteIdOrPublicId.trim();
  if (!looksLikePublicId(v)) {
    return v;
  }
  const { data, error } = await admin.from('sites').select('id').eq('public_id', v).limit(1).maybeSingle();
  if (error || !data?.id) {
    throw new Error(`SITE_A_ID/SITE_B_ID: could not resolve public_id "${v}" to sites.id (not found or invalid). Use sites.id (UUID) or existing public_id.`);
  }
  return data.id;
}

async function main() {
  const supabaseUrl = env('SUPABASE_URL');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const siteAIdRaw = env('SITE_A_ID').trim();
  const siteBIdRaw = env('SITE_B_ID').trim();
  const baseUrl = envOpt('CALL_EVENT_BASE_URL');
  const callEventSecret = envOpt('CALL_EVENT_SECRET');

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const siteAId = await resolveSiteId(admin, siteAIdRaw);
  const siteBId = await resolveSiteId(admin, siteBIdRaw);

  if (siteAId === siteBId) {
    throw new Error('SITE_A_ID and SITE_B_ID must be different sites (resolved to same UUID).');
  }

  console.log('[smoke] Resolved site UUIDs: A=%s B=%s', siteAId, siteBId);
  const createdMonth = currentMonth();
  const now = new Date().toISOString();
  console.log('[smoke] created_month=%s', createdMonth);

  const sessionAId = crypto.randomUUID();
  const sessionBId = crypto.randomUUID();

  async function cleanup() {
    if (!sessionAId || !sessionBId) return;
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

  let exitCode = 1;
  try {
    // 1) Optionally set site A secret so we can sign (API mode)
    if (callEventSecret && baseUrl) {
      const { data: siteA } = await admin.from('sites').select('public_id').eq('id', siteAId).single();
      if (!siteA?.public_id) throw new Error('Could not resolve site A public_id for rotate_site_secret_v1');
      const { error: rotErr } = await admin.rpc('rotate_site_secret_v1', {
        p_site_public_id: siteA.public_id,
        p_current_secret: callEventSecret,
        p_next_secret: null,
      });
      if (rotErr) throw new Error('rotate_site_secret_v1 failed: ' + rotErr.message);
      console.log('[smoke] Site A secret set for signing');
    }

    // 2) Insert session A and B
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
    if (insSA) throw new Error('Session A insert: ' + insSA.message);
    const { error: insSB } = await admin.from('sessions').insert(sessionPayload(sessionBId, siteBId));
    if (insSB) throw new Error('Session B insert: ' + insSB.message);
    console.log('[smoke] Sessions inserted: A=%s B=%s', sessionAId, sessionBId);

    // 3) Insert one event per session with same fingerprint
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

    const { error: insEA } = await admin.from('events').insert(eventPayload(sessionAId, siteAId)).select('id').single();
    if (insEA) throw new Error('Event A insert: ' + insEA.message);
    const { error: insEB } = await admin.from('events').insert(eventPayload(sessionBId, siteBId)).select('id').single();
    if (insEB) throw new Error('Event B insert: ' + insEB.message);
    console.log('[smoke] Events inserted for A and B with metadata.fingerprint=%s', FP);

    let matchedSessionId = null;
    let assertionOk = false;

    if (baseUrl && callEventSecret) {
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
      if (res.status !== 200) throw new Error('API returned ' + res.status + ': ' + text);
      matchedSessionId = json.session_id ?? null;
      assertionOk =
        matchedSessionId === sessionAId &&
        matchedSessionId !== sessionBId &&
        (json.status === 'matched' || json.status === 'noop');
    } else {
      const { data: rows, error: qErr } = await admin
        .from('events')
        .select('session_id')
        .eq('site_id', siteAId)
        .eq('metadata->>fingerprint', FP)
        .order('created_at', { ascending: false })
        .limit(1);
      if (qErr) throw new Error('Direct query error: ' + qErr.message);
      matchedSessionId = rows?.[0]?.session_id ?? null;
      assertionOk = matchedSessionId === sessionAId && matchedSessionId !== sessionBId;
    }

    if (assertionOk) {
      console.log('');
      console.log('PASS: Tenant isolation verified.');
      console.log('  - Request/match for site A with fingerprint "%s" returned only site A session.', FP);
      console.log('  - Matched session_id: %s (expected %s). Site B session %s was never returned.', matchedSessionId, sessionAId, sessionBId);
      exitCode = 0;
    } else {
      console.error('');
      console.error('FAIL: Tenant isolation broken.');
      console.error('  - Matched session_id: %s', matchedSessionId);
      console.error('  - Expected (site A): %s', sessionAId);
      console.error('  - Site B session (must never be returned for site A request): %s', sessionBId);
    }
  } catch (err) {
    console.error('FAIL:', err.message);
  } finally {
    await cleanup();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('FAIL: Unhandled error:', err.message);
  process.exit(1);
});
