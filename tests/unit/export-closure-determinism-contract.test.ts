/**
 * R3 / D1: static contracts for export journal determinism and S1 flags (no DB).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('computeOfflineConversionExternalId produces oci_ + 32 hex (D1)', () => {
  const extSrc = readFileSync(join(ROOT, 'lib', 'oci', 'external-id.ts'), 'utf8');
  assert.ok(
    extSrc.includes("oci_${crypto.createHash('sha256')") && extSrc.includes('.slice(0, 32)'),
    'external-id must prefix oci_ from sha256 truncated to 32 hex'
  );
});

test('enqueue journal rows stamp deterministic economics path', () => {
  const micro = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  assert.ok(micro.includes('computeOfflineConversionExternalId'), 'micro enqueue must use deterministic external_id');
  assert.ok(micro.includes('loadMarketingSignalEconomics'), 'micro enqueue must use value SSOT');
  const seal = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(seal.includes('computeOfflineConversionExternalId'), 'seal enqueue must use deterministic external_id');
});

test('export-fetch is journal-only (no marketing_signals upload surface)', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(!fetchSrc.includes("from('marketing_signals')"), 'export must not query marketing_signals');
  assert.ok(fetchSrc.includes('offline_conversion_queue'), 'export reads only journal');
});

test('export-build-queue derives conversionName from row.action (four OpsMantik names)', () => {
  const qSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts'), 'utf8');
  assert.ok(qSrc.includes('gearFromQueueExportRow'), 'queue export must map gear from journal row');
  assert.ok(qSrc.includes('OPSMANTIK_CONVERSION_NAMES'), 'queue export must use canonical names');
});

test('D4: micro enqueue treats duplicate journal insert as idempotent (23505)', () => {
  const micro = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  const journal = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-intent-conversion-journal-row.ts'), 'utf8');
  assert.ok(
    micro.includes('enqueueIntentConversionJournalRow') && journal.includes('23505'),
    'micro path must delegate; journal must collapse unique violation as idempotent replay'
  );
});

test('D7: retry jitter module does not touch external_id identity path', () => {
  const jitterSrc = readFileSync(join(ROOT, 'lib', 'cron', 'process-offline-conversions.ts'), 'utf8');
  assert.ok(!jitterSrc.includes('computeOfflineConversionExternalId'), 'jitter/backoff must not import identity hash');
});

test('D11: evidence contracts export a pinned version token', () => {
  const ec = readFileSync(join(ROOT, 'scripts', 'release', 'evidence-contracts.mjs'), 'utf8');
  assert.ok(ec.includes('EVIDENCE_CONTRACT_VERSION'), 'evidence-contracts must pin contract version');
});

test('D5: export batch uses stable ordering (updated_at, id)', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(
    fetchSrc.includes(".order('updated_at'") && fetchSrc.includes(".order('id'"),
    'journal stream must have deterministic sort + tie-break'
  );
});
