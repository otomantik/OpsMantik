import assert from 'node:assert/strict';
import test from 'node:test';

type OutboxRow = {
  status: 'PROCESSING' | 'PENDING' | 'DEAD_LETTER_QUARANTINE';
  claimedAtIso: string;
  attemptCount: number;
};

function rescueZombie(row: OutboxRow, nowIso: string): OutboxRow {
  const ageMs = new Date(nowIso).getTime() - new Date(row.claimedAtIso).getTime();
  const maxAgeMs = 31 * 60 * 1000;
  if (row.status !== 'PROCESSING' || ageMs < maxAgeMs) return row;
  if (row.attemptCount >= 5) {
    return { ...row, status: 'DEAD_LETTER_QUARANTINE' };
  }
  return { ...row, status: 'PENDING', attemptCount: row.attemptCount + 1 };
}

test('chaos/outbox-zombie: row stuck 31m is deterministically recovered', () => {
  const row: OutboxRow = {
    status: 'PROCESSING',
    claimedAtIso: '2026-01-01T00:00:00.000Z',
    attemptCount: 1,
  };
  const rescued = rescueZombie(row, '2026-01-01T00:31:01.000Z');
  assert.equal(rescued.status, 'PENDING');
  assert.equal(rescued.attemptCount, 2);
});
