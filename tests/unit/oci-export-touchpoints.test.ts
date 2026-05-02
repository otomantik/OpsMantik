import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('export-fetch only selects QUEUED and RETRY queue rows', () => {
  const src = readFileSync(
    join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'),
    'utf8'
  );
  assert.ok(
    src.includes(".in('status', ['QUEUED', 'RETRY'])"),
    'BLOCKED_PRECEEDING_SIGNALS must not appear in export selection'
  );
});

test('queue claim RPC filters QUEUED|RETRY at DB (blocked rows never claimed)', () => {
  const migrationPath = join(ROOT, 'schema_utf8.sql');
  const src = readFileSync(migrationPath, 'utf8');
  const idx = src.indexOf('CREATE OR REPLACE FUNCTION "public"."append_script_claim_transition_batch"');
  assert.ok(idx >= 0, 'append_script_claim_transition_batch must exist');
  const slice = src.slice(idx, idx + 3500);
  assert.ok(
    slice.includes("q.status IN ('QUEUED', 'RETRY')"),
    'script claim batch must only transition QUEUED/RETRY — never BLOCKED_PRECEEDING_SIGNALS'
  );
});

test('export mark-processing uses script claim RPC (same kernel as export-fetch)', () => {
  const src = readFileSync(
    join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  assert.ok(src.includes('append_script_claim_transition_batch'), 'mark-processing must use script claim RPC');
});
