import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Orchestrator stage-router micro stages enqueue queue parity (journal)', () => {
  const router = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'stages', 'stage-router.ts'),
    'utf8'
  );
  assert.ok(router.includes('ensureMarketingSignalQueueParity'));
  assert.ok(!router.includes('publishToQStash'));
});

test('Outbox processors journal contacted/offered/junk via enqueueOciConversionRow', () => {
  const outbox = readFileSync(join(process.cwd(), 'lib', 'oci', 'outbox', 'process-outbox.ts'), 'utf8');
  assert.ok(outbox.includes('enqueueOciConversionRow'));
});

test('marketing_signals upsert paths best-effort queue parity (audit-only residue)', () => {
  const ociUpsert = readFileSync(join(process.cwd(), 'lib', 'oci', 'upsert-marketing-signal.ts'), 'utf8');
  assert.ok(ociUpsert.includes('ensureMarketingSignalQueueParity'));
  const domainUpsert = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts'),
    'utf8'
  );
  assert.ok(domainUpsert.includes('ensureMarketingSignalQueueParity'));
});

test('Seal route does not ACK or export from producer', () => {
  const seal = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(!seal.includes('markAsExported') && !seal.includes('ACK'));
});
