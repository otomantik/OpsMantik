import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-3A: Export run integrity contract doc exists', () => {
  const path = join(ROOT, 'docs', 'architecture', 'OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md');
  assert.ok(existsSync(path), 'Contract document must exist');
  
  const content = readFileSync(path, 'utf8');

  // Test 2. Equations A-E are documented
  assert.match(content, /fetched_count = claimed_count/i, 'Eq A missing');
  assert.match(content, /claimed_count = script_uploadable_count \+ script_skipped_count \+ script_failed_to_classify_count/i, 'Eq B missing');
  assert.match(content, /script_upload_attempted_count = ack_success_count \+ ack_failed_count \+ provider_ambiguous_pending_count/i, 'Eq C missing');
  assert.match(content, /ack_success_count \+ ack_failed_count = db_transition_success_count \+ db_transition_failed_count/i, 'Eq D missing');
  assert.match(content, /terminalized_count = completed_count \+ failed_count \+ dead_letter_count \+ deterministic_skip_count/i, 'Eq E missing');

  // Test 3. Docs say fetched != claimed is run failure
  assert.match(content, /fetched != claimed is run failure/i, 'Must define fetched != claimed as failure');

  // Test 4 & 5. Docs say exactly-once is not assumed, and at-least-once transport + idempotent commit is used
  assert.match(content, /exactly-once is not assumed/i, 'Must deny exactly-once assumption');
  assert.match(content, /at-least-once transport \+ idempotent commit/i, 'Must affirm at-least-once model');

  // Test 6. Docs say no proof means EXPORT_RUN_INTEGRITY_UNVERIFIED, not green
  assert.match(content, /no proof means EXPORT_RUN_INTEGRITY_UNVERIFIED, not green/i, 'Must deny false green');
});

test('PR-3A: Active docs do not claim export run integrity is already fully green', () => {
  const path = join(ROOT, 'docs', 'architecture', 'OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md');
  const content = readFileSync(path, 'utf8');
  assert.ok(content.includes('NOT_SUPPORTED_YET') || content.includes('UNVERIFIED'), 'Current state must be honest');
});

test('PR-3A: export-fetch remains queue-only (JIT RPC) and QUEUED/RETRY only', () => {
  const fetchPath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts');
  const fetchSrc = readFileSync(fetchPath, 'utf8');

  assert.match(fetchSrc, /fetch_oci_google_ads_export_jit_v1/, 'Must call JIT queue journal RPC');
  assert.ok(!fetchSrc.includes(".from('marketing_signals')"), 'Must not query marketing_signals');
  assert.doesNotMatch(fetchSrc, /\.from\('offline_conversion_queue'\)/, 'Must not use PostgREST queue reads');
  const jit = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261229130000_fetch_oci_google_ads_export_jit_v1.sql'),
    'utf8'
  );
  assert.match(
    jit,
    /q\.status\s*=\s*ANY\s*\(\s*ARRAY\['QUEUED'::text,\s*'RETRY'::text\]\s*\)/i,
    'JIT SQL must restrict to exportable statuses'
  );
});

test('PR-3A: export-mark-processing contains QUEUE_CLAIM_MISMATCH anchor', () => {
  const markPath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts');
  const markSrc = readFileSync(markPath, 'utf8');
  
  assert.match(markSrc, /throw new Error\('QUEUE_CLAIM_MISMATCH'\)/, 'Must contain fail-closed mismatch error');
});
