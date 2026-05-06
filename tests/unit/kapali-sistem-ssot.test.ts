/**
 * Kapalı sistem planı — Faz 1 deterministik değer, Faz 2 politika/immutable, tek formül tekrar oynatma.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW,
  LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED,
  OPTIMIZATION_STAGE_BASES,
  buildOptimizationSnapshot,
  resolveOptimizationValue,
} from '@/lib/oci/optimization-contract';
import { toExpectedValueCents } from '@/lib/oci/marketing-signal-hash';
import { resolveMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';

const ROOT = process.cwd();

test('Faz 1: tek kanun id yürürlükte (stage_base_only_v1)', () => {
  assert.equal(CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW, 'stage_base_only_v1');
});

test('Faz 1: aynı stage için systemScore snapshot değişse de optimizationValue değişmez', () => {
  const low = resolveOptimizationValue({ stage: 'contacted', systemScore: 0 });
  const high = resolveOptimizationValue({ stage: 'contacted', systemScore: 100 });
  assert.equal(low.optimizationValue, high.optimizationValue);
  assert.equal(low.optimizationValue, OPTIMIZATION_STAGE_BASES.contacted);
});

test('Faz 1: replay — aynı snapshot + para birimi → aynı expected_value_cents', () => {
  const snapA = buildOptimizationSnapshot({ stage: 'won', systemScore: 0, actualRevenue: null });
  const snapB = buildOptimizationSnapshot({ stage: 'won', systemScore: 100, actualRevenue: null });
  assert.equal(snapA.optimizationValue, snapB.optimizationValue);
  const a = resolveMarketingSignalEconomics({ stage: 'won', snapshot: snapA, siteCurrency: 'TRY' });
  const b = resolveMarketingSignalEconomics({ stage: 'won', snapshot: snapB, siteCurrency: 'TRY' });
  assert.equal(a.expectedValueCents, b.expectedValueCents);
  assert.equal(a.expectedValueCents, toExpectedValueCents(snapA.optimizationValue));
});

test('Faz 2: stage tabanları tek modülde sabit (immutable contract)', () => {
  assert.deepEqual(OPTIMIZATION_STAGE_BASES, {
    junk: 0.1,
    contacted: 10,
    offered: 50,
    won: 100,
  });
  assert.equal(LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED, false);
});

test('Faz 4: sözleşmede binary geçitler ve deploy öncesi release-gates atfı', () => {
  const src = readFileSync(join(ROOT, 'docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md'), 'utf8');
  assert.ok(src.includes('G1'));
  assert.ok(src.includes('G5'));
  assert.ok(/test:release-gates|release-gates/i.test(src));
  assert.ok(/RED|STOP|yasak/i.test(src));
});

test('Faz 0: org SSOT seçimi A frontmatter’da', () => {
  const src = readFileSync(join(ROOT, 'docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md'), 'utf8');
  assert.ok(src.includes('ssot_100_choice: A'));
});
