import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';

test('buildQueueItems blocks queue rows without call_id via export gate', () => {
  const built = buildQueueItems(
    {
      site: { timezone: 'UTC', currency: 'USD' },
    } as never,
    [
      {
        id: 'q1',
        call_id: null,
        occurred_at: '2026-05-05T10:00:00.000Z',
        conversion_time: '2026-05-05T10:00:00.000Z',
        created_at: '2026-05-05T10:00:00.000Z',
        value_cents: 100,
        optimization_value: 1,
        currency: 'USD',
        provider_key: 'google_ads',
        action: 'OpsMantik_Won',
        sale_id: null,
        session_id: null,
        gclid: 'gclid-valid-123456',
        wbraid: null,
        gbraid: null,
      },
    ] as never,
    {},
    {}
  );

  assert.equal(built.conversions.length, 0);
  assert.deepEqual(built.blockedExportGateIds, ['q1']);
  assert.deepEqual(built.blockedMissingConversionActionIds, []);
});
