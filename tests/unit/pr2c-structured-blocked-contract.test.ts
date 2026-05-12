import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-2C: enqueueOciConversionRow delegates consent/disposition SSOT to intent journal enqueue', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  assert.ok(
    src.includes('enqueueIntentConversionJournalRow'),
    'micro-stage path must unify on intent journal enqueue'
  );
  const journal = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-intent-conversion-journal-row.ts'), 'utf8');
  assert.ok(
    journal.includes('CONSENT_MISSING') && journal.includes('resolveQueueJournalDisposition'),
    'journal helper must materialize consent/missing-signal dispositions into queue columns'
  );
});

test('PR-2C: enqueueSealConversion inserts structured FAILED row on missing consent', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(src.includes("rowStatus = 'FAILED'"), 'must map to FAILED');
  assert.ok(src.includes("providerErrorCategory = 'DETERMINISTIC_SKIP'"), 'must set DETERMINISTIC_SKIP category');
  assert.ok(src.includes("providerErrorCode = 'CONSENT_MISSING'"), 'must set CONSENT_MISSING code');
});

test('PR-2C: idempotency is maintained for structured blocked rows', () => {
  const ociSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  const sealSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');

  const extIdIdxOci = ociSrc.indexOf('computeOfflineConversionExternalId');
  const journalCallOci = ociSrc.indexOf('enqueueIntentConversionJournalRow');
  assert.ok(extIdIdxOci >= 0 && journalCallOci >= 0 && extIdIdxOci < journalCallOci, 'external_id before journal call');

  const journal = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-intent-conversion-journal-row.ts'), 'utf8');
  assert.ok(journal.includes("code === '23505'"), 'intent journal collapse duplicates at DB boundary');
  assert.ok(sealSrc.includes("'duplicate'"), 'seal must treat journal duplicate parity as skipped enqueue');
});

test('PR-2C: JIT export RPC excludes FAILED + DETERMINISTIC_SKIP (QUEUED|RETRY slice only)', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(fetchSrc.includes('fetch_oci_google_ads_export_jit_v1'), 'Node must call JIT RPC');
  const jit = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261229130000_fetch_oci_google_ads_export_jit_v1.sql'),
    'utf8'
  );
  assert.match(
    jit,
    /q\.status\s*=\s*ANY\s*\(\s*ARRAY\['QUEUED'::text,\s*'RETRY'::text\]\s*\)/i,
    'SQL must only return exportable queue statuses'
  );
});

test('PR-2C: queue_health explicitly excludes DETERMINISTIC_SKIP from actionable_failed_rate', () => {
  const sqlSrc = readFileSync(join(ROOT, 'scripts', 'sql', 'queue_health.sql'), 'utf8');
  assert.ok(
    sqlSrc.includes("COALESCE(ft.total_failed_count, 0) - COALESCE(ft.deterministic_skip_count, 0)"),
    'queue health must exclude DETERMINISTIC_SKIP via arithmetic subtraction from actionable rate'
  );
  assert.ok(
    sqlSrc.includes("provider_error_category = 'DETERMINISTIC_SKIP'"),
    'queue health must aggregate deterministic skip count for visibility'
  );
});

test('PR-2C: four-stage coverage logic exists in the helpers', () => {
  const ociSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  const sealSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  
  // enqueue-oci covers contacted, offered, junk
  assert.ok(ociSrc.includes('Exclude<PipelineStage, \'won\'>'), 'oci covers micro stages');
  assert.ok(ociSrc.includes('OPSMANTIK_CONVERSION_NAMES[stage]'), 'dynamic conversion name');
  
  // enqueue-seal covers won
  assert.ok(sealSrc.includes('OPSMANTIK_CONVERSION_NAMES.won'), 'seal covers won');
});
