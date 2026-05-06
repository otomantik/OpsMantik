import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptimizationValue } from '@/lib/oci/optimization-contract';

/**
 * Phase 16: Zero Tolerance OCI Audit — aligns with `resolveOptimizationValue` (stage-only majors).
 *
 * INVARIANTS:
 * 1. Junk stays tiny but non-zero (0.1 major units).
 * 2. Won stage base is 100 majors (economic base, not lead_score).
 * 3. Offered stage base is 50 regardless of systemScore.
 * 4. Lead-score routing simulation stays deterministic across boundaries.
 */
test('OCI Zero Tolerance Safety Net Tests', async (t) => {
  await t.test('junk resolves to canonical 0.1 majors', () => {
    const junkValue = resolveOptimizationValue({ stage: 'junk', systemScore: 0 }).optimizationValue;
    assert.strictEqual(junkValue, 0.1, 'junk returned incorrect value');
  });

  await t.test('won stage base is 100 majors', () => {
    const satisMax = resolveOptimizationValue({ stage: 'won', systemScore: 100 }).optimizationValue;
    assert.strictEqual(satisMax, 100, 'won returned incorrect value');
  });

  await t.test('offered stage base is 50 (systemScore ignored on value path)', () => {
    const teklifMid = resolveOptimizationValue({ stage: 'offered', systemScore: 50 }).optimizationValue;
    assert.strictEqual(teklifMid, 50, 'offered returned incorrect value');
  });

  await t.test('Score routing mapping', () => {
    function simulateRouting(score: number): string {
      if (score >= 100) return 'won';
      if (score >= 80) return 'offered';
      if (score > 0) return 'contacted';
      return 'junk';
    }

    const scores = [
      { s: 0, expected: 'junk' },
      { s: 20, expected: 'contacted' },
      { s: 40, expected: 'contacted' },
      { s: 60, expected: 'contacted' },
      { s: 80, expected: 'offered' },
      { s: 100, expected: 'won' },
    ];

    for (const { s, expected } of scores) {
      const gear = simulateRouting(s);
      assert.strictEqual(gear, expected, `Score ${s} mapped incorrectly`);
    }
  });
});
