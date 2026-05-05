import test from 'node:test';
import assert from 'node:assert/strict';
import { queueRowToConversionJob, type QueueRow } from '@/lib/cron/process-offline-conversions';

function baseRow(): QueueRow {
  return {
    id: 'q1',
    site_id: 's1',
    provider_key: 'google_ads',
    payload: { conversion_time: '2001-01-01T00:00:00.000Z' },
    conversion_time: '2026-05-05T10:00:00.000Z',
    occurred_at: '2026-05-04T09:00:00.000Z',
    value_cents: 100,
    currency: 'USD',
    gclid: 'gclid-valid-123456',
  };
}

test('queueRowToConversionJob uses row.conversion_time as SSOT over payload', () => {
  const row = baseRow();
  const job = queueRowToConversionJob(row);
  assert.equal(job.occurred_at, '2026-05-05T10:00:00.000Z');
});

test('queueRowToConversionJob fails closed when row timestamps are missing', () => {
  const row = baseRow();
  row.conversion_time = '';
  row.occurred_at = null;
  assert.throws(() => queueRowToConversionJob(row), /INVALID_CONVERSION_TIME/);
});

