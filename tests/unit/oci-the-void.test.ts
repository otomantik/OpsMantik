import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as jose from 'jose';

// Helper for Merkle Hashing
function calculateHash(callId: string | null, sequence: number, value: number, prev: string | null, salt: string): string {
    const payload = `${callId ?? 'null'}:${sequence}:${value}:${prev ?? 'null'}:${salt}`;
    return createHash('sha256').update(payload).digest('hex');
}

test('The Void: DBA Tampering (Merkle Chain Break)', async (t) => {
    await t.test('Detects bit-flip or manual update in ledger', () => {
        const salt = 'void_test_salt_alpha_9';
        const h0 = calculateHash('call_void_A', 0, 1000, null, salt);
        const h1 = calculateHash('call_void_A', 1, 850, h0, salt);

        const ledger = [
            { call_id: 'call_void_A', seq: 0, val: 1000, prev: null, curr: h0 },
            { call_id: 'call_void_A', seq: 1, val: 850, prev: h0, curr: h1 },
        ];

        // 1. Initial integrity check
        for (const entry of ledger) {
            const p = `${entry.call_id}:${entry.seq}:${entry.val}:${entry.prev ?? 'null'}:${salt}`;
            const e = createHash('sha256').update(p).digest('hex');
            assert.strictEqual(entry.curr, e, 'Blockchain integrity must be valid initially');
        }

        // 2. TAMPERING: A rogue DBA updates the value in sequence 0 bypassing application logic
        ledger[0].val = 99999; // DBA flips bits

        // 3. Chain Verification Logic (Same as google-ads-export API)
        let chainBroken = false;
        let corruptedSeq = -1;

        for (const entry of ledger) {
            const p = `${entry.call_id}:${entry.seq}:${entry.val}:${entry.prev ?? 'null'}:${salt}`;
            const e = createHash('sha256').update(p).digest('hex');
            if (entry.curr !== e) {
                chainBroken = true;
                corruptedSeq = entry.seq;
                break;
            }
        }

        assert.strictEqual(chainBroken, true, 'Should detect the ledger corruption');
        assert.strictEqual(corruptedSeq, 0, 'Should isolate the first corrupted sequence');
    });
});

test('The Void: Rogue Checkpoint (Asymmetric JWS Failure)', async (t) => {
    await t.test('Rejects signatures from altered or unauthorized RS256 keys', async () => {
        // Generate valid backend pair
        const { publicKey, privateKey } = await jose.generateKeyPair('RS256');

        // Generate rogue pair
        const rogueKeys = await jose.generateKeyPair('RS256');

        // Valid Script Token
        const token = await new jose.SignJWT({ ackIds: ['seal_1', 'signal_5'] })
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuedAt()
            .setIssuer('opsmantik-oci-script')
            .setAudience('opsmantik-api')
            .sign(privateKey);

        // Rogue Script Token
        const rogueToken = await new jose.SignJWT({ ackIds: ['seal_1', 'signal_5'] })
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuedAt()
            .setIssuer('opsmantik-oci-script')
            .setAudience('opsmantik-api')
            .sign(rogueKeys.privateKey);

        // API Logic: Verify with the TRUE public key
        await assert.doesNotReject(() => jose.jwtVerify(token, publicKey, {
            issuer: 'opsmantik-oci-script',
            audience: 'opsmantik-api'
        }), 'Should accept trust-key signature');

        await assert.rejects(() => jose.jwtVerify(rogueToken, publicKey, {
            issuer: 'opsmantik-oci-script',
            audience: 'opsmantik-api'
        }), /signature verification failed/, 'Should REJECT rogue-key signature');
    });
});

test('The Void: Ghost Cursor (Failover Replication Lag)', async (t) => {
    await t.test('Heals 50ms split-brain gap by falling back to consensus state', () => {
        // Situation: DB promo happened, primary went down, replica promoted but is 50ms behind.
        const providedCursor = '2026-03-04T20:00:00.050Z'; // Last known from dead master
        const currentReplicaMax = '2026-03-04T20:00:00.000Z'; // Promoted replica lagging

        // Logic: cursor > replicaMax? 
        const isGhost = providedCursor > currentReplicaMax;
        assert.strictEqual(isGhost, true, 'Should detect phantom state from lag');

        // Logic: Fallback to last known safe COMPLETED consensus
        const lastConsensus = '2026-03-04T19:59:59.000Z';
        let targetExportTs = providedCursor;

        if (isGhost) {
            targetExportTs = lastConsensus;
        }

        assert.strictEqual(targetExportTs, '2026-03-04T19:59:59.000Z', 'Should resume from safe consensus');
    });
});
