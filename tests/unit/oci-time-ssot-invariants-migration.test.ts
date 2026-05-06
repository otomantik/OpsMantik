import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('OCI time SSOT invariant migration locks conversion timestamps to occurred_at', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20260506262000_lock_oci_time_ssot_invariants.sql'),
    'utf8'
  );

  assert.match(sql, /marketing_signals_time_ssot_check/i);
  assert.match(sql, /google_conversion_time\s*=\s*occurred_at/i);
  assert.match(sql, /offline_conversion_queue_time_ssot_check/i);
  assert.match(sql, /conversion_time\s*=\s*occurred_at/i);
  assert.match(sql, /source_timestamp\s*=\s*occurred_at/i);
});

