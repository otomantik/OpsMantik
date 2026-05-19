import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE, RETIRED_CLEANUP_RPC } from '../helpers/retired-oci-vocabulary';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Orchestrator stage-router micro stages enqueue queue parity (journal)', () => {
  const router = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'stages', 'stage-router.ts'),
    'utf8'
  );
  assert.ok(router.includes('ensureOciQueueEnqueue'));
  assert.ok(!router.includes('publishToQStash'));
});

test('Outbox processors journal contacted/offered/junk via enqueueOciConversionRow', () => {
  const outbox = readFileSync(join(process.cwd(), 'lib', 'oci', 'outbox', 'process-outbox.ts'), 'utf8');
  assert.ok(outbox.includes('enqueueOciConversionRow'));
});

test('ensureOciQueueEnqueue is the journal parity entrypoint', () => {
  assert.ok(existsSync(join(process.cwd(), 'lib', 'oci', 'ensure-oci-queue-enqueue.ts')));
});

test('Seal route does not ACK or export from producer', () => {
  const seal = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(!seal.includes('markAsExported') && !seal.includes('ACK'));
});
