/**
 * Golden checks: SiteExportConfig gear_weights align with Mizan IntentWeights mapping
 * and parseOciConfig delegates to parseExportConfig for currency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExportConfig } from '@/lib/oci/site-export-config';
import { parseOciConfig } from '@/lib/oci/oci-config';
import { computeLcv } from '@/lib/oci/lcv-engine';

test('gear_weights map to the same shape as getSiteValueConfig derivation', () => {
  const raw = {
    gear_weights: { V2: 0.03, V3: 0.25, V4: 0.35 },
  };
  const exp = parseExportConfig(raw);
  const derived = {
    pending: exp.gear_weights.V2,
    qualified: exp.gear_weights.V3,
    proposal: exp.gear_weights.V4,
    sealed: 1.0,
  };
  assert.deepEqual(derived, {
    pending: 0.03,
    qualified: 0.25,
    proposal: 0.35,
    sealed: 1.0,
  });
});

test('parseOciConfig uses SiteExportConfig currency when intelligence absent', () => {
  const r = parseOciConfig({ currency: 'USD', default_aov: 2000 });
  assert.equal(r.currency, 'USD');
  assert.equal(r.base_value, 2000);
});

test('computeLcv respects gearWeights override matching SiteExportConfig', () => {
  const exp = parseExportConfig({
    gear_weights: { V2: 0.02, V3: 0.2, V4: 0.3 },
    default_aov: 1000,
  });
  const lcv = computeLcv({
    stage: 'V3',
    baseAov: exp.default_aov,
    gearWeights: exp.gear_weights,
  });
  assert.equal(lcv.stageWeight, 0.2);
  assert.ok(lcv.valueCents > 0);
});

test('seal route uses canonical value for marketing_signals, not lcv money', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'calls', '[id]', 'seal', 'route.ts'), 'utf8');
  assert.ok(src.includes('expected_value_cents: canonicalValue.valueMinor'));
  assert.ok(!src.includes('expected_value_cents: lcv.valueCents'));
});
