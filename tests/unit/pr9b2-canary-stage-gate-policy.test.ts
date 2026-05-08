import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('PR-9B.2 policy: zero-item preview blocks PR-9C and item_count > 0 is required', () => {
  const runbook = readFileSync(
    join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'),
    'utf8'
  );
  assert.match(runbook, /zero-item preview .* hard blocker/i);
  assert.match(runbook, /PR-9C may proceed only after/i);
  assert.match(runbook, /item_count > 0/i);
});

test('PR-9B.2 policy: first canary cannot start with junk exclusion without explicit proof', () => {
  const runbook = readFileSync(
    join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'),
    'utf8'
  );
  assert.match(runbook, /OpsMantik_Junk_Exclusion/);
  assert.match(runbook, /not an acceptable first-canary payload unless buildable preview evidence/i);
});

test('PR-9B.2 stage-gate documentation: export path treated as seal/won-gated for first canary', () => {
  const runbook = readFileSync(
    join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'),
    'utf8'
  );
  assert.match(runbook, /effectively seal\/won-gated/i);
  assert.match(runbook, /OpsMantik_Offered/);
  assert.match(runbook, /OpsMantik_Contacted/);
});

test('PR-9B.2 code gate: export-build path applies seal sendability filter to fetched queue rows', () => {
  const buildItems = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'),
    'utf8'
  );
  assert.match(buildItems, /isCallSendableForSealExport/);
  assert.match(buildItems, /blockedNotSendableQueueIds/);
});
