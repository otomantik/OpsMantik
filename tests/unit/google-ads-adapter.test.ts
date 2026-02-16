/**
 * PR-G3: Google Ads adapter unit tests with mocked HTTP.
 * - Auth error throws ProviderAuthError
 * - Rate limit (429) throws ProviderRateLimitError
 * - Partial failure parsing sets correct job statuses (RETRY vs COMPLETED)
 * - Jobs without click id get FAILED
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAdsAdapter } from '@/lib/providers/google_ads/adapter';
import { ProviderAuthError, ProviderRateLimitError, ProviderValidationError } from '@/lib/providers/errors';
import type { ConversionJob } from '@/lib/providers/types';

const validCreds = {
  customer_id: '123-456-7890',
  developer_token: 'dev',
  client_id: 'cid',
  client_secret: 'secret',
  refresh_token: 'rt',
  conversion_action_resource_name: 'customers/1234567890/conversionActions/123',
};

function job(id: string, gclid?: string | null): ConversionJob {
  return {
    id,
    site_id: 's1',
    provider_key: 'google_ads',
    payload: {
      conversion_time: '2024-01-15T12:00:00.000Z',
      value_cents: 1000,
      currency: 'USD',
      click_ids: { gclid: gclid ?? null, wbraid: null, gbraid: null },
      order_id: `order-${id}`,
    },
    occurred_at: '2024-01-15T12:00:00.000Z',
    amount_cents: 1000,
    currency: 'USD',
    click_ids: { gclid: gclid ?? null, wbraid: null, gbraid: null },
  };
}

test('verifyCredentials: missing conversion_action_resource_name throws ProviderValidationError', async () => {
  const creds = { ...validCreds, conversion_action_resource_name: '' };
  await assert.rejects(
    () => googleAdsAdapter.verifyCredentials(creds),
    ProviderValidationError
  );
});

test('verifyCredentials: invalid creds shape throws ProviderValidationError', async () => {
  await assert.rejects(
    () => googleAdsAdapter.verifyCredentials({}),
    ProviderValidationError
  );
});

test('verifyCredentials: token refresh 401 throws ProviderAuthError', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 });
  try {
    await assert.rejects(
      () => googleAdsAdapter.verifyCredentials(validCreds),
      ProviderAuthError
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyCredentials: token refresh 200 with access_token resolves', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  try {
    await assert.doesNotReject(() => googleAdsAdapter.verifyCredentials(validCreds));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: API 401 throws ProviderAuthError', async () => {
  const origFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async (url: unknown) => {
    callCount++;
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      return new Response('Unauthorized', { status: 401 });
    }
    return new Response('', { status: 404 });
  };
  try {
    await assert.rejects(
      () =>
        googleAdsAdapter.uploadConversions({
          jobs: [job('j1', 'gclid1')],
          credentials: validCreds,
        }),
      ProviderAuthError
    );
    assert.ok(callCount >= 2, 'token + API call');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: API 429 throws ProviderRateLimitError', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      return new Response('Rate limit', { status: 429, headers: { 'Retry-After': '60' } });
    }
    return new Response('', { status: 404 });
  };
  try {
    await assert.rejects(
      () =>
        googleAdsAdapter.uploadConversions({
          jobs: [job('j1', 'gclid1')],
          credentials: validCreds,
        }),
      (e: unknown) => e instanceof ProviderRateLimitError && e.retryAfter === 60
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: jobs without click id get FAILED with MISSING_CLICK_ID', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
  };
  try {
    const results = await googleAdsAdapter.uploadConversions({
      jobs: [job('j1', null)],
      credentials: validCreds,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].job_id, 'j1');
    assert.equal(results[0].status, 'FAILED');
    assert.equal(results[0].error_code, 'MISSING_CLICK_ID');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: partial_failure permanent error (e.g. Conversion not found) sets FAILED', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('uploadClickConversions')) {
      return new Response(
        JSON.stringify({
          partial_failure_error: {
            code: 3,
            message: 'partial',
            details: [
              {
                '@type': 'type.googleapis.com/google.ads.googleads.v19.errors.GoogleAdsFailure',
                errors: [
                  {
                    message: 'Conversion not found',
                    location: { field_path_elements: [{ index: 0 }] },
                  },
                ],
              },
            ],
          },
          results: [{ order_id: 'order-j2' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('', { status: 404 });
  };
  try {
    const results = await googleAdsAdapter.uploadConversions({
      jobs: [job('j1', 'gclid1'), job('j2', 'gclid2')],
      credentials: validCreds,
    });
    assert.equal(results.length, 2);
    const r1 = results.find((r) => r.job_id === 'j1');
    const r2 = results.find((r) => r.job_id === 'j2');
    assert.ok(r1 && r1.status === 'FAILED' && r1.error_message?.includes('Conversion not found'));
    assert.ok(r2 && r2.status === 'COMPLETED');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: partial_failure transient error (RESOURCE_EXHAUSTED) sets RETRY', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('uploadClickConversions')) {
      return new Response(
        JSON.stringify({
          partial_failure_error: {
            details: [
              {
                errors: [
                  {
                    message: 'RESOURCE_EXHAUSTED: Quota exceeded',
                    location: { field_path_elements: [{ index: 0 }] },
                  },
                ],
              },
            ],
          },
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('', { status: 404 });
  };
  try {
    const results = await googleAdsAdapter.uploadConversions({
      jobs: [job('j1', 'gclid1')],
      credentials: validCreds,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'RETRY');
    assert.ok(results[0].error_message?.includes('RESOURCE_EXHAUSTED'));
  } finally {
    globalThis.fetch = origFetch;
  }
});
