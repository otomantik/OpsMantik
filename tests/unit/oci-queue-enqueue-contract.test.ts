import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('ensureOciQueueEnqueue exposes canonical PARITY_* reason codes', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'ensure-oci-queue-enqueue.ts'), 'utf8');
  assert.ok(src.includes('PARITY_QUEUE_ENQUEUED'));
  assert.ok(src.includes('PARITY_QUEUE_DUPLICATE'));
  assert.ok(!src.includes("from('marketing_signals')"));
});

test('stage router enqueues journal only', () => {
  const src = readFileSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'stages', 'stage-router.ts'), 'utf8');
  assert.ok(src.includes('ensureOciQueueEnqueue'));
  assert.ok(!src.includes('marketing_signals'));
});
