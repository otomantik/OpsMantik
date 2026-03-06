/**
 * DB-backed proof that finalized sale identity fields cannot be mutated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { adminClient } from '@/lib/supabase/admin';
import { requireStrictEnv, resolveStrictTestSiteId } from '@/tests/helpers/strict-ingest-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('sales trigger rejects monetary identity mutation after confirmation', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteId = await resolveStrictTestSiteId();
  if (!siteId) {
    t.skip('No test site available for finalized sale immutability test');
    return;
  }

  const occurredAt = new Date().toISOString();
  const { data: saleRow, error: saleError } = await adminClient
    .from('sales')
    .insert({
      site_id: siteId,
      occurred_at: occurredAt,
      amount_cents: 9900,
      currency: 'TRY',
      status: 'CONFIRMED',
      external_ref: `finalized-immutable-${Date.now()}`,
      customer_hash: 'customer-hash-a',
    })
    .select('id')
    .single();

  if (saleError || !saleRow?.id) {
    t.skip(`Could not create confirmed sale fixture: ${saleError?.message ?? 'no data'}`);
    return;
  }

  t.after(async () => {
    await adminClient.from('sales').delete().eq('id', saleRow.id);
  });

  const { data, error } = await adminClient
    .from('sales')
    .update({
      amount_cents: 15000,
      currency: 'USD',
      customer_hash: 'customer-hash-b',
    })
    .eq('id', saleRow.id)
    .select('id')
    .single();

  assert.equal(data, null, 'failed mutation must not return a sale payload');
  assert.ok(error, 'confirmed sale identity mutation must be rejected');
  assert.match(error?.message ?? '', /finalized identity fields are immutable/i);

  const { data: saleAfter } = await adminClient
    .from('sales')
    .select('amount_cents, currency, customer_hash')
    .eq('id', saleRow.id)
    .single();

  assert.equal(saleAfter?.amount_cents, 9900, 'amount must remain unchanged');
  assert.equal(saleAfter?.currency, 'TRY', 'currency must remain unchanged');
  assert.equal(saleAfter?.customer_hash, 'customer-hash-a', 'customer hash must remain unchanged');
});
