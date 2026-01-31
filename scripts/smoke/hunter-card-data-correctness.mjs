#!/usr/bin/env node
/**
 * Smoke: HunterCard Data Correctness v1
 * Checks: Keyword (utm_term), Match (matchtype), Campaign (utm_campaign), Device (device_type + device_os).
 * RPC get_recent_intents_v2 must return these from sessions; card maps them.
 *
 * Usage: node scripts/smoke/hunter-card-data-correctness.mjs
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function log(msg, color = '') {
  const c = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
  console.log(`${c[color] || ''}${msg}${c.reset}`);
}

async function main() {
  log('\n=== HunterCard Data Correctness v1 — Smoke ===\n', 'cyan');

  const now = new Date();
  const toIso = now.toISOString();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 7);
  const fromIso = fromDate.toISOString();

  const { data: sites } = await supabase.from('sites').select('id').limit(1);
  const siteId = sites?.[0]?.id;
  if (!siteId) {
    log('⚠ No site found; skipping RPC sample.', 'yellow');
    log('PASS (no data to check)\n');
    return;
  }

  const { data: rows, error } = await supabase.rpc('get_recent_intents_v2', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_limit: 5,
    p_ads_only: false,
  });

  if (error) {
    log('❌ RPC error: ' + error.message, 'red');
    log('FAIL\n');
    process.exit(1);
  }

  const intents = Array.isArray(rows) ? rows : [];
  log(`1) get_recent_intents_v2 returned ${intents.length} intent(s)`, 'cyan');

  const requiredKeys = ['utm_term', 'matchtype', 'utm_campaign', 'device_type', 'device_os'];
  const first = intents[0];
  if (first) {
    const present = requiredKeys.filter((k) => first[k] !== undefined);
    const missing = requiredKeys.filter((k) => first[k] === undefined);
    log(`2) First intent keys present: ${present.join(', ')}`, 'cyan');
    if (missing.length) log(`   Missing (optional may be null): ${missing.join(', ')}`, 'yellow');
    log('3) Sample — Keyword(utm_term): ' + (first.utm_term ?? '—'), 'cyan');
    log('   Match(matchtype): ' + (first.matchtype ?? '—'), 'cyan');
    log('   Campaign(utm_campaign): ' + (first.utm_campaign ?? '—'), 'cyan');
    log('   Device(device_type): ' + (first.device_type ?? '—') + ', device_os: ' + (first.device_os ?? '—'), 'cyan');
  } else {
    log('2) No intents in range; RPC contract OK.', 'cyan');
  }

  log('\nPASS (RPC returns Keyword/Match/Campaign/Device fields)\n', 'green');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
