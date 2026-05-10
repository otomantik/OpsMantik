import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';

const ROOT = process.cwd();
const ctxTry = { site: { timezone: 'UTC', currency: 'TRY' } } as never;

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 'q-cur-1',
    call_id: 'call-cur-1',
    occurred_at: '2026-05-05T10:00:00.000Z',
    conversion_time: '2026-05-05T10:00:00.000Z',
    created_at: '2026-05-05T10:00:00.000Z',
    value_cents: 100,
    optimization_value: 1,
    currency: 'TRY',
    provider_key: 'google_ads',
    action: 'OpsMantik_Won',
    sale_id: null,
    session_id: null,
    gclid: 'gclid-valid',
    wbraid: null,
    gbraid: null,
    external_id: 'ext-cur-1',
    ...overrides,
  };
}

test('currency provenance: keeps explicit queue currency and counts unexpected vs site currency', () => {
  const built = buildQueueItems(ctxTry, [baseRow({ currency: 'USD' })] as never, {}, {}, {});
  assert.equal(built.conversions.length, 1);
  assert.equal(built.conversions[0].conversionCurrency, 'USD');
  assert.equal(built.currencyDiagnostics.currency_unexpected_count, 1);
  assert.equal(built.currencyDiagnostics.currency_defaulted_count, 0);
});

test('currency provenance: defaults to site currency when queue currency missing', () => {
  const built = buildQueueItems(ctxTry, [baseRow({ currency: null })] as never, {}, {}, {});
  assert.equal(built.conversions.length, 1);
  assert.equal(built.conversions[0].conversionCurrency, 'TRY');
  assert.equal(built.currencyDiagnostics.currency_defaulted_count, 1);
  assert.equal(built.currencyDiagnostics.currency_missing_count, 0);
});

test('currency provenance: blocks row when queue and site currency are both missing', () => {
  const ctxMissing = { site: { timezone: 'UTC', currency: '' } } as never;
  const built = buildQueueItems(ctxMissing, [baseRow({ currency: '' })] as never, {}, {}, {});
  assert.equal(built.conversions.length, 0);
  assert.deepEqual(built.blockedCurrencyIds, ['q-cur-1']);
  assert.equal(built.currencyDiagnostics.currency_missing_count, 1);
});

test('no silent USD fallback in sweep/maintenance enqueue callers', () => {
  const sweep = readFileSync(join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts'), 'utf8');
  const maintenance = readFileSync(join(ROOT, 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');
  assert.ok(!sweep.includes("normalizeCurrencyOrNeutral('')"));
  assert.ok(sweep.includes('sale_currency'));
  assert.ok(maintenance.includes('sale_currency'));
});

