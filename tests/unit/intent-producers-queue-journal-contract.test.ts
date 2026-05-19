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

test('marketing_signals upsert modules removed (queue-only runtime)', () => {
  assert.ok(!existsSync(join(process.cwd(), 'lib', 'oci', 'upsert-marketing-signal.ts')));
  assert.ok(!existsSync(join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts')));
});

test('Seal route does not ACK or export from producer', () => {
  const seal = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(!seal.includes('markAsExported') && !seal.includes('ACK'));
});
