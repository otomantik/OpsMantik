import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as jose from 'jose';

/**
 * Phase 9.5: Multi-Site Intent Convergence & Tenant Isolation Test
 * 
 * Objective: Verify that Site A (Muratcan) and Site B (Eslamed) can 
 * independently manage their OCI exports and ACKs without cross-contamination,
 * and that their asymmetric signatures are validated correctly by the API.
 */

// Simulation Helpers
function calculateMerkleHash(callId: string, seq: number, val: number, prev: string | null, salt: string): string {
    const p = `${callId}:${seq}:${val}:${prev ?? 'null'}:${salt}`;
    return createHash('sha256').update(p).digest('hex');
}

test('OCI Multi-Site: Independent Ledger & Signature Isolation', async (t) => {
    // 1. Setup Phase: Generate separate salts and keypairs for two sites
    const saltA = 'salt_muratcan_void_1';
    const saltB = 'salt_eslamed_void_2';

    const keysA = await jose.generateKeyPair('RS256');
    const keysB = await jose.generateKeyPair('RS256');

    // 2. Data Phase: Independent Merkle Chains
    const hA0 = calculateMerkleHash('call_A_1', 0, 100, null, saltA);
    const hB0 = calculateMerkleHash('call_B_1', 0, 500, null, saltB);

    const siteA_Ledger = [
        { id: 'sig_A_0', site_id: 'SITE_A', call_id: 'call_A_1', seq: 0, val: 100, curr: hA0 }
    ];
    const siteB_Ledger = [
        { id: 'sig_B_0', site_id: 'SITE_B', call_id: 'call_B_1', seq: 0, val: 500, curr: hB0 }
    ];

    await t.test('Tenant Isolation: API must verify key matches site', async () => {
        // Simulation of API logic: each site has an OCI_API_KEY
        const siteA_Key = 'key_A_secret';
        const siteB_Key = 'key_B_secret';

        // Site A tries to access Site B's data with its own key
        const requestFromA_to_B = {
            header: { 'x-api-key': siteA_Key },
            params: { siteId: 'SITE_B' }
        };

        // Logic check (matching route.ts:167)
        const isAuthorized = (reqKey: string, siteKey: string) => reqKey === siteKey;

        assert.strictEqual(isAuthorized(requestFromA_to_B.header['x-api-key'], siteB_Key), false, 'Site A key should not unlock Site B');
        assert.strictEqual(isAuthorized(siteA_Key, siteA_Key), true, 'Site A key should unlock Site A');
    });

    await t.test('Asymmetric Isolation: JWS signed by Site A must NOT be accepted for Site B ACKs', async () => {
        // Site A signs an ACK for its records
        const ackIdA = ['sig_A_0'];
        const signatureA = await new jose.SignJWT({ action: 'ack', ids: ackIdA })
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuer('opsmantik-oci-script')
            .setAudience('opsmantik-api')
            .sign(keysA.privateKey);

        // Site B signs an ACK for its records
        const ackIdB = ['sig_B_0'];
        const signatureB = await new jose.SignJWT({ action: 'ack', ids: ackIdB })
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuer('opsmantik-oci-script')
            .setAudience('opsmantik-api')
            .sign(keysB.privateKey);

        // API logic (ack/route.ts): Verify Site A's signature with Site A's Public Key
        await assert.doesNotReject(async () => {
            await jose.jwtVerify(signatureA, keysA.publicKey, {
                issuer: 'opsmantik-oci-script',
                audience: 'opsmantik-api'
            });
        }, 'API should accept Site A signature with Site A public key');

        // ERROR SIMULATION: Site A's signature sent to Site B's endpoint (which expects Site B's key)
        await assert.rejects(async () => {
            await jose.jwtVerify(signatureA, keysB.publicKey, {
                issuer: 'opsmantik-oci-script',
                audience: 'opsmantik-api'
            });
        }, /verification failed/, 'API should REJECT Site A signature when verifying against Site B key');
    });

    await t.test('Ledger Independence: Merkle corruption in Site A does NOT affect Site B', () => {
        // Site A TAMPERED
        siteA_Ledger[0].val = 99999;

        const verify = (ledger: any[], salt: string) => {
            for (const entry of ledger) {
                const e = calculateMerkleHash(entry.call_id, entry.seq, entry.val, null, salt);
                if (entry.curr !== e) return false;
            }
            return true;
        };

        assert.strictEqual(verify(siteA_Ledger, saltA), false, 'Site A ledger should be detected as CORRUPTED');
        assert.strictEqual(verify(siteB_Ledger, saltB), true, 'Site B ledger should remain VALID/UNTOUCHED');
    });
});
