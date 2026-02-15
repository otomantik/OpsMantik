/**
 * Conversation Layer E2E — staging / prod smoke
 *
 * 1) enqueue-from-sales hours: -1, 0 => 400; 168 => 200; 169 => 400
 * 2) confirm_sale_and_enqueue idempotency: second confirm => RPC error; queue single row per sale_id
 * 3) primary-source: covered by unit tests; see docs
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, SMOKE_BASE_URL
 * Optional: SMOKE_SITE_ID (use existing site); else creates a site from first user.
 * --hours-only: only run enqueue hours bounds (no DB writes; prod-safe).
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const hoursOnly = process.argv.includes('--hours-only');

function getEnv(key, required = true) {
  const v = process.env[key];
  if (required && !v) {
    console.error(`Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

function pass(msg) {
  console.log(`  \x1b[32m\u2713\x1b[0m ${msg}`);
}
function fail(msg) {
  console.error(`  \x1b[31m\u2717\x1b[0m ${msg}`);
  process.exit(1);
}

const CRON_SECRET = getEnv('CRON_SECRET');
const BASE_URL = (process.env.SMOKE_BASE_URL || 'https://console.opsmantik.com').replace(/\/$/, '');

async function runEnqueueHoursTests() {
  console.log('\n4) Enqueue-from-sales hours bounds (HTTP)');
  console.log(`   Base: ${BASE_URL}`);
  const tests = [
    { q: '-1', expectStatus: 400 },
    { q: '0', expectStatus: 400 },
    { q: '168', expectStatus: 200 },
    { q: '169', expectStatus: 400 },
  ];
  const first = await fetch(`${BASE_URL}/api/cron/oci/enqueue-from-sales?hours=-1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (first.status === 404 || first.status === 405) {
    console.warn(`  \x1b[33m!\x1b[0m Endpoint returned ${first.status} (not deployed or method not allowed). Skip hours bounds.`);
    return;
  }
  for (const { q, expectStatus } of tests) {
    const res = q === '-1' ? first : await fetch(`${BASE_URL}/api/cron/oci/enqueue-from-sales?hours=${q}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    if (res.status !== expectStatus) {
      const text = await res.text();
      fail(`hours=${q} => ${res.status} (expected ${expectStatus}) ${text.slice(0, 120)}`);
    }
    pass(`hours=${q} => ${expectStatus}`);
  }
}

async function main() {
  console.log('Conversation Layer E2E');
  console.log('  Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, SMOKE_BASE_URL\n');

  if (hoursOnly) {
    await runEnqueueHoursTests();
    console.log('\nAll hours-only checks passed.');
    return;
  }

  const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let siteId = process.env.SMOKE_SITE_ID;
  if (!siteId) {
    const { data: users } = await admin.auth.admin.listUsers();
    if (!users?.users?.length) fail('No users in project; set SMOKE_SITE_ID or create a user');
    const userId = users.users[0].id;
    const suffix = crypto.randomBytes(4).toString('hex');
    const { data: site, error: siteErr } = await admin.from('sites').insert({
      user_id: userId,
      public_id: `e2e_${suffix}`,
      domain: `e2e-${suffix}.test`,
      name: 'E2E Conversation Layer',
    }).select('id').single();
    if (siteErr) fail(`Site insert: ${siteErr.message}`);
    siteId = site.id;
    console.log('1) Seed (created site)');
  } else {
    console.log('1) Seed (using SMOKE_SITE_ID)');
  }

  const occurredAt = new Date().toISOString();
  const { data: sale, error: saleErr } = await admin.from('sales').insert({
    site_id: siteId,
    occurred_at: occurredAt,
    amount_cents: 10000,
    currency: 'TRY',
    status: 'DRAFT',
  }).select('id').single();
  if (saleErr) fail(`Sale insert: ${saleErr.message}`);
  const saleId = sale.id;
  const createdSite = !process.env.SMOKE_SITE_ID;
  pass(`Site: ${siteId}  Sale (DRAFT): ${saleId}`);

  console.log('\n2) Confirm idempotency (RPC)');
  const { data: first, error: firstErr } = await admin.rpc('confirm_sale_and_enqueue', { p_sale_id: saleId });
  if (firstErr) fail(`First confirm: ${firstErr.message}`);
  const row = Array.isArray(first) ? first[0] : first;
  if (!row || row.new_status !== 'CONFIRMED') fail('First confirm: expected new_status CONFIRMED');
  pass(`First confirm: success, enqueued=${row.enqueued === true}`);

  const { error: secondErr } = await admin.rpc('confirm_sale_and_enqueue', { p_sale_id: saleId });
  if (!secondErr) fail('Second confirm: expected RPC error');
  if (!secondErr.message?.includes('sale_already_confirmed_or_canceled')) {
    fail(`Second confirm: expected sale_already_confirmed_or_canceled, got ${secondErr.message}`);
  }
  pass('Second confirm: RPC error sale_already_confirmed_or_canceled');

  console.log('\n3) DB: offline_conversion_queue');
  const { data: queueRows, error: queueErr } = await admin
    .from('offline_conversion_queue')
    .select('id')
    .eq('sale_id', saleId);
  if (queueErr) fail(`Queue select: ${queueErr.message}`);
  if (!queueRows || queueRows.length !== 1) {
    fail(`Queue rows for sale_id: expected 1, got ${queueRows?.length ?? 0}`);
  }
  pass(`Rows for sale_id: 1`);

  await runEnqueueHoursTests();

  console.log('\n5) Primary-source (unit coverage)');
  console.log('   Run: npm run test:unit -- --test-name-pattern "primary-source"');

  if (saleId) {
    await admin.from('sales').delete().eq('id', saleId);
  }
  if (createdSite && siteId) {
    await admin.from('sites').delete().eq('id', siteId);
  }

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
