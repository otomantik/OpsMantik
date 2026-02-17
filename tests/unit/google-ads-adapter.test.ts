/**
 * PR-G3: Google Ads adapter unit tests with mocked HTTP.
 * PR8A: Strict error classification — 400/validation => FAILED; 429/5xx/timeout => RETRY (throw).
 * - Auth (401/403) => FAILED (returned, no throw)
 * - 400 validation => FAILED (returned)
 * - 429 => ProviderRateLimitError (throw) => RETRY
 * - 503 => ProviderTransientError (throw) => RETRY
 * - timeout/network => ProviderTransientError (throw) => RETRY
 * - Partial failure: INVALID_GCLID/RESOURCE_NOT_FOUND => FAILED; RESOURCE_EXHAUSTED => RETRY
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAdsAdapter, classifyGoogleAdsError } from '@/lib/providers/google_ads/adapter';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderValidationError,
  ProviderTransientError,
} from '@/lib/providers/errors';
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

test('uploadConversions: API 401 returns FAILED for batch (PR8A no retry)', async () => {
  const origFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async (url: unknown) => {
    callCount++;
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      return new Response(JSON.stringify({ error: { message: 'Unauthorized', status: 'UNAUTHENTICATED' } }), {
        status: 401,
      });
    }
    return new Response('', { status: 404 });
  };
  try {
    const results = await googleAdsAdapter.uploadConversions({
      jobs: [job('j1', 'gclid1')],
      credentials: validCreds,
    });
    assert.ok(callCount >= 2, 'token + API call');
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'FAILED');
    assert.ok(results[0].error_message?.includes('auth') || results[0].error_message?.includes('401'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: API 429 throws ProviderRateLimitError (RETRY)', async () => {
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

test('uploadConversions: API 400 invalid argument returns FAILED (PR8A no retry)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'Request contains an invalid argument.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        { status: 400 }
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
    assert.equal(results[0].status, 'FAILED');
    assert.ok(results[0].error_message?.includes('invalid') || results[0].error_message?.includes('INVALID'));
    assert.equal(results[0].error_code, 'INVALID_ARGUMENT');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: jobs without click id get FAILED with MISSING_CLICK_ID and provider_error_category (PR9)', async () => {
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
    assert.equal(results[0].provider_error_category, 'VALIDATION');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: partial_failure permanent error (Conversion not found) sets FAILED', async () => {
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
    assert.equal(r1?.provider_error_category, 'VALIDATION');
    assert.ok(r2 && r2.status === 'COMPLETED');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: partial_failure INVALID_GCLID / UNPARSEABLE_GCLID sets FAILED (PR8A)', async () => {
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
                    message: 'The gclid is not valid. INVALID_GCLID',
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
    assert.equal(results[0].status, 'FAILED');
    assert.ok(results[0].error_message?.includes('INVALID_GCLID') || results[0].error_message?.toLowerCase().includes('gclid'));
    assert.equal(results[0].provider_error_category, 'VALIDATION');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: COMPLETED result includes provider_request_id when API returns x-goog-request-id (PR9)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('uploadClickConversions')) {
      return new Response(
        JSON.stringify({ results: [{ order_id: 'order-j1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'x-goog-request-id': 'req-abc-123' } }
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
    assert.equal(results[0].status, 'COMPLETED');
    assert.equal(results[0].provider_request_id, 'req-abc-123');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: partial_failure RESOURCE_NOT_FOUND (conversion action) sets FAILED (PR8A)', async () => {
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
                    message: 'Resource not found. RESOURCE_NOT_FOUND',
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
    assert.equal(results[0].status, 'FAILED');
    assert.ok(results[0].error_message?.includes('RESOURCE_NOT_FOUND') || results[0].error_message?.includes('Resource not found'));
    assert.equal(results[0].provider_error_category, 'VALIDATION');
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
    assert.equal(results[0].provider_error_category, 'TRANSIENT');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: API 400 batch failure sets provider_error_category VALIDATION (PR9)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid', status: 'INVALID_ARGUMENT' } }),
        { status: 400 }
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
    assert.equal(results[0].status, 'FAILED');
    assert.equal(results[0].provider_error_category, 'VALIDATION');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: API 503 throws ProviderTransientError (RETRY)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      return new Response('Service Unavailable', { status: 503 });
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
      (e: unknown) => e instanceof ProviderTransientError
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('uploadConversions: network timeout throws ProviderTransientError (RETRY)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }
    if (u.includes('googleads.googleapis.com')) {
      const err = new Error('The operation was aborted.');
      (err as Error & { name: string }).name = 'AbortError';
      throw err;
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
      (e: unknown) => e instanceof ProviderTransientError
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('classifyGoogleAdsError: 400 => ProviderValidationError, retryable false', () => {
  const c = classifyGoogleAdsError(400, '{"error":{"message":"Invalid argument"}}');
  assert.equal(c.errorClass, 'ProviderValidationError');
  assert.equal(c.retryable, false);
  assert.ok(c.message.includes('Invalid') || c.message.includes('400'));
});

test('classifyGoogleAdsError: 429 => ProviderRateLimitError, retryable true', () => {
  const headers = new Headers({ 'retry-after': '120' });
  const c = classifyGoogleAdsError(429, 'Rate limit', headers);
  assert.equal(c.errorClass, 'ProviderRateLimitError');
  assert.equal(c.retryable, true);
});

test('classifyGoogleAdsError: 503 => ProviderTransientError, retryable true', () => {
  const c = classifyGoogleAdsError(503, 'Service Unavailable');
  assert.equal(c.errorClass, 'ProviderTransientError');
  assert.equal(c.retryable, true);
});
