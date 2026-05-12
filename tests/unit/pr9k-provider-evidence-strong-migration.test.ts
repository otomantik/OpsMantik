import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261229120500_pr9k_provider_evidence_strong_followup_v1.sql'
);

test('PR-E: PR-9K follow-up defines strong provider evidence helper + selector parity', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.pr9k_provider_evidence_strong_v1'));
  assert.ok(
    src.includes('public.pr9k_provider_evidence_strong_v1(coalesce(q.provider_request_id'),
    'candidates base must call strong helper on provider_request_id'
  );
  assert.ok(
    src.includes("WHEN sw.provider_evidence_strong THEN 'provider_confirmation_evidence_strong'"),
    'ineligible reason must use provider_confirmation_evidence_strong label'
  );
  assert.ok(
    src.includes('GRANT EXECUTE ON FUNCTION public.pr9k_provider_evidence_strong_v1(text) TO service_role'),
    'strong helper must be service_role only'
  );
});
