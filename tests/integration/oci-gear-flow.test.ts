/**
 * PR-OCI-TEST: OCI gear flow behavior (0 TL seal, V3/V5 value).
 * - 0 TL: seal with sale_amount null/0 must NOT enqueue (no_sale_amount).
 * - V5 with value: seal with sale_amount > 0 enqueues with correct value_cents.
 * Requires: OCI_GEAR_TEST_SITE_ID and OCI_GEAR_TEST_CALL_ID (call with gclid + marketing consent) when running DB-backed tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { adminClient } from '@/lib/supabase/admin';

config({ path: join(process.cwd(), '.env.local') });

const TEST_SITE_ID = process.env.OCI_GEAR_TEST_SITE_ID?.trim();
const TEST_CALL_ID = process.env.OCI_GEAR_TEST_CALL_ID?.trim();
const HAS_SUPABASE =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireTestEnv() {
  if (!TEST_SITE_ID || !TEST_CALL_ID || !HAS_SUPABASE) {
    return { skip: true, reason: 'OCI_GEAR_TEST_SITE_ID, OCI_GEAR_TEST_CALL_ID and Supabase env required' };
  }
  return { skip: false };
}

test('PR-OCI-TEST: enqueueSealConversion with sale_amount null returns no_sale_amount and does not enqueue', async (t) => {
  const env = requireTestEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }
  const confirmedAt = new Date().toISOString();
  const result = await enqueueSealConversion({
    callId: TEST_CALL_ID!,
    siteId: TEST_SITE_ID!,
    confirmedAt,
    saleAmount: null,
    currency: 'TRY',
    leadScore: 100,
  });
  assert.equal(result.enqueued, false, 'must not enqueue when sale_amount is null');
  assert.equal(result.reason, 'no_sale_amount', 'reason must be no_sale_amount (0 TL mühür olmaz)');
});

test('PR-OCI-TEST: enqueueSealConversion with sale_amount 0 returns no_sale_amount', async (t) => {
  const env = requireTestEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }
  const confirmedAt = new Date().toISOString();
  const result = await enqueueSealConversion({
    callId: TEST_CALL_ID!,
    siteId: TEST_SITE_ID!,
    confirmedAt,
    saleAmount: 0,
    currency: 'TRY',
    leadScore: 100,
  });
  assert.equal(result.enqueued, false);
  assert.equal(result.reason, 'no_sale_amount');
});

test('PR-OCI-TEST: 500 TL seal enqueues with value_cents 50000 when call has click_id and consent', async (t) => {
  const env = requireTestEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }
  const confirmedAt = new Date().toISOString();
  const result = await enqueueSealConversion({
    callId: TEST_CALL_ID!,
    siteId: TEST_SITE_ID!,
    confirmedAt,
    saleAmount: 500,
    currency: 'TRY',
    leadScore: 100,
  });
  if (!result.enqueued && result.reason === 'no_click_id') {
    t.skip('Test call has no click_id; use a call with gclid/wbraid/gbraid for this test');
    return;
  }
  if (!result.enqueued && result.reason === 'marketing_consent_required') {
    t.skip('Test call session has no marketing consent');
    return;
  }
  assert.equal(result.enqueued, true, 'must enqueue when sale_amount is 500');
  assert.equal(result.value, 500, 'value in currency units must be 500');
  const { data: row } = await adminClient
    .from('offline_conversion_queue')
    .select('value_cents')
    .eq('call_id', TEST_CALL_ID!)
    .eq('site_id', TEST_SITE_ID!)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.ok(row, 'queue row must exist');
  assert.equal((row as { value_cents: number }).value_cents, 50000, '500 TRY = 50000 cents');
});
