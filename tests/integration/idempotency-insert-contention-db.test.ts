/**
 * Optional DB contention probe: parallel inserts on the same idempotency key.
 * Expect exactly one winner (inserted) and the rest duplicate (23505).
 *
 * Not part of `test:release-gates`. Run: `npm run test:db-chaos`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tryInsertIdempotencyKey } from '@/lib/idempotency';
import { adminClient } from '@/lib/supabase/admin';
import { requireStrictEnv, resolveStrictTestSiteId } from '@/tests/helpers/strict-ingest-helpers';

config({ path: join(process.cwd(), '.env.local') });

const PARALLEL = 20;

test('idempotency row: concurrent same-key inserts yield single insert + rest duplicate', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteIdUuid = await resolveStrictTestSiteId();
  if (!siteIdUuid) {
    t.skip('No test site id (STRICT_INGEST_TEST_SITE_ID / TEST_SITE_ID / first site row)');
    return;
  }

  const idempotencyKey = `chaos-idem-${randomUUID()}`;

  t.after(async () => {
    await adminClient.from('ingest_idempotency').delete().eq('site_id', siteIdUuid).eq('idempotency_key', idempotencyKey);
  });

  const results = await Promise.all(
    Array.from({ length: PARALLEL }, () =>
      tryInsertIdempotencyKey(siteIdUuid, idempotencyKey, {
        billable: false,
        billingReason: 'db_chaos_probe',
        eventCategory: 'test',
        eventAction: 'contention',
        eventLabel: null,
      }),
    ),
  );

  const inserted = results.filter((r) => r.inserted === true && r.duplicate === false).length;
  const duplicate = results.filter((r) => r.duplicate === true).length;
  const errors = results.filter((r) => r.error);

  assert.equal(inserted, 1, 'exactly one concurrent insert should win');
  assert.equal(duplicate, PARALLEL - 1, 'all other attempts should see duplicate key');
  assert.equal(errors.length, 0, `unexpected DB errors: ${JSON.stringify(errors)}`);
});
