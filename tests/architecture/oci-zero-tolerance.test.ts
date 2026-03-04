import { calculateConversionValueMinor } from '../../lib/domain/mizan-mantik/value-calculator';
import { OpsGear } from '../../lib/domain/mizan-mantik/types';

/**
 * Phase 16: Zero Tolerance OCI Audit - Safety Net
 * Tests the "1000 TL Axiom" and "Zero Drop Routing" logic.
 */
async function runTests() {
    console.log('🚀 Starting OCI Zero Tolerance Safety Net Tests...');

    // TEST 1: V1 Nabiz (PageView) must never be 0
    const v1Value = calculateConversionValueMinor({ gear: 'V1_PAGEVIEW' });
    if (v1Value === 1) {
        console.log('✅ TEST 1 PASSED: V1_PAGEVIEW returns 1 minor unit (0.01 TL).');
    } else {
        console.error(`❌ TEST 1 FAILED: V1_PAGEVIEW returned ${v1Value}, expected 1.`);
        process.exit(1);
    }

    // TEST 2: V5 Seal Fallback (The 1000 TL Axiom)
    const v5Fallback = calculateConversionValueMinor({ gear: 'V5_SEAL', saleAmountMinor: 0, minConversionValueCents: 100000 });
    if (v5Fallback === 100000) {
        console.log('✅ TEST 2 PASSED: V5_SEAL falls back to 100000 (1000 TL) when value is 0.');
    } else {
        console.error(`❌ TEST 2 FAILED: V5_SEAL returned ${v5Fallback}, expected 100000.`);
        process.exit(1);
    }

    const v5Actual = calculateConversionValueMinor({ gear: 'V5_SEAL', saleAmountMinor: 500000, minConversionValueCents: 100000 });
    if (v5Actual === 500000) {
        console.log('✅ TEST 3 PASSED: V5_SEAL respects actual sale amount (5000 TL).');
    } else {
        console.error(`❌ TEST 3 FAILED: V5_SEAL returned ${v5Actual}, expected 500000.`);
        process.exit(1);
    }

    // TEST 4: Threshold Banding Simulation
    function simulateRouting(score: number): string {
        if (score >= 90) return 'V5_SEAL';
        if (score >= 70) return 'V4_INTENT';
        if (score >= 50) return 'V3_ENGAGE';
        if (score >= 10) return 'V2_PULSE';
        return 'DROP';
    }

    const scores = [
        { s: 20, expected: 'V2_PULSE' },
        { s: 40, expected: 'V2_PULSE' },
        { s: 60, expected: 'V3_ENGAGE' },
        { s: 80, expected: 'V4_INTENT' },
        { s: 100, expected: 'V5_SEAL' },
        { s: 5, expected: 'DROP' }
    ];

    for (const { s, expected } of scores) {
        const gear = simulateRouting(s);
        if (gear === expected) {
            console.log(`✅ TEST PASSED: Score ${s} correctly mapped to ${gear}.`);
        } else {
            console.error(`❌ TEST FAILED: Score ${s} mapped to ${gear}, expected ${expected}.`);
            process.exit(1);
        }
    }

    console.log('\n🏆 ALL OCI ZERO TOLERANCE TESTS PASSED!');
}

runTests().catch(err => {
    console.error('💥 Test Execution Error:', err);
    process.exit(1);
});
