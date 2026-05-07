/**
 * Export SSOT: Google Ads script batch is driven only by offline_conversion_queue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('chaos: export route counts include signals key for script compat (always zero)', () => {
  const routeSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts'), 'utf8');
  assert.ok(routeSrc.includes('signals:'), 'export response keeps counts.signals for older script parsers');
  assert.ok(routeSrc.includes('keptSignalItems.length'), 'signals count derives from empty journal-only stream');
});

test('chaos: fetch never loads legacy marketing_signals into export batch', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(!fetchSrc.includes("from('marketing_signals')"), 'fetch must be journal-only');
});

test('chaos: preceding gate is queue-first with optional legacy consult flag', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'preceding-signals.ts'), 'utf8');
  assert.ok(src.includes('OCI_PRECEDING_CONSULT_MARKETING_SIGNALS'), 'legacy signal consult must be explicitly gated');
  assert.ok(src.includes('const journal = await hasBlockingPrecedingJournalMicroStages'), 'journal precedences must be evaluated first');
});
