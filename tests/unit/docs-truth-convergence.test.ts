import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const CANONICAL_NAMES = [
  'OpsMantik_Contacted',
  'OpsMantik_Offered',
  'OpsMantik_Won',
  'OpsMantik_Junk_Exclusion',
] as const;

test('Workstream-C: active SSOT doc uses canonical conversion names', () => {
  const src = readFileSync(join(ROOT, 'docs/architecture/OCI_VALUE_ENGINES_SSOT.md'), 'utf8');
  assert.ok(src.includes('status: active'));
  for (const name of CANONICAL_NAMES) {
    assert.ok(src.includes(name), `OCI_VALUE_ENGINES_SSOT must include ${name}`);
  }
});

test('Workstream-C: operations snapshot states current export write authority explicitly', () => {
  const src = readFileSync(join(ROOT, 'docs/operations/OCI_OPERATIONS_SNAPSHOT.md'), 'utf8');
  assert.ok(src.includes('status: historical'));
  assert.ok(src.includes('This document is historical and must not be used as an active runbook.'));
  assert.ok(src.includes('Current Google write authority is `offline_conversion_queue` + `marketing_signals`'));
  assert.ok(src.includes('not the current Google write authority'));
});

test('Workstream-C: legacy flow diagram is hard-marked historical only', () => {
  const src = readFileSync(join(ROOT, 'docs/runbooks/OCI_CONVERSION_INTENT_FLOW_DIAGRAM.md'), 'utf8');
  assert.ok(src.includes('status: historical'));
  assert.ok(src.includes('HISTORICAL ONLY'));
  assert.ok(src.includes('This document is historical and must not be used as an active runbook.'));
  assert.ok(src.includes('OCI_HARDENING_OPERATIONS.md'));
});

test('Workstream-C: active docs avoid legacy Turkish conversion names', () => {
  const activeDocs = [
    'docs/architecture/OCI_VALUE_ENGINES_SSOT.md',
    'docs/architecture/EXPORT_CONTRACT.md',
    'docs/runbooks/OCI_HARDENING_OPERATIONS.md',
  ];
  const forbidden = ['OpsMantik_V2_Ilk_Temas', 'OpsMantik_V3_Nitelikli_Gorusme', 'OpsMantik_V4_Sicak_Teklif'];
  for (const rel of activeDocs) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(src.includes('status: active'), `${rel} must declare active status`);
    for (const bad of forbidden) {
      assert.ok(!src.includes(bad), `${rel} must not include legacy conversion ${bad}`);
    }
  }
});

