import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('ack receipt migration defines REGISTERED/APPLIED state machine', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20261222010000_ack_receipt_state_machine.sql'),
    'utf8'
  );
  assert.ok(migration.includes('apply_state'), 'migration must add apply_state');
  assert.ok(migration.includes("'REGISTERED'") && migration.includes("'APPLIED'"), 'state machine must define REGISTERED/APPLIED');
  assert.ok(migration.includes('in_progress boolean'), 'register function must return in_progress replay signal');
  assert.ok(migration.includes("existing_state = 'REGISTERED'"), 'replay should expose registered in-progress state');
  assert.ok(migration.includes("apply_state = 'APPLIED'"), 'complete function must atomically set APPLIED');
});

test('ack routes fail closed on replay-in-progress', () => {
  const ackRoute = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  const ackFailedRoute = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  assert.ok(ackRoute.includes('ACK_REPLAY_IN_PROGRESS'), 'ack route must fail closed when replay races before snapshot');
  assert.ok(ackFailedRoute.includes('ACK_FAILED_REPLAY_IN_PROGRESS'), 'ack-failed route must fail closed when replay races before snapshot');
});
