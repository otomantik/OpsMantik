/**
 * PR-OCI-9F: Dedup determinism — enqueue handles duplicate_session and 23505.
 * Source-inspection tests (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENQUEUE_PATH = join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts');

test('PR-OCI-9F: enqueue checks duplicate_session before insert', () => {
  const src = readFileSync(ENQUEUE_PATH, 'utf-8');
  assert.ok(src.includes('duplicate_session'), 'Expected duplicate_session pre-check');
  assert.ok(
    src.includes("'QUEUED', 'RETRY', 'PROCESSING'") || src.includes('QUEUED", "RETRY", "PROCESSING"'),
    'Expected status filter for pending rows'
  );
});

test('PR-OCI-9F: enqueue handles 23505 as duplicate', () => {
  const src = readFileSync(ENQUEUE_PATH, 'utf-8');
  assert.ok(src.includes('23505'), 'Expected 23505 (unique violation) handling');
  assert.ok(
    src.includes("reason: 'duplicate'") || src.includes('reason: "duplicate"'),
    'Expected duplicate reason on 23505'
  );
});
