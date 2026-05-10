import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseIntentQueueJournalParity,
  parityDiagnosticToClassificationHint,
} from '@/lib/oci/intent-queue-parity-guard';

test('parity guard: missing queue row', () => {
  const d = diagnoseIntentQueueJournalParity({
    expectedConversionName: 'OpsMantik_Contacted',
    rowsForCall: [{ action: 'OpsMantik_Won', status: 'QUEUED' }],
  });
  assert.equal(d, 'QUEUE_ROW_MISSING');
});

test('parity guard: completed row', () => {
  const d = diagnoseIntentQueueJournalParity({
    expectedConversionName: 'OpsMantik_Won',
    rowsForCall: [{ action: 'OpsMantik_Won', status: 'COMPLETED', updated_at: '2026-01-01T00:00:00.000Z' }],
  });
  assert.equal(d, 'QUEUE_ROW_COMPLETED');
});

test('parity guard: blocked / failed', () => {
  assert.equal(
    diagnoseIntentQueueJournalParity({
      expectedConversionName: 'OpsMantik_Offered',
      rowsForCall: [{ action: 'OpsMantik_Offered', status: 'FAILED' }],
    }),
    'QUEUE_ROW_BLOCKED'
  );
  assert.equal(
    diagnoseIntentQueueJournalParity({
      expectedConversionName: 'OpsMantik_Contacted',
      rowsForCall: [
        {
          action: 'OpsMantik_Contacted',
          status: 'BLOCKED_PRECEDING_SIGNALS',
          block_reason: 'MISSING_CLICK_ID',
        },
      ],
    }),
    'QUEUE_ROW_BLOCKED'
  );
});

test('parity guard: present sendable-ish', () => {
  assert.equal(
    diagnoseIntentQueueJournalParity({
      expectedConversionName: 'OpsMantik_Junk_Exclusion',
      rowsForCall: [{ action: 'OpsMantik_Junk_Exclusion', status: 'QUEUED' }],
    }),
    'QUEUE_ROW_PRESENT'
  );
});

test('parity guard: duplicate suppressed when multiple pendings', () => {
  assert.equal(
    diagnoseIntentQueueJournalParity({
      expectedConversionName: 'OpsMantik_Contacted',
      rowsForCall: [
        { action: 'OpsMantik_Contacted', status: 'QUEUED', updated_at: '2026-01-01T00:00:00.000Z' },
        { action: 'OpsMantik_Contacted', status: 'RETRY', updated_at: '2026-01-02T00:00:00.000Z' },
      ],
    }),
    'QUEUE_ROW_DUPLICATE_SUPPRESSED'
  );
});

test('parityDiagnosticToClassificationHint maps gaps', () => {
  assert.equal(parityDiagnosticToClassificationHint('QUEUE_ROW_MISSING'), 'INTENT_NOT_JOURNALIZED');
  assert.equal(
    parityDiagnosticToClassificationHint('QUEUE_ROW_BLOCKED'),
    'INTENT_JOURNALIZED_NOT_EXPORT_ELIGIBLE'
  );
});
