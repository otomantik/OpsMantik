import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('export-fetch delegates QUEUED/RETRY filter to fetch_oci_google_ads_export_jit_v1 (SQL SSOT)', () => {
  const fetchSrc = readFileSync(
    join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'),
    'utf8'
  );
  assert.ok(fetchSrc.includes('fetch_oci_google_ads_export_jit_v1'), 'must call JIT export RPC');
  const jit = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261229130000_fetch_oci_google_ads_export_jit_v1.sql'),
    'utf8'
  );
  assert.match(
    jit,
    /q\.status\s*=\s*ANY\s*\(\s*ARRAY\['QUEUED'::text,\s*'RETRY'::text\]\s*\)/i,
    'JIT RPC must restrict export slice to QUEUED|RETRY'
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
