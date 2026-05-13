import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExportConfig } from '@/lib/oci/site-export-config';
import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';

const exportCtx = { site: { timezone: 'UTC', currency: 'USD' }, exportConfig: parseExportConfig(null) } as never;

test('buildQueueItems blocks queue rows without call_id via export gate', () => {
  const built = buildQueueItems(
    exportCtx,
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

test('buildQueueItems blocks queue rows with no click ids when require_click_id', () => {
  const built = buildQueueItems(
    exportCtx,
    [
      {
        id: 'q-no-click',
        call_id: 'c-nc',
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
        gclid: null,
        wbraid: null,
        gbraid: null,
      },
    ] as never,
    {},
    {}
  );

  assert.equal(built.conversions.length, 0);
  assert.deepEqual(built.blockedExportGateIds, ['q-no-click']);
});
