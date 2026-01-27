#!/usr/bin/env node
/**
 * WAR ROOM Autopsy Pack (Ads-only) — TODAY range like dashboard
 *
 * Purpose: Produce hard counts + integrity checks with copy/paste SQL.
 * Outputs: counts + sample rows for:
 * - sessions / ads_sessions qualifiers
 * - conversion events (phone/whatsapp)
 * - click intents (calls)
 * - sealed (confirmed/qualified/real)
 * - orphan / cross-site / partition join anomalies
 *
 * Env:
 * - TEST_SITE_ID (optional)
 * - DASHBOARD_FROM / DASHBOARD_TO (UTC ISO) (optional)
 * - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via .env.local)
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(label, fn, attempts = 3) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      // Only retry on transient fetch/network failures
      const transient = msg.toLowerCase().includes('fetch failed') || msg.toLowerCase().includes('network');
      if (!transient || i === attempts) throw err;
      console.warn(`⚠️  retry ${i}/${attempts} for ${label}: ${msg}`);
      await sleep(500 * i);
    }
  }
  throw lastErr;
}

function todayRangeLikeDashboard() {
  if (process.env.DASHBOARD_FROM && process.env.DASHBOARD_TO) {
    return { from: new Date(process.env.DASHBOARD_FROM), to: new Date(process.env.DASHBOARD_TO) };
  }
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function isNonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isAdsApprox(sess) {
  const hasClickId = isNonEmpty(sess.gclid) || isNonEmpty(sess.wbraid) || isNonEmpty(sess.gbraid);
  if (hasClickId) return true;
  const a = (sess.attribution_source || '').toString().trim().toLowerCase();
  if (!a) return false;
  return a.includes('paid') || a.includes('ads') || a.includes('cpc') || a.includes('ppc');
}

async function pickSiteId(fromIso, toIso) {
  if (process.env.TEST_SITE_ID) return process.env.TEST_SITE_ID;
  // auto-pick the busiest site in the range
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
  if (ranked.length === 0) {
    const { data: sites, error: sErr } = await supabase.from('sites').select('id').limit(1);
    if (sErr) throw sErr;
    return sites?.[0]?.id;
  }
  return ranked[0][0];
}

function fmt(n) {
  return typeof n === 'number' ? n : 0;
}

async function main() {
  const { from, to } = todayRangeLikeDashboard();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const siteId = await pickSiteId(fromIso, toIso);

  console.log('## URL params (today)');
  console.log(JSON.stringify({ siteId, from: fromIso, to: toIso }, null, 2));

  // Sessions
  const sess = await withRetry('sessions_today', async () => {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, site_id, created_at, created_month, fingerprint, gclid, wbraid, gbraid, attribution_source')
      .eq('site_id', siteId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .limit(50000);
    if (error) throw error;
    return data || [];
  });

  const total_sessions = sess.length;
  const ads_id = sess.filter((x) => isNonEmpty(x.gclid) || isNonEmpty(x.wbraid) || isNonEmpty(x.gbraid)).length;
  const ads_attr_set = new Set(['First Click (Paid)', 'Paid (UTM)', 'Ads Assisted']);
  const ads_attr_exact = sess.filter((x) => ads_attr_set.has((x.attribution_source || '').toString())).length;
  const ads_pred = sess.filter((x) => isAdsApprox(x)).length;
  const ads_attr_like_only = Math.max(0, ads_pred - ads_id);

  // Calls (intent pipeline) — pull ONLY relevant subsets to avoid huge transfers
  const clickIntents = await withRetry('calls_click_intents', async () => {
    const { data, error } = await supabase
      .from('calls')
      .select('id, site_id, created_at, source, status, matched_session_id, matched_fingerprint')
      .eq('site_id', siteId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .eq('source', 'click')
      .or('status.eq.intent,status.is.null')
      .limit(50000);
    if (error) throw error;
    return data || [];
  });

  const sealed = await withRetry('calls_sealed', async () => {
    const { data, error } = await supabase
      .from('calls')
      .select('id, site_id, created_at, status, matched_session_id')
      .eq('site_id', siteId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .in('status', ['confirmed', 'qualified', 'real'])
      .limit(50000);
    if (error) throw error;
    return data || [];
  });

  // Build session maps for join checks
  const bySessionId = new Map(sess.map((s) => [s.id, s]));

  // Intents ads-only (matched session qualifies)
  let intents_ads_only = 0;
  let intents_non_ads = 0;
  let intents_unknown = 0;
  const orphan_intents = [];
  for (const c of clickIntents) {
    const sid = c.matched_session_id;
    if (!sid) {
      intents_unknown++;
      orphan_intents.push({ call_id: c.id, reason: 'matched_session_id_null' });
      continue;
    }
    const srow = bySessionId.get(sid);
    if (!srow) {
      intents_unknown++;
      orphan_intents.push({ call_id: c.id, reason: 'matched_session_not_in_range_or_site', matched_session_id: sid });
      continue;
    }
    if (isAdsApprox(srow)) intents_ads_only++;
    else intents_non_ads++;
  }

  // Phone/WhatsApp events scoped to this site via session_id IN (...)
  const phoneActions = ['phone_call', 'whatsapp', 'phone_click', 'call_click'];
  const sessionIds = Array.from(new Set(sess.map((s) => s.id)));
  let phone_events_anycat_total = 0;
  let phone_events_anycat_ads_only = 0;
  let phone_events_anycat_unknown = 0;
  let phone_events_conversion_total = 0;
  let phone_events_acquisition_total = 0;

  // batch IN queries (PostgREST in() limit)
  const chunkSize = 200;
  for (let i = 0; i < sessionIds.length; i += chunkSize) {
    const chunk = sessionIds.slice(i, i + chunkSize);
    const rows = await withRetry(`events_conversion_chunk_${i / chunkSize}`, async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, session_id, session_month, created_at, event_category, event_action', { count: 'exact' })
        .in('session_id', chunk)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .in('event_action', phoneActions);
      if (error) throw error;
      return data || [];
    });
    phone_events_anycat_total += rows.length;
    for (const r of rows) {
      if (r.event_category === 'conversion') phone_events_conversion_total += 1;
      if (r.event_category === 'acquisition') phone_events_acquisition_total += 1;
      const srow = bySessionId.get(r.session_id);
      if (!srow) {
        phone_events_anycat_unknown++;
        continue;
      }
      if (isAdsApprox(srow)) phone_events_anycat_ads_only++;
    }
  }

  // Partition join correctness sample: events whose session_month != session.created_month
  const bad_partition_joins = [];
  if (sessionIds.length > 0) {
    const ev2 = await withRetry('events_sample_for_partition_check', async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, session_id, session_month, created_at')
        .in('session_id', sessionIds.slice(0, 200))
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .limit(500);
      if (error) throw error;
      return data || [];
    });
    for (const r of ev2) {
      const srow = bySessionId.get(r.session_id);
      if (!srow) continue;
      if (String(r.session_month) !== String(srow.created_month)) {
        bad_partition_joins.push({
          event_id: r.id,
          session_id: r.session_id,
          event_session_month: r.session_month,
          session_created_month: srow.created_month,
        });
        if (bad_partition_joins.length >= 10) break;
      }
    }
  }

  // Duplicate intents (within 60s window) by matched_session_id
  const dupBuckets = new Map(); // key: matched_session_id -> sorted timestamps
  for (const c of clickIntents) {
    const sid = c.matched_session_id || 'NULL';
    const arr = dupBuckets.get(sid) || [];
    arr.push(new Date(c.created_at).getTime());
    dupBuckets.set(sid, arr);
  }
  let dup_intents_60s = 0;
  for (const [sid, times] of dupBuckets.entries()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] <= 60_000) dup_intents_60s++;
    }
  }

  // RPC stats for exact range (ads_only=true)
  const rpc = await withRetry('rpc_get_dashboard_stats', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_stats', {
      p_site_id: siteId,
      p_date_from: fromIso,
      p_date_to: toIso,
      p_ads_only: true,
    });
    if (error) throw error;
    return data;
  });

  console.log('\n## SQL (copy/paste)');
  console.log(
`-- Range + site
-- site_id='${siteId}'
-- from='${fromIso}'
-- to  ='${toIso}'

-- Sessions
SELECT COUNT(*) AS total_sessions
FROM public.sessions s
WHERE s.site_id='${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}';

SELECT COUNT(*) AS ads_sessions_id_based
FROM public.sessions s
WHERE s.site_id='${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}'
  AND (NULLIF(BTRIM(s.gclid),'') IS NOT NULL OR NULLIF(BTRIM(s.wbraid),'') IS NOT NULL OR NULLIF(BTRIM(s.gbraid),'') IS NOT NULL);

SELECT COUNT(*) AS ads_sessions_attr_exact
FROM public.sessions s
WHERE s.site_id='${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}'
  AND s.attribution_source IN ('First Click (Paid)','Paid (UTM)','Ads Assisted');

SELECT COUNT(*) AS ads_sessions_predicate
FROM public.sessions s
WHERE s.site_id='${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}'
  AND public.is_ads_session(s);

-- Calls: click intents + sealed
SELECT COUNT(*) AS click_intents
FROM public.calls c
WHERE c.site_id='${siteId}'
  AND c.created_at >= '${fromIso}'
  AND c.created_at <= '${toIso}'
  AND c.source='click'
  AND (c.status='intent' OR c.status IS NULL);

SELECT COUNT(*) AS sealed
FROM public.calls c
WHERE c.site_id='${siteId}'
  AND c.created_at >= '${fromIso}'
  AND c.created_at <= '${toIso}'
  AND c.status IN ('confirmed','qualified','real');

-- Conversion events (phone/whatsapp) — requires join to sessions to enforce site_id
SELECT COUNT(*) AS conversion_events_phone_whatsapp
FROM public.events e
JOIN public.sessions s ON e.session_id=s.id AND e.session_month=s.created_month
WHERE s.site_id='${siteId}'
  AND e.created_at >= '${fromIso}'
  AND e.created_at <= '${toIso}'
  AND e.event_action IN ('phone_call','whatsapp','phone_click','call_click');

-- Breakdown hint: why Ads clicks may not create call intents:
-- /api/sync rewrites event_category to 'acquisition' when gclid present,
-- and the call-intent creation gate requires finalCategory='conversion'.
SELECT e.event_category, COUNT(*) AS n
FROM public.events e
JOIN public.sessions s ON e.session_id=s.id AND e.session_month=s.created_month
WHERE s.site_id='${siteId}'
  AND e.created_at >= '${fromIso}'
  AND e.created_at <= '${toIso}'
  AND e.event_action IN ('phone_call','whatsapp','phone_click','call_click')
GROUP BY 1
ORDER BY n DESC;

-- Orphan click intents
SELECT COUNT(*) AS orphan_click_intents
FROM public.calls c
LEFT JOIN public.sessions s ON s.id=c.matched_session_id
WHERE c.site_id='${siteId}'
  AND c.created_at >= '${fromIso}'
  AND c.created_at <= '${toIso}'
  AND c.source='click'
  AND (c.status='intent' OR c.status IS NULL)
  AND (c.matched_session_id IS NULL OR s.id IS NULL);

-- Partition join anomalies (sample): events whose session_month != session.created_month
SELECT e.id, e.session_id, e.session_month, s.created_month
FROM public.events e
JOIN public.sessions s ON s.id=e.session_id
WHERE s.site_id='${siteId}'
  AND e.created_at >= '${fromIso}'
  AND e.created_at <= '${toIso}'
  AND e.session_month <> s.created_month
LIMIT 10;

-- RPC authoritative
SELECT public.get_dashboard_stats('${siteId}'::uuid, '${fromIso}'::timestamptz, '${toIso}'::timestamptz, true) AS rpc;`
  );

  console.log('\n## SQL outputs (computed)');
  console.table([{
    site_id: siteId,
    from: fromIso,
    to: toIso,
    total_sessions,
    ads_sessions_id_based: ads_id,
    ads_sessions_attr_exact: ads_attr_exact,
    ads_sessions_predicate: ads_pred,
    ads_sessions_attr_like_only: ads_attr_like_only,
    click_intents: clickIntents.length,
    click_intents_ads_only: intents_ads_only,
    click_intents_non_ads: intents_non_ads,
    click_intents_unknown: intents_unknown,
    sealed: sealed.length,
    phone_events_anycat_total,
    phone_events_anycat_ads_only,
    phone_events_anycat_unknown,
    phone_events_conversion_total,
    phone_events_acquisition_total,
    dup_intents_within_60s: dup_intents_60s,
    rpc_ads_sessions: rpc?.ads_sessions ?? null,
    rpc_high_intent: rpc?.high_intent ?? null,
    rpc_sealed: rpc?.sealed ?? null,
    rpc_cvr: rpc?.cvr ?? null,
  }]);

  console.log('\n## Samples');
  console.log('orphan_intents_sample=', orphan_intents.slice(0, 5));
  console.log('bad_partition_join_sample=', bad_partition_joins.slice(0, 5));

  console.log('\n## PASS/FAIL');
  const pass_ads_sessions = fmt(rpc?.ads_sessions) === ads_pred;
  console.log(pass_ads_sessions ? 'PASS: rpc.ads_sessions == is_ads_session predicate count' : 'FAIL: rpc.ads_sessions mismatch');
  const pass_intents_bound = fmt(rpc?.high_intent) <= clickIntents.length;
  console.log(pass_intents_bound ? 'PASS: rpc.high_intent <= click_intents_raw' : 'FAIL: rpc.high_intent exceeds raw intents');
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

