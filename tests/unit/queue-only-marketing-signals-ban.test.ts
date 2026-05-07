import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const RUNTIME_FILES = [
  join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts'),
  join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts'),
  join(ROOT, 'app', 'api', 'oci', 'queue-stats', 'route.ts'),
  join(ROOT, 'app', 'api', 'oci', 'export-coverage', 'route.ts'),
  join(ROOT, 'app', 'api', 'cron', 'cleanup', 'route.ts'),
  join(ROOT, 'lib', 'oci', 'maintenance', 'run-maintenance.ts'),
  join(ROOT, 'lib', 'oci', 'preceding-signals.ts'),
  join(ROOT, 'lib', 'oci', 'outbox', 'process-outbox.ts'),
];

test('queue-only gate: runtime files must not reference marketing_signals', () => {
  for (const file of RUNTIME_FILES) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!src.includes("from('marketing_signals')"), `${file} must be queue-only`);
    assert.ok(!src.includes('recover_stuck_marketing_signals'), `${file} must not call legacy signal RPC`);
  }
});
