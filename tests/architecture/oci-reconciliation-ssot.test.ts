import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

test('reconciliation reason SSOT file exists', () => {
  const full = join(ROOT, 'lib/oci/reconciliation-reasons.ts');
  assert.ok(existsSync(full), 'lib/oci/reconciliation-reasons.ts must exist');
  const src = readFileSync(full, 'utf8');
  assert.ok(src.includes('OCI_RECONCILIATION_REASONS'), 'SSOT constant must be exported');
});

test('enqueue-panel-stage-outbox uses reconciliation reason SSOT and evidence hash pipeline', () => {
  const full = join(ROOT, 'lib/oci/enqueue-panel-stage-outbox.ts');
  const src = readFileSync(full, 'utf8');
  assert.ok(src.includes("from '@/lib/oci/reconciliation-reasons'"), 'enqueue must import reason SSOT');
  assert.ok(src.includes('appendOciReconciliationEvent'), 'enqueue must append reconciliation events');
});

test('reconciliation event writer uses dedicated evidence hash helper', () => {
  const full = join(ROOT, 'lib/oci/reconciliation-events.ts');
  const src = readFileSync(full, 'utf8');
  assert.ok(src.includes("from '@/lib/oci/evidence-hash'"), 'reconciliation writer must import evidence hash helper');
  assert.ok(src.includes('buildOciEvidenceHash'), 'reconciliation writer must use buildOciEvidenceHash');
});

function extractReasonPairs(source: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const rx = /([A-Z_]+)\s*:\s*'([A-Z_]+)'/g;
  let m: RegExpExecArray | null = null;
  while ((m = rx.exec(source)) !== null) {
    out.push({ key: m[1], value: m[2] });
  }
  return out;
}

test('TS reason SSOT and script mirror stay in sync', () => {
  const tsSrc = readFileSync(join(ROOT, 'lib/oci/reconciliation-reasons.ts'), 'utf8');
  const mjsSrc = readFileSync(join(ROOT, 'scripts/db/oci-reconciliation-reasons.mjs'), 'utf8');
  const tsPairs = extractReasonPairs(tsSrc).sort((a, b) => a.key.localeCompare(b.key));
  const mjsPairs = extractReasonPairs(mjsSrc).sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(mjsPairs, tsPairs, 'scripts mirror reasons must match TS SSOT exactly');
});
