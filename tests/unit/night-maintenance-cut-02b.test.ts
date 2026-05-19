/**
 * CUT-02B: night-maintenance absorbs cleanup route storage phases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('CUT-02B: night-maintenance runs archive_failed and oci_queue cleanup RPCs', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'night-maintenance', 'route.ts'), 'utf8');
  assert.ok(src.includes('archive_failed_conversions_batch'), 'must archive FAILED conversions');
  assert.ok(src.includes('cleanup_oci_queue_batch'), 'must delete terminal OCI queue rows');
  assert.ok(src.includes('p_dry_run: dryRun'), 'oci queue phase must respect dry_run');
});

test('CUT-02B: standalone cleanup route documents break-glass deprecation', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'cleanup', 'route.ts'), 'utf8');
  assert.ok(src.includes('@deprecated'), 'cleanup must be marked deprecated for schedule removal');
  assert.ok(src.includes('night-maintenance'), 'must point operators to night-maintenance');
});
