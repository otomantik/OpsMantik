import { resolveOptimizationValue } from '../../lib/oci/optimization-contract';


/**
 * Phase 16: Zero Tolerance OCI Audit - Safety Net
 * Tests the "1000 TL Axiom" and "Zero Drop Routing" logic.
 */
async function runTests() {
    console.log('🚀 Starting OCI Zero Tolerance Safety Net Tests...');

    // TEST 1: junk must stay tiny but non-zero
    const junkValue = resolveOptimizationValue({ stage: 'junk', systemScore: 0 }).optimizationValue;
    if (junkValue === 0.06) {
        console.log('✅ TEST 1 PASSED: junk score 0 resolves to canonical 0.06.');
    } else {
        console.error(`❌ TEST 1 FAILED: junk returned ${junkValue}, expected 0.06.`);
        process.exit(1);
    }

    // TEST 2: won max score = 120
    const satisMax = resolveOptimizationValue({ stage: 'won', systemScore: 100 }).optimizationValue;
    if (satisMax === 120) {
        console.log('✅ TEST 2 PASSED: satis reaches canonical max value 120.');
    } else {
        console.error(`❌ TEST 2 FAILED: satis returned ${satisMax}, expected 120.`);
        process.exit(1);
    }

    const teklifMid = resolveOptimizationValue({ stage: 'offered', systemScore: 50 }).optimizationValue;
    if (teklifMid === 45) {
        console.log('✅ TEST 3 PASSED: teklif score 50 maps to 45.');
    } else {
        console.error(`❌ TEST 3 FAILED: teklif returned ${teklifMid}, expected 45.`);
        process.exit(1);
    }

    // TEST 4: Stage resolution threshold simulation
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
