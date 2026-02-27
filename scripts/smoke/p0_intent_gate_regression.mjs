#!/usr/bin/env node
/**
 * P0 Regression: Ads phone/wa clicks MUST create call intents even when gclid exists.
 *
 * Simulates posting to /api/sync with:
 * - ec='conversion'
 * - ea='phone_call'
 * - meta.gclid='TEST'
 *
 * Verifies in DB (service role):
 * - events row exists with event_category='conversion' and event_action='phone_call'
 * - calls row exists with source='click' and status='intent' for matched_session_id
 *
 * Also prints before/after deltas for last-15-min ads-only window.
 *
 * Env:
 * - NEXT_PUBLIC_SUPABASE_URL — MUST match production (same as Vercel), else events written to different DB
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SYNC_API_URL (default http://localhost:3100/api/sync; regression uses production when not set)
 * - ORIGIN (default https://www.poyrazantika.com)
 * - P0_DB_RETRIES (default 12) — QStash + worker can take 5–30s
 * - P0_DB_RETRY_MS (default 2000) — delay per retry
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

const SYNC_API_URL = process.env.SYNC_API_URL || 'http://localhost:3100/api/sync';
const ORIGIN = process.env.ORIGIN || 'https://www.poyrazantika.com';

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function monthKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 7) + '-01';
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retry(label, fn, attempts = 6, baseMs = 500) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e?.message || String(e);
      console.warn(`⚠️  ${label} retry ${i}/${attempts}: ${msg}`);
      await sleep(baseMs * i);
    }
  }
  throw last;
}

async function pickSitePublicId() {
  // /api/sync expects sites.public_id in payload.s (it searches by public_id)
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuid32Hex = /^[0-9a-f]{32}$/i; // accepted by /api/sync normalization path
  const { data, error } = await supabase
    .from('sites')
    .select('id, public_id')
    .not('public_id', 'is', null)
    .limit(50);
  if (error) throw error;
  const row = (data || []).find((r) => {
    if (typeof r?.public_id !== 'string') return false;
    const v = r.public_id.trim();
    return uuidV4Regex.test(v) || uuid32Hex.test(v);
  });
  if (!row?.public_id) {
    throw new Error('No sites.public_id found in UUIDv4 or 32-hex format');
  }
  return { site_id: row.id, site_public_id: row.public_id };
}

async function countAdsHighIntent(siteId, fromIso, toIso) {
  // Mirrors get_dashboard_stats high_intent core: calls matched to Ads sessions in-range
  const { data: calls, error } = await supabase
    .from('calls')
    .select('id, matched_session_id, created_at')
    .eq('site_id', siteId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .eq('source', 'click')
    .or('status.eq.intent,status.is.null')
    .limit(5000);
  if (error) throw error;
  const sids = Array.from(new Set((calls || []).map((c) => c.matched_session_id).filter(Boolean)));
  if (sids.length === 0) return 0;
  const { data: sess, error: sErr } = await supabase
    .from('sessions')
    .select('id, gclid, wbraid, gbraid, attribution_source, created_at, created_month')
    .in('id', sids.slice(0, 500))
    .eq('site_id', siteId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(5000);
  if (sErr) throw sErr;
  const byId = new Map((sess || []).map((s) => [s.id, s]));
  let n = 0;
  for (const c of calls || []) {
    const s = byId.get(c.matched_session_id);
    if (!s) continue;
    const hasClickId = !!((s.gclid || '').trim() || (s.wbraid || '').trim() || (s.gbraid || '').trim());
    const a = (s.attribution_source || '').toString().toLowerCase();
    const isAds = hasClickId || a.includes('paid') || a.includes('ads');
    if (isAds) n++;
  }
  return n;
}

async function main() {
  console.log('🧪 P0 intent-gate regression');
  const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : 'unknown';
  console.log(JSON.stringify({ SYNC_API_URL, ORIGIN, supabase_host: supabaseHost }, null, 2));

  const { site_id: internalSiteId, site_public_id } = await pickSitePublicId();
  const sid = generateUUID();
  const sm = monthKeyUTC();
  const now = new Date();
  const t0 = new Date(now.getTime() - 2 * 1000);

  // Last 15 minutes window for delta proof
  const to = new Date(Date.now() + 5 * 60 * 1000);
  const from = new Date(Date.now() - 15 * 60 * 1000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const beforeAdsHighIntent = await countAdsHighIntent(internalSiteId, fromIso, toIso);

  const payload = {
    s: site_public_id,
    u: `https://example.test/landing?gclid=TEST`,
    sid,
    sm,
    ec: 'conversion',
    ea: 'phone_call',
    el: 'tel:+905000000000',
    ev: null,
    r: 'https://google.com/',
    meta: {
      fp: 'fp_regression_test',
      gclid: 'TEST',
    },
    consent_scopes: ['analytics', 'marketing'], // Required: without this sync returns 204 and event is never published
  };

  // Post to /api/sync (requires Origin header; route fail-closed if missing origin)
  const res = await retry('POST /api/sync', async () => {
    const r = await fetch(SYNC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': ORIGIN,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`sync_http_${r.status}: ${text.slice(0, 200)}`);
    }
    return r;
  });

  const body = await res.json().catch(() => ({}));
  if (!body || body.ok !== true) {
    throw new Error(`sync_response_not_ok: ${JSON.stringify(body).slice(0, 200)}`);
  }
  console.log('Sync response:', { status: res.status, ok: body.ok, count: body.count, ingest_id: body.ingest_id });
  console.log('## P0 lookup (use for Supabase verify):', { sid, sm, site_id: internalSiteId });

  // QStash + worker can take 5–30s; retry with longer delays
  const dbRetries = parseInt(process.env.P0_DB_RETRIES || '12', 10);
  const dbRetryMs = parseInt(process.env.P0_DB_RETRY_MS || '2000', 10);

  // Verify event row category stays 'conversion' even with gclid present
  const eventRow = await retry('DB verify events', async () => {
    const { data, error } = await supabase
      .from('events')
      .select('id, session_id, session_month, created_at, event_category, event_action')
      .eq('session_id', sid)
      .eq('session_month', sm)
      .eq('event_action', 'phone_call')
      .gte('created_at', t0.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = data?.[0] || null;
    if (!row) throw new Error('event_row_missing');
    if (row.event_category !== 'conversion') {
      throw new Error(`event_category_wrong: ${row.event_category}`);
    }
    return row;
  }, dbRetries, dbRetryMs);

  // Verify call intent exists (source=click, status=intent) for matched_session_id
  const callRow = await retry('DB verify calls', async () => {
    const { data, error } = await supabase
      .from('calls')
      .select('id, site_id, created_at, source, status, matched_session_id')
      .eq('site_id', internalSiteId)
      .eq('matched_session_id', sid)
      .eq('source', 'click')
      .eq('status', 'intent')
      .gte('created_at', t0.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = data?.[0] || null;
    if (!row) throw new Error('call_intent_missing');
    return row;
  }, dbRetries, dbRetryMs);

  const afterAdsHighIntent = await countAdsHighIntent(internalSiteId, fromIso, toIso);

  console.log('## SQL (copy/paste)');
  console.log(
`-- Verify event category preserved for conversion phone_call (gclid present)
SELECT id, session_id, session_month, created_at, event_category, event_action
FROM public.events
WHERE session_id='${sid}'
  AND session_month='${sm}'
  AND event_action='phone_call'
ORDER BY created_at DESC
LIMIT 1;

-- Verify call intent created
SELECT id, site_id, created_at, source, status, matched_session_id
FROM public.calls
WHERE site_id='${internalSiteId}'
  AND matched_session_id='${sid}'
  AND source='click'
  AND status='intent'
ORDER BY created_at DESC
LIMIT 1;`
  );

  console.log('## SQL output rows');
  console.log(JSON.stringify({ eventRow, callRow }, null, 2));

  console.log('## Delta proof (last 15 min ads-only window)');
  console.log(JSON.stringify({ from: fromIso, to: toIso, beforeAdsHighIntent, afterAdsHighIntent }, null, 2));

  if (afterAdsHighIntent < beforeAdsHighIntent + 1) {
    throw new Error(`expected_ads_high_intent_delta>=1 (${beforeAdsHighIntent} -> ${afterAdsHighIntent})`);
  }

  // Cleanup (best-effort)
  try {
    await supabase.from('calls').delete().eq('id', callRow.id);
  } catch {}
  try {
    await supabase.from('events').delete().eq('id', eventRow.id);
  } catch {}
  try {
    // sessions is partitioned; created_month should equal sm
    await supabase.from('sessions').delete().eq('id', sid).eq('created_month', sm);
  } catch {}

  console.log('✅ PASS');
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

