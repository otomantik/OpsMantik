import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('queue occurred_at_source constraint allows intent', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261226013000_oci_queue_occurred_at_source_allow_intent.sql'),
    'utf8'
  );
  assert.match(sql, /offline_conversion_queue_occurred_at_source_check/i);
  assert.match(sql, /'intent'/i, 'queue occurred_at_source check must include intent');
});

