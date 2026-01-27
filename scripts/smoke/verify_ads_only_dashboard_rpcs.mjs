/**
 * Verification: Dashboard RPCs support Ads-only mode.
 *
 * Checks that for each RPC:
 *   ads_only=true results are <= ads_only=false
 *
 * RPCs:
 * - get_dashboard_stats
 * - get_dashboard_timeline
 * - get_dashboard_intents
 *
 * Usage:
 *   node scripts/smoke/verify_ads_only_dashboard_rpcs.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE key');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

function sumTimeline(arr, key) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((acc, row) => acc + (row?.[key] ?? 0), 0);
}

function assertLeq(label, a, b) {
  if (a > b) throw new Error(`${label}: expected ads_only=true (${a}) <= ads_only=false (${b})`);
}

async function main() {
  console.log('🧪 Verify: Ads-only dashboard RPCs');

  let siteId = process.env.TEST_SITE_ID;
  if (!siteId) {
    const { data: sites, error } = await supabase.from('sites').select('id').limit(1);
    if (error) throw error;
    siteId = sites?.[0]?.id;
  }
  if (!siteId) throw new Error('No siteId available');

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);

  console.log('📌 siteId:', siteId);

  // Stats
  const { data: statsAds, error: e1 } = await supabase.rpc('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_ads_only: true,
  });
  if (e1) throw e1;

  const { data: statsAll, error: e2 } = await supabase.rpc('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_ads_only: false,
  });
  if (e2) throw e2;

  assertLeq('stats.total_sessions', statsAds.total_sessions, statsAll.total_sessions);
  assertLeq('stats.unique_visitors', statsAds.unique_visitors, statsAll.unique_visitors);
  assertLeq('stats.total_events', statsAds.total_events, statsAll.total_events);
  assertLeq('stats.total_calls', statsAds.total_calls, statsAll.total_calls);

  // Timeline
  const { data: tlAds, error: e3 } = await supabase.rpc('get_dashboard_timeline', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_granularity: 'auto',
    p_ads_only: true,
  });
  if (e3) throw e3;

  const { data: tlAll, error: e4 } = await supabase.rpc('get_dashboard_timeline', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_granularity: 'auto',
    p_ads_only: false,
  });
  if (e4) throw e4;

  assertLeq('timeline.sum(visitors)', sumTimeline(tlAds, 'visitors'), sumTimeline(tlAll, 'visitors'));
  assertLeq('timeline.sum(events)', sumTimeline(tlAds, 'events'), sumTimeline(tlAll, 'events'));
  assertLeq('timeline.sum(calls)', sumTimeline(tlAds, 'calls'), sumTimeline(tlAll, 'calls'));

  // Intents
  const { data: intentsAds, error: e5 } = await supabase.rpc('get_dashboard_intents', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_status: null,
    p_search: null,
    p_ads_only: true,
  });
  if (e5) throw e5;

  const { data: intentsAll, error: e6 } = await supabase.rpc('get_dashboard_intents', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_status: null,
    p_search: null,
    p_ads_only: false,
  });
  if (e6) throw e6;

  const lenAds = Array.isArray(intentsAds) ? intentsAds.length : 0;
  const lenAll = Array.isArray(intentsAll) ? intentsAll.length : 0;
  assertLeq('intents.length', lenAds, lenAll);

  console.log('✅ PASS: ads_only=true counts are <= ads_only=false');
  console.log(JSON.stringify({
    stats: { ads: statsAds, all: statsAll },
    timeline: { ads: { visitors: sumTimeline(tlAds, 'visitors'), events: sumTimeline(tlAds, 'events'), calls: sumTimeline(tlAds, 'calls') },
                all: { visitors: sumTimeline(tlAll, 'visitors'), events: sumTimeline(tlAll, 'events'), calls: sumTimeline(tlAll, 'calls') } },
    intents: { ads: lenAds, all: lenAll },
  }, null, 2));
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

