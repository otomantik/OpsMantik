/**
 * L15 — Single HTTP request: at most two outbox insert attempts; second only on transient PG codes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCER = join(process.cwd(), 'lib/oci/enqueue-panel-stage-outbox.ts');

test('L15: outbox insert loop is bounded to two attempts', () => {
  const src = readFileSync(PRODUCER, 'utf8');
  assert.ok(
    src.includes('for (let attempt = 0; attempt < 2; attempt++)'),
    'producer must use at most 2 insert attempts per request'
  );
});

test('L15: transient retry codes match documented Postgres classes', () => {
  const src = readFileSync(PRODUCER, 'utf8');
  const fnStart = src.indexOf('function isTransientOutboxInsertError');
  assert.ok(fnStart !== -1, 'isTransientOutboxInsertError must exist');
  const slice = src.slice(fnStart, fnStart + 400);
  for (const code of ['40001', '40P01', '57014', '55P03', '08006'] as const) {
    assert.ok(slice.includes(`'${code}'`), `transient list must include ${code}`);
  }
});
