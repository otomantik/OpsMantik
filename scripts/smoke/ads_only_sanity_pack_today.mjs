/**
 * ADS-ONLY SANITY PACK (no UI changes)
 *
 * Computes "today" metrics using the same URL param contract as the dashboard:
 * - URL params: from=<UTC ISO>, to=<UTC ISO>
 * - Today preset: local Date start-of-day/end-of-day (then toISOString)
 *
 * Env overrides:
 * - TEST_SITE_ID
 * - DASHBOARD_FROM (UTC ISO)
 * - DASHBOARD_TO   (UTC ISO)
 *
 * Requires .env.local:
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

function getTodayRangeLikeDashboard() {
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

function isAdsPredicateApprox(s) {
  // Mirrors public.is_ads_session(sess) at a high level:
  // click-id OR attribution_source contains paid/ads/cpc/ppc (case-insensitive)
  const hasClickId = isNonEmpty(s.gclid) || isNonEmpty(s.wbraid) || isNonEmpty(s.gbraid);
  if (hasClickId) return true;
  const a = (s.attribution_source || '').toString().trim().toLowerCase();
  if (!a) return false;
  return a.includes('paid') || a.includes('ads') || a.includes('cpc') || a.includes('ppc');
}

async function pickSiteId() {
  if (process.env.TEST_SITE_ID) return process.env.TEST_SITE_ID;
  // Auto-detect: pick the site with most sessions in the requested window.
  // (Helps when multiple sites exist and the "289" is from a different site.)
  const { from, to } = getTodayRangeLikeDashboard();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

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
    // Fallback to first site if no sessions in window at all
    const { data: sites, error: sErr } = await supabase.from('sites').select('id').limit(1);
    if (sErr) throw sErr;
    if (!sites?.[0]?.id) throw new Error('No sites found');
    return sites[0].id;
  }
  const [best] = ranked;
  console.log('ℹ️ Auto-selected siteId (most sessions in range):', best[0], 'sessions=', best[1]);
  if (ranked.length > 1) {
    console.log('ℹ️ Top sites by sessions today:', ranked.slice(0, 5).map(([id, c]) => ({ site_id: id, sessions: c })));
  }
  return best[0];
}

async function main() {
  const siteId = await pickSiteId();
  const { from, to } = getTodayRangeLikeDashboard();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  console.log('## URL params (today)');
  console.log(JSON.stringify({ from: fromIso, to: toIso }, null, 2));

  // Fetch sessions for today range (minimal fields for classification)
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_at, gclid, wbraid, gbraid, attribution_source')
    .eq('site_id', siteId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (sErr) throw sErr;
  const sess = sessions || [];

  const total_sessions_today = sess.length;
  const ads_sessions_id_based = sess.filter((x) => isNonEmpty(x.gclid) || isNonEmpty(x.wbraid) || isNonEmpty(x.gbraid)).length;

  // UTM-based not possible from sessions table in this schema (no utm_* columns)
  const ads_sessions_utm_based = 0;

  const attrSet = new Set(['First Click (Paid)', 'Paid (UTM)', 'Ads Assisted']);
  const ads_sessions_attr_based = sess.filter((x) => attrSet.has((x.attribution_source || '').toString())).length;

  const ads_sessions_predicate = sess.filter((x) => isAdsPredicateApprox(x)).length;
  const ads_sessions_attr_like_only = Math.max(0, ads_sessions_predicate - ads_sessions_id_based);

  // Intents (calls created by sync intent pipeline)
  const { data: calls, error: cErr } = await supabase
    .from('calls')
    .select('id, created_at, source, status, matched_session_id')
    .eq('site_id', siteId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .eq('source', 'click')
    .or('status.eq.intent,status.is.null');
  if (cErr) throw cErr;
  const intents = calls || [];
  const intents_today_total = intents.length;

  // Determine intents ads-only by checking matched session fields (if present)
  const intentSessionIds = Array.from(new Set(intents.map((i) => i.matched_session_id).filter(Boolean)));
  let intents_today_ads_only = 0;
  let intents_today_unknown = 0;
  if (intentSessionIds.length > 0) {
    const { data: intentSessions, error: isErr } = await supabase
      .from('sessions')
      .select('id, gclid, wbraid, gbraid, attribution_source')
      .in('id', intentSessionIds)
      .eq('site_id', siteId);
    if (isErr) throw isErr;
    const byId = new Map((intentSessions || []).map((r) => [r.id, r]));
    for (const i of intents) {
      const sid = i.matched_session_id;
      if (!sid) {
        intents_today_unknown += 1;
        continue;
      }
      const srow = byId.get(sid);
      if (!srow) {
        intents_today_unknown += 1;
        continue;
      }
      if (isAdsPredicateApprox(srow)) intents_today_ads_only += 1;
    }
  }

  // Optional: events-based phone/whatsapp click signals (for visibility)
  const phoneActions = ['phone_call', 'whatsapp', 'phone_click', 'call_click'];
  const { data: ev, error: eErr } = await supabase
    .from('events')
    .select('id, event_action, event_label, created_at', { count: 'exact' })
    .eq('event_category', 'conversion')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .in('event_action', phoneActions);
  if (eErr) throw eErr;
  const intents_events_total = (ev || []).length;

  // RPC output for same range
  const { data: rpcStats, error: rpcErr } = await supabase.rpc('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_ads_only: true,
  });
  if (rpcErr) throw rpcErr;

  console.log('\n## SQL (copy/paste)');
  console.log(
`-- Dashboard URL params (today)
-- from='${fromIso}'
-- to  ='${toIso}'

-- A) total_sessions_today (distinct sessions)
SELECT COUNT(*) AS total_sessions_today
FROM public.sessions s
WHERE s.site_id = '${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}';

-- B) ads_sessions_id_based: gclid OR wbraid OR gbraid present
SELECT COUNT(*) AS ads_sessions_id_based
FROM public.sessions s
WHERE s.site_id = '${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}'
  AND (NULLIF(BTRIM(s.gclid),'') IS NOT NULL OR NULLIF(BTRIM(s.wbraid),'') IS NOT NULL OR NULLIF(BTRIM(s.gbraid),'') IS NOT NULL);

-- C) ads_sessions_utm_based: utm_source='google' AND utm_medium in ('cpc','ppc','paidsearch')
-- NOTE: sessions table has no utm_* columns in current schema => expected 0 / not computable in SQL without joining raw events.
SELECT 0 AS ads_sessions_utm_based;

-- D) ads_sessions_attr_based: attribution_source IN (...)
SELECT COUNT(*) AS ads_sessions_attr_based
FROM public.sessions s
WHERE s.site_id = '${siteId}'
  AND s.created_at >= '${fromIso}'
  AND s.created_at <= '${toIso}'
  AND s.attribution_source IN ('First Click (Paid)', 'Paid (UTM)', 'Ads Assisted');

-- E) intents_today_total (phone_click + whatsapp_click) via calls intent pipeline
SELECT COUNT(*) AS intents_today_total
FROM public.calls c
WHERE c.site_id = '${siteId}'
  AND c.created_at >= '${fromIso}'
  AND c.created_at <= '${toIso}'
  AND c.source = 'click'
  AND (c.status = 'intent' OR c.status IS NULL);

-- F) intents_today_ads_only: intents whose matched session qualifies as ads
SELECT COUNT(*) AS intents_today_ads_only
FROM public.calls c
JOIN public.sessions s ON s.id = c.matched_session_id
WHERE c.site_id = '${siteId}'
  AND c.created_at >= '${fromIso}'
  AND c.created_at <= '${toIso}'
  AND c.source = 'click'
  AND (c.status = 'intent' OR c.status IS NULL)
  AND public.is_ads_session(s);

-- RPC: get_dashboard_stats for same range
SELECT public.get_dashboard_stats('${siteId}'::uuid, '${fromIso}'::timestamptz, '${toIso}'::timestamptz, true) AS rpc;`
  );

  console.log('\n## SQL outputs (computed)');
  console.table([{
    site_id: siteId,
    from: fromIso,
    to: toIso,
    total_sessions_today,
    ads_sessions_id_based,
    ads_sessions_utm_based,
    ads_sessions_attr_based,
    ads_sessions_predicate,
    ads_sessions_attr_like_only,
    intents_today_total,
    intents_today_ads_only,
    intents_today_unknown,
    intents_events_total,
    rpc_ads_sessions: rpcStats?.ads_sessions ?? null,
    rpc_high_intent: rpcStats?.high_intent ?? null,
    rpc_sealed: rpcStats?.sealed ?? null,
    rpc_cvr: rpcStats?.cvr ?? null,
  }]);

  console.log('\n## PASS/FAIL');
  const passAdsSessions = (rpcStats?.ads_sessions ?? null) === ads_sessions_predicate;
  console.log(passAdsSessions ? 'PASS: Ads Sessions metric matches session reality (predicate)' : 'FAIL: Ads Sessions mismatch');

  console.log('\n## One-page conclusion');
  console.log(
`- Ads Sessions (RPC)=${rpcStats?.ads_sessions} vs predicate_count=${ads_sessions_predicate} vs click-id-based=${ads_sessions_id_based}.
- Inflation driver: ${ads_sessions_attr_like_only} sessions qualify via attribution_source paid/ads/cpc/ppc without click-ids.
- UTM-based count: not computable from sessions table (no utm_* columns). So UTM cannot be the inflator here unless attribution_source is derived upstream.
- High Intent (today): intents_total=${intents_today_total}, intents_ads_only=${intents_today_ads_only}.
  If Ads Sessions is high but High Intent is low, it usually means phone/whatsapp “intent” rows are not being created (or are rare)
  because the pipeline only creates call intents on conversion events flagged with phone_actions + fingerprint (see /api/sync Step D).
  Next check: count conversion events with phone_actions today (events-based=${intents_events_total}).`
  );
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

