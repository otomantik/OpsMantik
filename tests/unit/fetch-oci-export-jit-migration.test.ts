import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261229130000_fetch_oci_google_ads_export_jit_v1.sql'
);

test('PR-9H.8: JIT export RPC is atomic queue+calls+sessions with marketing consent CASE', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.fetch_oci_google_ads_export_jit_v1'));
  assert.ok(src.includes('FROM public.offline_conversion_queue AS q'));
  assert.ok(src.includes('LEFT JOIN public.calls AS c'));
  assert.ok(src.includes('LEFT JOIN public.sessions AS s'));
  assert.ok(src.includes("'marketing' = ANY (s.consent_scopes)"));
  assert.ok(src.includes('oci_export_apply_consent_gate_to_identifiers'));
  assert.ok(
    src.includes('GRANT EXECUTE ON FUNCTION public.fetch_oci_google_ads_export_jit_v1'),
    'JIT export RPC must be service_role only'
  );
});
