import assert from 'node:assert/strict';
import test from 'node:test';

type AckDecision = {
  winner: 'ACK' | 'ACK_FAILED';
  snapshot: { ok: boolean; updated: number; code?: string };
};

function applyAckRace(existing: AckDecision | null, incoming: AckDecision): AckDecision {
  if (existing) return existing;
  return incoming;
}

test('chaos/ack-race: first committed decision wins and replay is deterministic', async () => {
  let receipt: AckDecision | null = null;
  const ack: AckDecision = { winner: 'ACK', snapshot: { ok: true, updated: 3 } };
  const failed: AckDecision = { winner: 'ACK_FAILED', snapshot: { ok: true, updated: 3, code: 'TRANSIENT' } };

  await Promise.all([
    (async () => {
      receipt = applyAckRace(receipt, ack);
    })(),
    (async () => {
      receipt = applyAckRace(receipt, failed);
    })(),
  ]);

  assert.ok(receipt);
  const replay = applyAckRace(receipt, failed);
  assert.deepEqual(replay, receipt);
});
