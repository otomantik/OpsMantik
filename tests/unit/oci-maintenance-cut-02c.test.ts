/**
 * CUT-02C: ack-receipt TTL sweep folded into oci-maintenance orchestrator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('CUT-02C: runOciMaintenance sweeps stale ack receipts', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');
  assert.ok(src.includes('sweep_stale_ack_receipts_v1'), 'must call ack receipt TTL RPC');
  assert.ok(src.includes('ack_receipts_stale_swept'), 'stats must expose sweep count');
  assert.ok(src.includes('step_ackReceiptStaleSweep'), 'dedicated maintenance step required');
});

test('CUT-02C: ack-receipt-ttl route documents break-glass deprecation', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'oci', 'ack-receipt-ttl', 'route.ts'), 'utf8');
  assert.ok(src.includes('@deprecated'), 'ack-receipt-ttl must be marked deprecated');
  assert.ok(src.includes('oci-maintenance'), 'must point operators to oci-maintenance');
});
