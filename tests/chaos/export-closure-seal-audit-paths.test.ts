/**
 * Strict: won seal path must not fail “silently” — rejections and blocks log for audit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('chaos: seal enqueue logs rejections (no silent return on bad preconditions)', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(src.includes('logWarn') && src.includes('enqueue_seal_rejected'), 'seal must warn on reject');
  assert.ok(
    src.includes('enqueue_seal_blocked') || src.includes('BLOCKED_PRECEDING'),
    'seal must record blocked / missing attribution for audit'
  );
});

test('chaos: seal enqueue treats insert duplicate as explicit skip (23505)', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(src.includes('23505') && src.includes('duplicate'), 'seal must name duplicate idempotency path');
});
