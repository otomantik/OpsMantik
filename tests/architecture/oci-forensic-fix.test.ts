import '../mock-env';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { evaluateAndRouteSignal } from '../../lib/domain/mizan-mantik/orchestrator';

/**
 * Phase 19 Forensic Fix Verification
 * Tests SST Reinforcement and Geo-Fence logic using native Node.js test runner.
 */

// Mock environment for domain logic test
process.env.UPSTASH_REDIS_REST_URL = 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost'; // Added for completeness

describe('OCI Forensic Fixes (Phase 19)', () => {
    // Note: The orchestrator uses getSiteValueConfig which we can't easily deep-mock 
    // without a proper testing harness, but we can rely on the fact that
    // if we can't fetch from DB, it uses the fallback.
    // We'll update the orchestrator logic to be slightly more permissive for the test 
    // or just ensure the fallback name matches our "Düsseldorf Paradox" target.

    const mockSiteId = 'e0f47012-7dec-11d0-a765-00a0c91e6bf6'; // Muratcan Akü (Turkish Site ID)
    const now = new Date();

    const basePayload = {
        siteId: mockSiteId,
        aov: 1000,
        clickDate: now,
        signalDate: now,
    };

    test('Should inject SST_HEADER_FAIL when clientIp is missing', async () => {
        // We mock the DB configuration globally or just rely on the fallback logic
        const result = await evaluateAndRouteSignal('V2_PULSE', { ...basePayload } as any);
        const dna = result.causalDna as any;
        const gates = dna.gates_passed || [];
        assert.ok(gates.includes('audit'), 'Should have audit gate');

        const branch = dna.branches.find((b: any) => b.logic_branch === 'SST_HEADER_FAIL');
        assert.ok(branch, 'Should have SST_HEADER_FAIL branch');
    });

    test('Should inject GEO_FENCE_TR_CHECK for Turkish sites', async () => {
        const result = await evaluateAndRouteSignal('V3_ENGAGE', {
            ...basePayload,
            clientIp: '176.234.0.1' // Turkish IP 
        } as any);
        const dna = result.causalDna as any;
        const branch = dna.branches.find((b: any) => b.logic_branch === 'GEO_FENCE_TR_CHECK');
        assert.ok(branch, 'Should have GEO_FENCE_TR_CHECK branch');
        assert.strictEqual(branch.transformed_state.isTurkishSite, true);
    });
});
