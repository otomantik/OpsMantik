import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { resolveMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';

test('resolveMarketingSignalEconomics: junk is fixed 10¢ + fixed_junk_exclusion', () => {
  const snap = buildOptimizationSnapshot({ stage: 'junk', systemScore: 20, actualRevenue: null });
  const r = resolveMarketingSignalEconomics({
    stage: 'junk',
    snapshot: snap,
    siteCurrency: 'TRY',
  });
  assert.equal(r.expectedValueCents, 10);
  assert.equal(r.conversionValueMajor, 0.1);
  assert.equal(r.valueSource, 'fixed_junk_exclusion');
  assert.equal(r.conversionTimeSource, 'ledger_stage_event');
  assert.equal(r.currencyCode, 'TRY');
});

test('resolveMarketingSignalEconomics: contacted uses stage model cents', () => {
  const snap = buildOptimizationSnapshot({ stage: 'contacted', systemScore: 60, actualRevenue: null });
  const r = resolveMarketingSignalEconomics({
    stage: 'contacted',
    snapshot: snap,
    siteCurrency: 'USD',
  });
  assert.equal(r.valueSource, 'stage_model');
  assert.ok(r.expectedValueCents > 0);
  assert.equal(r.currencyCode, 'USD');
});
