import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('package.json exposes marketing signal parity repair npm script', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    pkg.scripts['oci:repair-marketing-signal-parity'],
    'npx tsx scripts/db/oci-repair-marketing-signal-queue-parity.ts'
  );
});

test('MARKETING_SIGNALS_AUDIT_LANE runbook states audit-only and queue authority', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'runbooks', 'MARKETING_SIGNALS_AUDIT_LANE.md'), 'utf8');
  assert.ok(doc.includes('audit-only'));
  assert.ok(doc.includes('offline_conversion_queue'));
  assert.ok(doc.includes('oci:repair-marketing-signal-parity'));
  assert.ok(doc.includes('marketing_signals_queue_parity_gap_count'));
  assert.ok(doc.includes('EXPORT_CLOSURE'));
});

test('parity repair script uses ensureOciQueueEnqueue', () => {
  const src = readFileSync(
    join(ROOT, 'scripts', 'db', 'oci-repair-marketing-signal-queue-parity.ts'),
    'utf8'
  );
  assert.ok(src.includes('ensureOciQueueEnqueue'));
  assert.ok(src.includes('--dry-run'));
  assert.ok(src.includes(".from('marketing_signals')"));
});
