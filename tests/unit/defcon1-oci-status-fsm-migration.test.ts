import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('DEFCON-1 FSM migration: explicit matrix + PR-9K gate + DEFCON_1 exception', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20261231000000_defcon1_absolute_fsm_dictatorship.sql'),
    'utf8'
  );
  assert.match(sql, /enforce_oci_status_fsm/);
  assert.match(sql, /opsmantik\.pr9k_operator_requeue/);
  assert.match(sql, /DEFCON_1_ILLEGAL_STATE_TRANSITION/);
  assert.match(sql, /OLD\.status = 'QUEUED'.*'PROCESSING'/s);
  assert.match(sql, /OLD\.status = 'FAILED'/);
  assert.match(sql, /'BLOCKED_PRECEDING_SIGNALS'/);
});
