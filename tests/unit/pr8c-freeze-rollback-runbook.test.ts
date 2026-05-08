import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-8C runbook documents export freeze and rollback drill', () => {
  const src = readFileSync(join(ROOT, 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'), 'utf8');
  for (const token of [
    'Production Export Freeze',
    'rollback scenario',
    'ACK replay',
    'idempotent',
    'SAFE_TO_RETRY',
    'recover_safe_processing_queue_rows_v1',
  ]) {
    assert.ok(src.toLowerCase().includes(token.toLowerCase()), `runbook must include ${token}`);
  }
});

test('PR-8C runbook pins forbidden queue mutation actions', () => {
  const src = readFileSync(join(ROOT, 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'), 'utf8').toLowerCase();
  for (const token of [
    'no queue row delete',
    'no manual completed',
    'no direct status sql update',
    'no force unlock without stale-lock evidence',
  ]) {
    assert.ok(src.includes(token), `runbook must include forbidden action: ${token}`);
  }
});
