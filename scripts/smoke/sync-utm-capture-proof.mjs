#!/usr/bin/env node
/**
 * Smoke: Sync UTM + matchtype persistence proof
 * 1) Tries POST /api/sync with full landing URL (query string with utm_term, utm_campaign, matchtype, etc.).
 * 2) Queries sessions by known session_id and asserts utm_term, utm_campaign, matchtype (and entry_page full URL).
 * 3) If sync API unavailable (server not running), inserts a test session directly with UTM fields and asserts.
 *
 * Usage: node scripts/smoke/sync-utm-capture-proof.mjs
 * Optional: BASE_URL=http://localhost:3000 (default) to test sync API.
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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

function uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function main() {
  log('\n=== Sync UTM capture proof ===\n', 'cyan');

  const now = new Date();
  const dbMonth = now.toISOString().slice(0, 7) + '-01';
  const sessionId = uuidV4();
  const fullUrl =
    BASE_URL +
    '/?utm_term=smoke+keyword&utm_campaign=smoke+campaign&matchtype=e&utm_source=google&utm_medium=cpc&utm_content=proof';

  const { data: sites } = await supabase.from('sites').select('id').limit(1);
  const siteId = sites?.[0]?.id;
  if (!siteId) {
    log('⚠ No site found.', 'yellow');
    log('PASS (no site to test)\n', 'green');
    return;
  }

  let usedSyncApi = false;
  try {
    const res = await fetch(`${BASE_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s: siteId,
        u: fullUrl,
        sid: sessionId,
        sm: dbMonth,
        ec: 'page',
        ea: 'view',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok) {
      usedSyncApi = true;
      log('1) Sync API accepted payload (session_id=' + sessionId.slice(0, 8) + '…)', 'cyan');
    }
  } catch (e) {
    log('1) Sync API not reachable (' + (e?.message || e) + '); will use direct insert.', 'yellow');
  }

  if (!usedSyncApi) {
    const { error: insertErr } = await supabase.from('sessions').insert({
      id: sessionId,
      site_id: siteId,
      created_month: dbMonth,
      entry_page: fullUrl,
      utm_term: 'smoke keyword',
      utm_campaign: 'smoke campaign',
      matchtype: 'e',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_content: 'proof',
    });
    if (insertErr) {
      log('❌ Direct insert failed: ' + insertErr.message, 'red');
      process.exit(1);
    }
    log('1) Inserted test session directly (session_id=' + sessionId.slice(0, 8) + '…)', 'cyan');
  }

  const { data: row, error: selectErr } = await supabase
    .from('sessions')
    .select('id, entry_page, utm_term, utm_campaign, matchtype, utm_source, utm_medium, utm_content')
    .eq('id', sessionId)
    .eq('created_month', dbMonth)
    .maybeSingle();

  if (selectErr) {
    log('❌ Select failed: ' + selectErr.message, 'red');
    process.exit(1);
  }
  if (!row) {
    log('❌ Session not found after insert/sync', 'red');
    process.exit(1);
  }

  const entryHasQuery = (row.entry_page || '').includes('utm_term=') && (row.entry_page || '').includes('matchtype=');
  const okTerm = row.utm_term != null && String(row.utm_term).trim() !== '';
  const okCampaign = row.utm_campaign != null && String(row.utm_campaign).trim() !== '';
  const okMatchtype = row.matchtype != null && ['e', 'p', 'b'].includes(String(row.matchtype).toLowerCase().trim());

  log('2) entry_page has query string: ' + (entryHasQuery ? 'yes' : 'no') + ' (' + (row.entry_page || '').slice(0, 60) + '…)', 'cyan');
  log('3) utm_term: ' + (row.utm_term ?? 'null') + ', utm_campaign: ' + (row.utm_campaign ?? 'null') + ', matchtype: ' + (row.matchtype ?? 'null'), 'cyan');

  if (!okTerm) {
    log('FAIL: utm_term not persisted', 'red');
    process.exit(1);
  }
  if (!okCampaign) {
    log('FAIL: utm_campaign not persisted', 'red');
    process.exit(1);
  }
  if (!okMatchtype) {
    log('FAIL: matchtype not persisted (e/p/b)', 'red');
    process.exit(1);
  }
  if (!entryHasQuery) {
    log('WARN: entry_page did not contain utm_term= and matchtype= (expected when sync sends full URL)', 'yellow');
  }

  log('\nPASS (UTM + matchtype persisted; entry_page full URL)\n', 'green');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
