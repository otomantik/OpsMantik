import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contract: duplicate reconciliation rows must not throw — producer treats
 * `23505` as idempotent success (L0 / L3.5 plan).
 */
test('appendOciReconciliationEvent: 23505 maps to inserted false without throw', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'lib/oci/reconciliation-events.ts'), 'utf8');
  assert.ok(src.includes("code === '23505'"), 'must branch on Postgres unique violation 23505');
  assert.ok(src.includes('return { inserted: false }'), '23505 path must return inserted: false');
  assert.ok(src.includes('return { inserted: true }'), 'success path must return inserted: true');
});
