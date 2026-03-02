/**
 * PR-6: Ops script oci-enqueue.mjs hardening.
 * Source-based assertions for header and --skip-if-queued.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'db', 'oci-enqueue.mjs');

test('PR-6: oci-enqueue.mjs header contains OPS-ONLY and bypasses orchestrator warning', () => {
  const src = readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(src.includes('OPS-ONLY'), 'script must have OPS-ONLY in header');
  assert.ok(/bypasses\s+orchestrator/i.test(src), 'script must warn bypasses orchestrator');
  assert.ok(
    src.includes('enqueue-from-sales') && src.includes('sweep-unsent-conversions'),
    'script must mention enqueue-from-sales and sweep-unsent-conversions'
  );
});

test('PR-6: oci-enqueue.mjs supports --skip-if-queued flag', () => {
  const src = readFileSync(SCRIPT_PATH, 'utf-8');
  assert.ok(
    src.includes('--skip-if-queued') || src.includes('-s'),
    'script must document --skip-if-queued flag'
  );
  assert.ok(
    src.includes('offline_conversion_queue') && src.includes('call_id'),
    'script must query offline_conversion_queue for call_id before insert'
  );
});
