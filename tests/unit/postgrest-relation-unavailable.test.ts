import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPostgrestRelationUnavailableError,
  PG_UNDEFINED_TABLE,
} from '@/lib/supabase/postgrest-relation-unavailable';

test('PG_UNDEFINED_TABLE constant', () => {
  assert.equal(PG_UNDEFINED_TABLE, '42P01');
});

test('isPostgrestRelationUnavailableError: schema cache message + relation hint', () => {
  assert.ok(
    isPostgrestRelationUnavailableError(
      { message: `Could not find the table 'public.foo_bar' in the schema cache` },
      'foo_bar'
    )
  );
  assert.ok(!isPostgrestRelationUnavailableError({ message: 'random' }, 'foo_bar'));
});

test('isPostgrestRelationUnavailableError: 42P01 requires relation hint match when hint set', () => {
  assert.ok(
    isPostgrestRelationUnavailableError(
      { code: PG_UNDEFINED_TABLE, message: 'relation "truth_canonical_ledger" does not exist' },
      'truth_canonical_ledger'
    )
  );
  assert.ok(
    !isPostgrestRelationUnavailableError({ code: PG_UNDEFINED_TABLE, message: 'relation "other" does not exist' }, 'truth_canonical_ledger')
  );
});
