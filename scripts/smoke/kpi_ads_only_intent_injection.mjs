/**
 * Smoke: Ads-only KPI contract + KPI change after injected intent
 *
 * Verifies:
 * - get_dashboard_stats returns ads_sessions/high_intent/sealed/cvr
 * - high_intent increases after inserting a click intent matched to an Ads session
 *
 * Uses service role key from .env.local:
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

async function pickSiteId() {
  if (process.env.TEST_SITE_ID) return process.env.TEST_SITE_ID;
  const { data, error } = await supabase.from('sites').select('id').limit(1);
  if (error) throw error;
  if (!data?.[0]?.id) throw new Error('No sites found');
  return data[0].id;
}

async function getStats(siteId, dateFromIso, dateToIso) {
  const { data, error } = await supabase.rpc('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: dateFromIso,
    p_date_to: dateToIso,
    p_ads_only: true,
  });
  if (error) throw error;
  return data;
}

async function findAdsSessionId(siteId, dateFromIso, dateToIso) {
  // Service-role smoke: pick a session that matches Ads predicate inputs.
  const { data, error } = await supabase
    .from('sessions')
    .select('id, created_at, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .or('gclid.not.is.null,wbraid.not.is.null,gbraid.not.is.null')
    .gte('created_at', dateFromIso)
    .lte('created_at', dateToIso)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const sid = data?.[0]?.id || null;
  return sid;
}

async function main() {
  const siteId = await pickSiteId();
  // Use a small lookahead so newly inserted rows fall within p_date_to.
  const dateTo = new Date(Date.now() + 5 * 60 * 1000);
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);
  const fromIso = dateFrom.toISOString();
  const toIso = dateTo.toISOString();

  console.log('📌 siteId:', siteId);

  const before = await getStats(siteId, fromIso, toIso);
  console.log('📦 get_dashboard_stats payload (before):');
  console.log(JSON.stringify(before, null, 2));

  for (const k of ['ads_sessions', 'high_intent', 'sealed', 'cvr']) {
    if (typeof before?.[k] !== 'number') throw new Error(`Missing numeric KPI field: ${k}`);
  }

  const adsSessionId = await findAdsSessionId(siteId, fromIso, toIso);
  if (!adsSessionId) throw new Error('No Ads session found (sessions.gclid/wbraid/gbraid all NULL)');
  console.log('🎯 adsSessionId:', adsSessionId);

  // Insert an intent call matched to Ads session
  const phone = '+905000000000';
  let callId = null;
  try {
    const { data: inserted, error: insErr } = await supabase
      .from('calls')
      .insert({
        site_id: siteId,
        phone_number: phone,
        matched_session_id: adsSessionId,
        source: 'click',
        status: 'intent',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    callId = inserted?.id;
    console.log('➕ inserted callId:', callId);

    const after = await getStats(siteId, fromIso, toIso);
    console.log('📦 get_dashboard_stats payload (after):');
    console.log(JSON.stringify(after, null, 2));

    if ((after.high_intent || 0) < (before.high_intent || 0) + 1) {
      throw new Error(`Expected high_intent to increase by >= 1 (${before.high_intent} -> ${after.high_intent})`);
    }
  } finally {
    if (callId) {
      await supabase.from('calls').delete().eq('id', callId);
      console.log('🧹 cleaned up callId:', callId);
    }
  }

  console.log('✅ PASS: KPI payload present and high_intent increased after injection');
}

main().catch((err) => {
  console.error('❌ FAIL:', err?.message || err);
  process.exit(1);
});

