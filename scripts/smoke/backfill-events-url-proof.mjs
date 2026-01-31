#!/usr/bin/env node
/**
 * Smoke: Backfill utm_term, utm_campaign, matchtype from first event URL.
 * Inserts a session (gclid, null UTM) and an event with url containing UTM params,
 * calls backfill_one_session_utm_from_events(session_id), then asserts session columns are set.
 * Prerequisite: Migration 20260130251200_backfill_sessions_utm_from_events_constrained.sql applied.
 * Usage: node scripts/smoke/backfill-events-url-proof.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function log(msg, color) {
  const c = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
  console.log((c[color] || '') + msg + c.reset);
}

function uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function main() {
  log('\n=== Backfill from events.url proof ===\n', 'cyan');

  const now = new Date();
  const dbMonth = now.toISOString().slice(0, 7) + '-01';
  const sessionId = uuidV4();
  const eventUrlWithQuery = 'https://example.com/page?utm_term=events+test&utm_campaign=smoke+events&matchtype=e';

  const { data: sites } = await supabase.from('sites').select('id').limit(1);
  const siteId = sites && sites[0] ? sites[0].id : null;
  if (!siteId) {
    log('No site found.', 'yellow');
    log('PASS (no site to test)\n', 'green');
    return;
  }

  const { error: insertSessionErr } = await supabase.from('sessions').insert({
    id: sessionId,
    site_id: siteId,
    created_month: dbMonth,
    entry_page: 'https://example.com/landing',
    gclid: 'test-gclid-events-' + Date.now(),
    utm_term: null,
    utm_campaign: null,
    matchtype: null,
  });

  if (insertSessionErr) {
    log('Insert session failed: ' + insertSessionErr.message, 'red');
    process.exit(1);
  }
  log('1) Inserted test session (gclid, null utm_term/campaign/matchtype)', 'cyan');

  const { error: insertEventErr } = await supabase.from('events').insert({
    id: uuidV4(),
    session_id: sessionId,
    session_month: dbMonth,
    url: eventUrlWithQuery,
    event_category: 'page',
    event_action: 'view',
  });

  if (insertEventErr) {
    log('Insert event failed: ' + insertEventErr.message, 'red');
    process.exit(1);
  }
  log('2) Inserted event with url containing utm_term, utm_campaign, matchtype', 'cyan');

  const { error: rpcErr } = await supabase.rpc('backfill_one_session_utm_from_events', {
    p_id: sessionId,
  });

  if (rpcErr) {
    log('RPC backfill_one_session_utm_from_events failed: ' + rpcErr.message, 'red');
    log('Ensure migration 20260130251200_backfill_sessions_utm_from_events_constrained.sql is applied.', 'yellow');
    process.exit(1);
  }
  log('3) Backfill RPC completed', 'cyan');

  const { data: row, error: selectErr } = await supabase
    .from('sessions')
    .select('id, utm_term, utm_campaign, matchtype')
    .eq('id', sessionId)
    .eq('created_month', dbMonth)
    .maybeSingle();

  if (selectErr || !row) {
    log('FAIL: Select after RPC: ' + (selectErr ? selectErr.message : 'no row'), 'red');
    process.exit(1);
  }

  const okTerm = row.utm_term != null && String(row.utm_term).trim() !== '';
  const okCampaign = row.utm_campaign != null && String(row.utm_campaign).trim() !== '';
  const okMatch = row.matchtype != null && ['e', 'p', 'b'].includes(String(row.matchtype).toLowerCase().trim());

  log('4) utm_term: ' + (row.utm_term ?? 'null') + ', utm_campaign: ' + (row.utm_campaign ?? 'null') + ', matchtype: ' + (row.matchtype ?? 'null'), 'cyan');

  if (!okTerm) {
    log('FAIL: utm_term not backfilled from event url', 'red');
    process.exit(1);
  }
  if (!okCampaign) {
    log('FAIL: utm_campaign not backfilled from event url', 'red');
    process.exit(1);
  }
  if (!okMatch) {
    log('FAIL: matchtype not backfilled from event url', 'red');
    process.exit(1);
  }

  log('\nPASS (backfill from first event URL fills utm_term, utm_campaign, matchtype)\n', 'green');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
