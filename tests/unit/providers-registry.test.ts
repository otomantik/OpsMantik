/**
 * Unit tests for provider registry (PR-G0).
 * - Unknown provider throws.
 * - google_ads returns adapter (stub) implementing IAdsProvider.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from '@/lib/providers/registry';
import type { IAdsProvider } from '@/lib/providers/types';

test('getProvider: unknown provider throws', () => {
  assert.throws(
    () => getProvider('meta'),
    { message: /Unsupported provider: meta/ }
  );
  assert.throws(
    () => getProvider('tiktok'),
    { message: /Unsupported provider: tiktok/ }
  );
  assert.throws(
    () => getProvider(''),
    { message: /Unsupported provider/ }
  );
});

test('getProvider: google_ads returns adapter implementing IAdsProvider', () => {
  const adapter = getProvider('google_ads');
  assert.ok(adapter);
  assert.equal((adapter as IAdsProvider).providerKey, 'google_ads');
  assert.equal(typeof (adapter as IAdsProvider).verifyCredentials, 'function');
  assert.equal(typeof (adapter as IAdsProvider).uploadConversions, 'function');
});

test('google_ads adapter: verifyCredentials resolves (stub)', async () => {
  const adapter = getProvider('google_ads');
  await assert.doesNotReject(adapter.verifyCredentials({}));
});

test('google_ads adapter: uploadConversions returns one result per job (stub RETRY)', async () => {
  const adapter = getProvider('google_ads');
  const results = await adapter.uploadConversions({
    jobs: [
      {
        id: 'j1',
        site_id: 's1',
        provider_key: 'google_ads',
        payload: {},
        occurred_at: new Date().toISOString(),
        amount_cents: 100,
        currency: 'USD',
        click_ids: { gclid: 'x' },
      },
    ],
    credentials: {},
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].job_id, 'j1');
  assert.equal(results[0].status, 'RETRY');
  assert.equal(results[0].error_code, 'STUB');
});
