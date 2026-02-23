/**
 * Regression: cross-tenant attribution must never occur.
 * Same fingerprint on site A and site B: site A must NOT inherit site B's past GCLID
 * (hasPastGclid must be false for site A when only site B has a gclid event).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AttributionService } from '@/lib/services/attribution-service';

const SITE_A_ID = '00000000-0000-0000-0000-000000000001';
const SITE_B_ID = '00000000-0000-0000-0000-000000000002';
const FINGERPRINT = 'same-fp-across-sites';
const URL = 'https://example.com/';
const REFERRER = 'https://www.google.com/';

function makeMockClient(siteIdWithPastGclid: string) {
  let capturedSiteId: string | null = null;

  const from = (table: string) => {
    if (table !== 'events')
      return { select: () => ({ eq: () => ({ not: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) };

    return {
      select: () => ({
        eq: (col: string, value: string) => {
          if (col === 'site_id') capturedSiteId = value;
          return {
            eq: () => ({
              not: () => ({
                in: () => ({
                  order: () => ({
                    limit: async () => {
                      const hasEvent = capturedSiteId === siteIdWithPastGclid;
                      return {
                        data: hasEvent ? [{ id: 'event-with-gclid' }] : [],
                        error: null,
                      };
                    },
                  }),
                }),
              }),
            }),
          };
        },
      }),
    };
  };

  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

test('AttributionService: site A with no past GCLID must NOT inherit site B gclid (same fingerprint)', async () => {
  const mock = makeMockClient(SITE_B_ID);

  const result = await AttributionService.resolveAttribution(
    SITE_A_ID,
    null,
    FINGERPRINT,
    URL,
    REFERRER,
    { client: mock }
  );

  assert.equal(result.hasPastGclid, false, 'Site A must not see past GCLID when only site B has it');
  assert.equal(result.attribution.source, 'Organic', 'Without past GCLID and no current gclid, source is Organic');
});

test('AttributionService: site B with past GCLID gets Ads Assisted when referrer is google', async () => {
  const mock = makeMockClient(SITE_B_ID);

  const result = await AttributionService.resolveAttribution(
    SITE_B_ID,
    null,
    FINGERPRINT,
    URL,
    'https://www.google.com/',
    { client: mock }
  );

  assert.equal(result.hasPastGclid, true, 'Site B must see its own past GCLID');
  assert.equal(result.attribution.source, 'Ads Assisted', 'Google referrer + past GCLID => Ads Assisted');
});

test('AttributionService: with current GCLID does not query past events', async () => {
  let queryCalled = false;
  const mock = {
    from: () => ({
      select: () => ({
        eq: () => {
          queryCalled = true;
          return { eq: () => ({ not: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
        },
      }),
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  const result = await AttributionService.resolveAttribution(
    SITE_A_ID,
    'current-gclid-xxx',
    FINGERPRINT,
    URL,
    REFERRER,
    { client: mock }
  );

  assert.equal(result.attribution.source, 'First Click (Paid)');
  assert.equal(queryCalled, false, 'Past-GCLID query must not run when currentGclid is present');
});
