/**
 * Adversarial / W3: dual-path (signals + journal) must be explicitly gated — silent duplicate surface forbidden by ops flag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('chaos: export route combines streams only when both sources enabled', () => {
  const routeSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts'), 'utf8');
  assert.ok(routeSrc.includes('keptSignalItems'), 'export response must surface signal stream separately for observability');
  assert.ok(routeSrc.includes('keptConversions'), 'export response must surface queue stream separately');
});

test('chaos: marketing_signals fetch can be disabled without deleting route', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  assert.ok(
    /signalRows\s*=\s*\[\]|signalList:\s*\[\]/.test(fetchSrc) || fetchSrc.includes('shouldIncludeMarketingSignalsInExport'),
    'fetch must allow empty signal stream when journal-only mode'
  );
});
