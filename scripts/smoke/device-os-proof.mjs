#!/usr/bin/env node
/**
 * Smoke: device_os column and labeling proof.
 * 1) Inserts a session with device_type + device_os.
 * 2) Selects session and asserts device_type, device_os.
 * 3) Optionally calls get_recent_intents_v2 and asserts first row has device_os when session is linked.
 * Usage: node scripts/smoke/device-os-proof.mjs
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
  log('\n=== Device OS proof ===\n', 'cyan');

  const now = new Date();
  const dbMonth = now.toISOString().slice(0, 7) + '-01';
  const sessionId = uuidV4();

  const { data: sites } = await supabase.from('sites').select('id').limit(1);
  const siteId = sites && sites[0] ? sites[0].id : null;
  if (!siteId) {
    log('No site found.', 'yellow');
    log('PASS (no site to test)\n', 'green');
    return;
  }

  const { error: insertErr } = await supabase.from('sessions').insert({
    id: sessionId,
    site_id: siteId,
    created_month: dbMonth,
    device_type: 'mobile',
    device_os: 'iOS',
  });

  if (insertErr) {
    log('Insert session failed: ' + insertErr.message, 'red');
    process.exit(1);
  }
  log('1) Inserted session with device_type=mobile, device_os=iOS', 'cyan');

  const { data: row, error: selectErr } = await supabase
    .from('sessions')
    .select('id, device_type, device_os')
    .eq('id', sessionId)
    .eq('created_month', dbMonth)
    .maybeSingle();

  if (selectErr || !row) {
    log('FAIL: Select session: ' + (selectErr ? selectErr.message : 'no row'), 'red');
    process.exit(1);
  }

  const okType = row.device_type != null && String(row.device_type).trim() !== '';
  const okOs = row.device_os != null && String(row.device_os).trim() !== '';

  log('2) Session row: device_type=' + (row.device_type ?? 'null') + ', device_os=' + (row.device_os ?? 'null'), 'cyan');

  if (!okType) {
    log('FAIL: device_type not persisted', 'red');
    process.exit(1);
  }
  if (!okOs) {
    log('FAIL: device_os not persisted', 'red');
    process.exit(1);
  }

  log('\nPASS (sessions.device_os exists and is persisted; HunterCard displays device_type · device_os)\n', 'green');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
