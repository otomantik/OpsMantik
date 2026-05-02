import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendCanonicalTruthLedger,
  classifyCanonicalLedgerInsertError,
  isMissingLedgerTableError,
} from '@/lib/domain/truth/canonical-truth-ledger-writer';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

test('appendCanonicalTruthLedger: disabled flag does not increment canonical metrics', async () => {
  const prev = process.env.TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED;
  try {
    delete process.env.TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED;
    resetRefactorMetricsMemoryForTests();
    const r = await appendCanonicalTruthLedger({
      siteId: '00000000-0000-0000-0000-000000000001',
      streamKind: 'INGEST_SYNC',
      idempotencyKey: 'unit-test-key',
      occurredAt: new Date(),
      payload: { v: 1 },
    });
    assert.equal(r.appended, false);
    assert.equal(getRefactorMetricsMemory().truth_canonical_ledger_attempt_total, 0);
    assert.equal(getRefactorMetricsMemory().truth_canonical_ledger_success_total, 0);
    assert.equal(getRefactorMetricsMemory().truth_canonical_ledger_failure_total, 0);
  } finally {
    if (prev === undefined) delete process.env.TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED;
    else process.env.TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED = prev;
  }
});

test('classifyCanonicalLedgerInsertError: 23505 is duplicate (success path for metrics, not failure)', () => {
  assert.equal(classifyCanonicalLedgerInsertError({ code: '23505' }), 'duplicate');
});

test('classifyCanonicalLedgerInsertError: other codes are not duplicate', () => {
  assert.equal(classifyCanonicalLedgerInsertError({ code: '42703' }), 'other');
  assert.equal(classifyCanonicalLedgerInsertError({ code: undefined }), 'other');
});

test('isMissingLedgerTableError: PostgREST schema cache + table name', () => {
  assert.ok(
    isMissingLedgerTableError({
      message: `Could not find the table 'public.truth_canonical_ledger' in the schema cache`,
    })
  );
});

test('isMissingLedgerTableError: Postgres undefined_table', () => {
  assert.ok(isMissingLedgerTableError({ code: '42P01', message: 'relation "truth_canonical_ledger" does not exist' }));
});
