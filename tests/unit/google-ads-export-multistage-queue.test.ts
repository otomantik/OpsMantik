import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

const ctx = { site: { timezone: 'UTC', currency: 'USD' } } as never;

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 'q1',
    call_id: 'c1',
    occurred_at: '2026-05-05T10:00:00.000Z',
    conversion_time: '2026-05-05T10:00:00.000Z',
    created_at: '2026-05-05T10:00:00.000Z',
    value_cents: 100,
    optimization_value: 1,
    currency: 'USD',
    provider_key: 'google_ads',
    sale_id: null,
    session_id: 's1',
    gclid: 'g',
    wbraid: null,
    gbraid: null,
    external_id: 'ext-1',
    ...overrides,
  };
}

test('buildQueueItems: all four OpsMantik conversion names build items', () => {
  for (const name of Object.values(OPSMANTIK_CONVERSION_NAMES)) {
    const built = buildQueueItems(ctx, [baseRow({ id: `q-${name}`, action: name })] as never, {}, {});
    assert.equal(built.conversions.length, 1, name);
    assert.equal(built.conversions[0].conversionName, name);
  }
});

test('buildQueueItems: missing action uses optimization_stage when present', () => {
  const built = buildQueueItems(
    ctx,
    [baseRow({ id: 'q2', action: '', optimization_stage: 'contacted' })] as never,
    {},
    {}
  );
  assert.equal(built.conversions.length, 1);
  assert.equal(built.conversions[0].conversionName, 'OpsMantik_Contacted');
});

test('buildQueueItems: missing action and unknown stage blocks export', () => {
  const built = buildQueueItems(
    ctx,
    [baseRow({ id: 'q3', action: '', optimization_stage: '' })] as never,
    {},
    {}
  );
  assert.equal(built.conversions.length, 0);
  assert.deepEqual(built.blockedMissingConversionActionIds, ['q3']);
});
