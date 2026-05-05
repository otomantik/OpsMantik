import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('OCI conversion time DB guard migration enforces call-created-at source', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/20261226010000_oci_conversion_time_zero_tolerance_db_guard.sql'
  );
  const sql = readFileSync(migrationPath, 'utf8');

  assert.match(sql, /create or replace function public\.enforce_oci_queue_conversion_time_from_call_created_at\(\)/i);
  assert.match(sql, /new\.occurred_at\s*:=\s*v_call_created_at;/i);
  assert.match(sql, /new\.conversion_time\s*:=\s*v_call_created_at;/i);
  assert.match(sql, /new\.source_timestamp\s*:=\s*v_call_created_at;/i);
  assert.match(sql, /new\.occurred_at_source\s*:=\s*'intent';/i);
  assert.match(sql, /new\.time_confidence\s*:=\s*'observed';/i);

  assert.match(sql, /create trigger trg_enforce_oci_queue_conversion_time_from_call_created_at/i);
  assert.match(sql, /on public\.offline_conversion_queue/i);
  assert.match(sql, /before insert or update/i);

  assert.match(sql, /create or replace function public\.enforce_marketing_signal_time_from_call_created_at\(\)/i);
  assert.match(sql, /new\.google_conversion_time\s*:=\s*v_call_created_at;/i);
  assert.match(sql, /create trigger trg_enforce_marketing_signal_time_from_call_created_at/i);
  assert.match(sql, /on public\.marketing_signals/i);
});

