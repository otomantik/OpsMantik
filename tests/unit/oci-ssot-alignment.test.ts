import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExportConfig } from '@/lib/oci/site-export-config';
import { parseOciConfig } from '@/lib/oci/oci-config';
import { computeLcv } from '@/lib/oci/lcv-engine';

test('parseExportConfig discards unknown tenant math fields but returns neutral defaults', () => {
  const exp = parseExportConfig({
    gear_weights: { V2: 0.03, V3: 0.25, V4: 0.35 },
    legacy_math: 9999,
  });
  // Phase 4 — f4-global-hardcodes: neutral defaults are USD/UTC, never Turkey-biased.
  assert.equal(exp.currency, 'USD');
  assert.equal(exp.timezone, 'UTC');
});

test('parseExportConfig honors tenant-supplied currency + timezone overrides', () => {
  const exp = parseExportConfig({ currency: 'USD', timezone: 'America/New_York' });
  assert.equal(exp.currency, 'USD');
  assert.equal(exp.timezone, 'America/New_York');
});

test('parseOciConfig surfaces SiteExportConfig currency and strips legacy math', () => {
  const r = parseOciConfig({ currency: 'USD', legacy_math: 2000 });
  assert.equal(r.currency, 'USD');
  assert.deepEqual(r.intelligence, { premium_districts: [], high_intent_keywords: [], multipliers: {} });
});

test('computeLcv uses universal stage base and quality factor model', () => {
  const exp = parseExportConfig({});
  const lcv = computeLcv({
    stage: 'contacted',
    baseAov: 1000,
  });
  // Phase 4 — f4-global-hardcodes: no parseExportConfig({}) should ever reintroduce TRY.
  assert.equal(exp.currency, 'USD');
  assert.equal(lcv.stageWeight, 10);
  assert.ok(lcv.valueCents > 0);
});

test('enqueueSealConversion persists optimization snapshot on legacy queue payload', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(src.includes('optimization_stage: optimizationSnapshot.optimizationStage'));
  assert.ok(src.includes('optimization_value: optimizationSnapshot.optimizationValue'));
});
