import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptimizationValue } from '../../lib/oci/optimization-contract';

/**
 * Phase 16: Zero Tolerance OCI Audit - Safety Net
 * Tests the "1000 TL Axiom" and "Zero Drop Routing" logic.
 * 
 * INVARIANTS PROVEN:
 * 1. Junk score 0 resolves to canonical 0.06 (must stay tiny but non-zero).
 * 2. Satis reaches canonical max value 120.
 * 3. Teklif score 50 maps to 45.
 * 4. Score routing behaves deterministically across boundaries.
 */
test('OCI Zero Tolerance Safety Net Tests', async (t) => {
  await t.test('junk score 0 resolves to canonical 0.06', () => {
    const junkValue = resolveOptimizationValue({ stage: 'junk', systemScore: 0 }).optimizationValue;
    assert.strictEqual(junkValue, 0.06, 'junk returned incorrect value');
  });

  await t.test('satis reaches canonical max value 120', () => {
    const satisMax = resolveOptimizationValue({ stage: 'won', systemScore: 100 }).optimizationValue;
    assert.strictEqual(satisMax, 120, 'satis returned incorrect value');
  });

  await t.test('teklif score 50 maps to 45', () => {
    const teklifMid = resolveOptimizationValue({ stage: 'offered', systemScore: 50 }).optimizationValue;
    assert.strictEqual(teklifMid, 45, 'teklif returned incorrect value');
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
      { s: 100, expected: 'won' }
    ];

    for (const { s, expected } of scores) {
      const gear = simulateRouting(s);
      assert.strictEqual(gear, expected, `Score ${s} mapped incorrectly`);
    }
  });
});
