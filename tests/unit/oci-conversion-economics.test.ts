import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOciConversionEconomics } from '@/lib/oci/oci-conversion-economics';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';

test('resolveOciConversionEconomics: junk is fixed 10¢ + fixed_junk_exclusion', () => {
  const snap = buildOptimizationSnapshot({ stage: 'junk', systemScore: 0, modelVersion: 'v1' });
  const r = resolveOciConversionEconomics({
    stage: 'junk',
    snapshot: snap,
    siteCurrency: 'TRY',
  });
  assert.equal(r.expectedValueCents, 10);
  assert.equal(r.valueSource, 'fixed_junk_exclusion');
});

test('resolveOciConversionEconomics: contacted uses stage model cents', () => {
  const snap = buildOptimizationSnapshot({ stage: 'contacted', systemScore: 0, modelVersion: 'v1' });
  const r = resolveOciConversionEconomics({
    stage: 'contacted',
    snapshot: snap,
    siteCurrency: 'TRY',
  });
  assert.equal(r.expectedValueCents, 1000);
  assert.equal(r.valueSource, 'stage_model');
});
