#!/usr/bin/env node
/**
 * Poyraz Antika ingest diagnostic: events today, idempotency, publish failures, fallback buffer.
 * Usage: node scripts/check-poyraz-ingest.mjs [site_public_id]
 * Default site_public_id: b3e9634575df45c390d99d2623ddcde5 (Poyraz Antika)
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const sitePublicId = process.argv[2] || 'b3e9634575df45c390d99d2623ddcde5';

async function run() {
  const today = new Date().toISOString().split('T')[0];
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  console.log('--- Poyraz Antika / Site ingest diagnostic ---');
  console.log('Site public_id:', sitePublicId);
  console.log('Date (today):', today);
  console.log('');

  // 1) Resolve site
  const { data: siteRow, error: siteErr } = await supabase
    .from('sites')
    .select('id, name, public_id, domain')
    .eq('public_id', sitePublicId)
    .single();

  if (siteErr || !siteRow) {
    console.error('Site not found:', siteErr?.message || 'no row');
    process.exit(1);
  }
  const siteIdUuid = siteRow.id;
  console.log('Site UUID:', siteIdUuid);
  console.log('Site name:', siteRow.name || '(null)');
  console.log('');

  // 2) Events today (by site_id)
  const { count: eventsToday, error: eErr } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  if (eErr) {
    console.log('Events today: ERROR', eErr.message);
  } else {
    console.log('Events today:', eventsToday ?? 0);
  }

  // 3) ingest_idempotency today (requests that passed RL and got inserted)
  const { count: idempToday, error: idErr } = await supabase
    .from('ingest_idempotency')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  if (idErr) {
    console.log('ingest_idempotency rows today: ERROR', idErr.message, '(table may be missing or RLS)');
  } else {
    console.log('ingest_idempotency rows today:', idempToday ?? 0, '(requests that passed rate limit + idempotency)');
  }

  // 4) ingest_publish_failures last 24h (QStash publish failed for this site)
  const { data: failures, error: fErr } = await supabase
    .from('ingest_publish_failures')
    .select('id, created_at, error_code, error_message_short')
    .eq('site_public_id', sitePublicId)
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false })
    .limit(20);

  if (fErr) {
    console.log('ingest_publish_failures (24h): ERROR', fErr.message);
  } else {
    console.log('ingest_publish_failures (24h):', failures?.length ?? 0, 'rows (last 20 shown)');
    if (failures?.length) {
      failures.forEach((r) => console.log('  -', r.created_at, r.error_code || '', r.error_message_short || ''));
    }
  }

  // 5) ingest_fallback_buffer PENDING (stuck fallback rows for this site)
  const { data: fallback, error: fbErr } = await supabase
    .from('ingest_fallback_buffer')
    .select('id, created_at, status')
    .eq('site_id', siteIdUuid)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })
    .limit(20);

  if (fbErr) {
    console.log('ingest_fallback_buffer PENDING: ERROR', fbErr.message);
  } else {
    console.log('ingest_fallback_buffer PENDING:', fallback?.length ?? 0, 'rows (stuck fallback)');
    if (fallback?.length) {
      fallback.forEach((r) => console.log('  -', r.created_at, r.status));
    }
  }

  // 6) Optional: get_command_center_p0_stats for today
  try {
    const { data: stats } = await supabase.rpc('get_command_center_p0_stats_v2', {
      p_site_id: siteIdUuid,
      p_date_from: todayStart,
      p_date_to: todayEnd,
      p_ads_only: false,
    });
    console.log('');
    console.log('Command center stats (today):', stats ? JSON.stringify(stats) : 'RPC not available or no data');
  } catch (rpcErr) {
    console.log('');
    console.log('Command center RPC:', rpcErr?.message || 'skip');
  }

  console.log('');
  console.log('--- Interpretation ---');
  if ((eventsToday ?? 0) === 0 && (idempToday ?? 0) === 0) {
    console.log('No events and no idempotency rows today => requests likely blocked at rate limit (429) before idempotency.');
    console.log('Action: Deploy site-scoped rate limit so Poyraz has its own bucket; or check Redis/Upstash for this site key.');
  }
  if ((failures?.length ?? 0) > 0) {
    console.log('QStash publish failures detected => sync route accepted request but failed to publish to QStash. Check QStash token and recovery.');
  }
  if ((fallback?.length ?? 0) > 0) {
    console.log('Fallback buffer has PENDING rows => run recovery cron to re-publish to QStash.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
