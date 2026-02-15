/**
 * Unit tests for provider registry (PR-G0 / PR-G3).
 * - Unknown provider throws.
 * - google_ads returns adapter implementing IAdsProvider (real adapter since PR-G3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from '@/lib/providers/registry';
import type { IAdsProvider } from '@/lib/providers/types';

const validGoogleAdsCreds = {
  customer_id: '123-456-7890',
  developer_token: 'dev',
  client_id: 'cid',
  client_secret: 'secret',
  refresh_token: 'rt',
  conversion_action_resource_name: 'customers/1234567890/conversionActions/123',
};

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

test('google_ads adapter: verifyCredentials resolves with valid creds when token endpoint returns 200', async () => {
  const adapter = getProvider('google_ads');
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  try {
    await assert.doesNotReject(adapter.verifyCredentials(validGoogleAdsCreds));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('google_ads adapter: uploadConversions returns one result per job', async () => {
  const adapter = getProvider('google_ads');
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (String(url).includes('uploadClickConversions')) {
      return new Response(JSON.stringify({ results: [{ order_id: 'order-j1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  };
  try {
    const results = await adapter.uploadConversions({
      jobs: [
        {
          id: 'j1',
          site_id: 's1',
          provider_key: 'google_ads',
          payload: { conversion_time: new Date().toISOString(), value_cents: 100, currency: 'USD', click_ids: { gclid: 'x' } },
          occurred_at: new Date().toISOString(),
          amount_cents: 100,
          currency: 'USD',
          click_ids: { gclid: 'x' },
        },
      ],
      credentials: validGoogleAdsCreds,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].job_id, 'j1');
    assert.ok(['COMPLETED', 'FAILED', 'RETRY'].includes(results[0].status));
  } finally {
    globalThis.fetch = origFetch;
  }
});
