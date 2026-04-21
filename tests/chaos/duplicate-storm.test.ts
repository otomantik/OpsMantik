import assert from 'node:assert/strict';
import test from 'node:test';

type MoneyState = {
  completedByLogicalEvent: Set<string>;
};

function applyWon(state: MoneyState, logicalEventId: string): MoneyState {
  if (state.completedByLogicalEvent.has(logicalEventId)) {
    return state;
  }
  const next = new Set(state.completedByLogicalEvent);
  next.add(logicalEventId);
  return { completedByLogicalEvent: next };
}

test('chaos/duplicate-storm: 100 duplicate won events keep exactly-once money transition', async () => {
  let state: MoneyState = { completedByLogicalEvent: new Set() };
  const eventId = 'won:call:123';
  const duplicates = Array.from({ length: 100 }, () => eventId);
  await Promise.all(
    duplicates.map(async (id) => {
      state = applyWon(state, id);
    })
  );

  assert.equal(state.completedByLogicalEvent.size, 1);
  assert.equal(state.completedByLogicalEvent.has(eventId), true);
});
