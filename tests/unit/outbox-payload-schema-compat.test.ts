import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('process-outbox uses optional payload fields (older rows without new keys stay safe)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'outbox', 'process-outbox.ts'), 'utf8');
  assert.ok(src.includes('payload?.stage'), 'explicit stage read must be null-safe');
  assert.ok(src.includes('payload?.call_id'), 'call_id read must be null-safe');
});
