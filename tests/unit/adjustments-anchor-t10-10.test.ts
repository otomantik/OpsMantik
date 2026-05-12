/**
 * T10-10 — `/api/oci/adjustments` must require an original terminal-success
 * queue row, or an explicit operator override header.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PATH = join(process.cwd(), 'app/api/oci/adjustments/route.ts');

test('T10-10: orphan adjustments fail-closed (no original row)', () => {
  const src = readFileSync(PATH, 'utf8');
  assert.ok(src.includes('ADJUSTMENT_NO_ANCHOR'), 'must expose ADJUSTMENT_NO_ANCHOR error code');
  assert.ok(
    src.includes("x-opsmantik-adjustment-override"),
    'must accept explicit override header for documented bypass'
  );
  assert.ok(
    src.includes('OCI_ADJUSTMENTS_NO_ANCHOR'),
    'must emit structured log on rejection'
  );
});

test('T10-10: override decisions tagged in reason for audit', () => {
  const src = readFileSync(PATH, 'utf8');
  assert.ok(
    src.includes('[OVERRIDE_NO_ANCHOR]'),
    'override path must annotate reason with OVERRIDE_NO_ANCHOR tag'
  );
});
