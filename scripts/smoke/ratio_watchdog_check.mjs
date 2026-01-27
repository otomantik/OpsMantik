#!/usr/bin/env node
/**
 * Intent Ratio Watchdog — PASS/FAIL
 *
 * Contract:
 * ratio = click_intents_ads_only / phone_events_anycat_ads_only
 * If ratio < 0.2 for 30 minutes => BROKEN
 *
 * This smoke script computes the ratio cheaply with service-role reads and prints SQL + counts.
 * It does NOT require the migration to be applied, but it will try the RPC first if present.
 *
 * Env:
 * - TEST_SITE_ID (optional; else auto-pick busiest in window)
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
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

function isNonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isAdsApprox(s) {
  const hasClickId = isNonEmpty(s.gclid) || isNonEmpty(s.wbraid) || isNonEmpty(s.gbraid);
  if (hasClickId) return true;
  const a = (s.attribution_source || '').toString().trim().toLowerCase();
  if (!a) return false;
  return a.includes('paid') || a.includes('ads');
}

async function pickSiteId(fromIso, toIso) {
  if (process.env.TEST_SITE_ID) return process.env.TEST_SITE_ID;
  const { data: rows, error } = await supabase
    .from('sessions')
    .select('site_id')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(50000);
  if (error) throw error;
  const counts = new Map();
  for (const r of rows || []) {
    if (!r?.site_id) continue;
    counts.set(r.site_id, (counts.get(r.site_id) || 0) + 1);
  }
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (!ranked[0]?.[0]) throw new Error('No site with sessions in window');
  return ranked[0][0];
}

async function tryRpc(siteId, fromIso, toIso) {
  const { data, error } = await supabase.rpc('get_intent_ratio_watchdog', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_ads_only: true,
  });
  if (error) return { ok: false, error };
  return { ok: true, data };
}

async function computeDirect(siteId, fromIso, toIso) {
  // Pull sessions in window (ads-only gate)
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_at, created_month, gclid, wbraid, gbraid, attribution_source')
    .eq('site_id', siteId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(50000);
  if (sErr) throw sErr;
  const sess = sessions || [];
  const adsSess = sess.filter(isAdsApprox);
  const byId = new Map(adsSess.map((s) => [s.id, s]));

  // Count phone events for ads sessions (any category)
  const phoneActions = ['phone_call', 'whatsapp', 'phone_click', 'call_click'];
  const sids = adsSess.map((s) => s.id);
  let phoneEvents = 0;
  const chunkSize = 200;
  for (let i = 0; i < sids.length; i += chunkSize) {
    const chunk = sids.slice(i, i + chunkSize);
    const { data: ev, error: eErr } = await supabase
      .from('events')
      .select('id, session_id, created_at, event_action', { count: 'exact' })
      .in('session_id', chunk)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .in('event_action', phoneActions)
      .limit(50000);
    if (eErr) throw eErr;
    phoneEvents += (ev || []).length;
  }

  // Count click intents whose matched session is ads (in window)
  const { data: calls, error: cErr } = await supabase
    .from('calls')
    .select('id, matched_session_id, created_at, source, status')
    .eq('site_id', siteId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .eq('source', 'click')
    .or('status.eq.intent,status.is.null')
    .limit(50000);
  if (cErr) throw cErr;
  let clickIntentsAds = 0;
  for (const c of calls || []) {
    if (!c?.matched_session_id) continue;
    if (byId.has(c.matched_session_id)) clickIntentsAds += 1;
  }

  const ratio = phoneEvents > 0 ? Number((clickIntentsAds / phoneEvents).toFixed(4)) : null;
  return { phone_events_anycat_ads_only: phoneEvents, click_intents_ads_only: clickIntentsAds, ratio };
}

async function main() {
  const to = new Date(Date.now() + 5 * 60 * 1000);
  const from = new Date(Date.now() - 30 * 60 * 1000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const siteId = await pickSiteId(fromIso, toIso);

  console.log('## Watch window');
  console.log(JSON.stringify({ siteId, from: fromIso, to: toIso, threshold: 0.2 }, null, 2));

  const rpc = await tryRpc(siteId, fromIso, toIso);
  if (rpc.ok) {
    console.log('## RPC output');
    console.log(JSON.stringify(rpc.data, null, 2));
  } else {
    console.log('## RPC not available (expected before migration apply)');
    console.log(JSON.stringify({ error: rpc.error?.message || String(rpc.error) }, null, 2));
  }

  const direct = await computeDirect(siteId, fromIso, toIso);
  console.log('## Direct computed output');
  console.log(JSON.stringify(direct, null, 2));

  console.log('## SQL (copy/paste)');
  console.log(
`-- Intent ratio watchdog (ads-only)
-- ratio = click_intents_ads_only / phone_events_anycat_ads_only
-- broken if ratio < 0.2 for 30 minutes

-- Calls counted (ads-only matched session)
WITH s_scope AS (
  SELECT s.id, s.created_month
  FROM public.sessions s
  WHERE s.site_id='${siteId}'
    AND s.created_at >= '${fromIso}'
    AND s.created_at <= '${toIso}'
    AND public.is_ads_session(s)
)
SELECT
  -- phone events (any category)
  (SELECT COUNT(*) FROM public.events e
   JOIN s_scope s ON e.session_id=s.id AND e.session_month=s.created_month
   WHERE e.created_at >= '${fromIso}' AND e.created_at <= '${toIso}'
     AND e.event_action IN ('phone_call','whatsapp','phone_click','call_click')
  ) AS phone_events_anycat_ads_only,
  -- click intents
  (SELECT COUNT(*) FROM public.calls c
   WHERE c.site_id='${siteId}'
     AND c.created_at >= '${fromIso}' AND c.created_at <= '${toIso}'
     AND c.source='click'
     AND (c.status='intent' OR c.status IS NULL)
     AND EXISTS (SELECT 1 FROM s_scope s WHERE s.id=c.matched_session_id)
  ) AS click_intents_ads_only;`
  );

  // PASS/FAIL logic: only alert when there is enough volume to be meaningful
  const minVolume = 10;
  if (direct.phone_events_anycat_ads_only >= minVolume && (direct.ratio ?? 1) < 0.2) {
    console.log('❌ FAIL: ratio < 0.2 for 30m window');
    process.exit(1);
  }
  console.log('✅ PASS');
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

