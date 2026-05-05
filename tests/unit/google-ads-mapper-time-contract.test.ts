import test from 'node:test';
import assert from 'node:assert/strict';
import { mapJobsToClickConversions } from '@/lib/providers/google_ads/mapper';

const creds = {
  customer_id: '123-456-7890',
  developer_token: 'dev',
  client_id: 'cid',
  client_secret: 'secret',
  refresh_token: 'rt',
  conversion_action_resource_name: 'customers/1234567890/conversionActions/123',
};

test('google ads mapper fails closed on invalid conversion_time', () => {
  assert.throws(
    () =>
      mapJobsToClickConversions(
        [
          {
            id: 'j1',
            site_id: 's1',
            provider_key: 'google_ads',
            payload: {
              conversion_time: 'not-a-date',
              value_cents: 100,
              currency: 'USD',
              click_ids: { gclid: 'gclid-valid-123456' },
            },
            occurred_at: '2026-05-05T10:00:00.000Z',
            amount_cents: 100,
            currency: 'USD',
            click_ids: { gclid: 'gclid-valid-123456' },
          },
        ],
        creds
      ),
    /INVALID_CONVERSION_TIME/
  );
});

