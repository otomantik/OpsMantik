/**
 * Sprint-1 Titanium Core — Entitlements smoke.
 * Runs RPC + optional HTTP checks. Loads .env.local and .env automatically when run via npm run smoke:sprint1.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required for RPC smoke
 *   SMOKE_SITE_ID (public_id) — optional; used for increment_usage_checked and burst sync (resolve to UUID)
 *   SMOKE_BASE_URL — optional; if set, run burst sync test (rate-limit 429)
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sitePublicId = process.env.SMOKE_SITE_ID || process.env.TEST_SITE_PUBLIC_ID;
const baseUrl = process.env.SMOKE_BASE_URL || process.env.BASE_URL || '';

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m' };
function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}
function assert(cond, msg) {
  if (!cond) {
    log(`❌ FAIL: ${msg}`, 'red');
    process.exit(1);
  }
  log(`✅ PASS: ${msg}`, 'green');
}

function currentMonthFirstDay() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

async function main() {
  log('\n📋 Sprint-1 Entitlements Smoke', 'blue');
  if (!url || !serviceKey) {
    log('❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required', 'red');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // --- 1) get_entitlements_for_site: no subscription => FREE, google_ads_sync false ---
  log('\n📋 1) get_entitlements_for_site (no sub => FREE, google_ads_sync false)', 'blue');
  let siteUuid = null;
  if (sitePublicId) {
    const { data: siteRow } = await admin.from('sites').select('id').eq('public_id', sitePublicId).single();
    if (siteRow) siteUuid = siteRow.id;
  }
  if (!siteUuid) {
    const { data: anySite } = await admin.from('sites').select('id').limit(1).single();
    siteUuid = anySite?.id;
  }
  if (!siteUuid) {
    log('⚠️  No site found; skip RPC tests that need site_id', 'yellow');
  } else {
    const { data: ent, error: entErr } = await admin.rpc('get_entitlements_for_site', { p_site_id: siteUuid });
    assert(!entErr, `get_entitlements_for_site must not error: ${entErr?.message}`);
    assert(ent?.tier, 'response must have tier');
    const hasGoogleAdsSync = ent?.capabilities?.google_ads_sync === true;
    if (ent?.tier === 'FREE') {
      assert(!hasGoogleAdsSync, 'FREE tier must have google_ads_sync false');
    }
    log(`   tier=${ent?.tier} google_ads_sync=${ent?.capabilities?.google_ads_sync}`, 'reset');
  }

  // --- 2) increment_usage_checked: limit 2 => 3rd call returns LIMIT ---
  log('\n📋 2) increment_usage_checked (limit 2, 3rd => LIMIT)', 'blue');
  if (!siteUuid) {
    log('⚠️  Skip (no site)', 'yellow');
  } else {
    const month = currentMonthFirstDay();
    const r1 = await admin.rpc('increment_usage_checked', {
      p_site_id: siteUuid,
      p_month: month,
      p_kind: 'revenue_events',
      p_limit: 2,
    });
    const d1 = r1.data;
    assert(d1?.ok === true, `first call ok:true (got ${JSON.stringify(d1)})`);

    const r2 = await admin.rpc('increment_usage_checked', {
      p_site_id: siteUuid,
      p_month: month,
      p_kind: 'revenue_events',
      p_limit: 2,
    });
    const d2 = r2.data;
    assert(d2?.ok === true, `second call ok:true (got ${JSON.stringify(d2)})`);

    const r3 = await admin.rpc('increment_usage_checked', {
      p_site_id: siteUuid,
      p_month: month,
      p_kind: 'revenue_events',
      p_limit: 2,
    });
    const d3 = r3.data;
    assert(d3?.ok === false && d3?.reason === 'LIMIT', `third call ok:false reason:LIMIT (got ${JSON.stringify(d3)})`);
    log(`   ok:true, ok:true, ok:false reason:LIMIT`, 'reset');
  }

  // --- 3) Burst sync => 429 with x-opsmantik-ratelimit only ---
  // To hit rate limit (500/min default): set OPSMANTIK_SYNC_RL_SITE_OVERRIDE=<siteId>:10 in server env, then 15 requests trigger 429.
  if (baseUrl && sitePublicId) {
    log('\n📋 3) Burst sync => 429 + x-opsmantik-ratelimit', 'blue');
    const syncUrl = `${baseUrl.replace(/\/$/, '')}/api/sync`;
    const body = {
      s: sitePublicId,
      u: 'https://example.com/smoke',
      ec: 'interaction',
      ea: 'view',
    };
    const origin = baseUrl || 'http://localhost:3000';
    const burstCount = 15;
    const responses = await Promise.all(
      Array.from({ length: burstCount }, () =>
        fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin },
          body: JSON.stringify(body),
        })
      )
    );
    const rateLimited = responses.filter((r) => r.status === 429 && r.headers.get('x-opsmantik-ratelimit') === '1');
    const quotaLimited = responses.filter((r) => r.headers.get('x-opsmantik-quota-exceeded') === '1');
    assert(quotaLimited.length === 0, `burst must not set quota-exceeded (got ${quotaLimited.length})`);
    if (rateLimited.length >= 1) {
      log(`   ${rateLimited.length} rate-limit 429 (x-opsmantik-ratelimit: 1)`, 'green');
    } else {
      log(`   No rate-limit 429 (optional: set OPSMANTIK_SYNC_RL_SITE_OVERRIDE=${sitePublicId}:10 and re-run)`, 'yellow');
    }
  } else {
    log('\n📋 3) Burst sync (skip: set SMOKE_BASE_URL and SMOKE_SITE_ID to run)', 'yellow');
  }

  log('\n✅ Sprint-1 smoke done.\n', 'green');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
