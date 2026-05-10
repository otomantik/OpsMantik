import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('google-ads-export: preview diagnostics include pipeline and skip breakdown (no raw click ids)', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const routeSrc = readFileSync(routePath, 'utf8');

  assert.match(routeSrc, /buildPreviewDiagnosticsExtension/, 'route wires extended preview helper');
  assert.match(routeSrc, /preview_diagnostics:\s*\{/, 'preview_diagnostics object');
  assert.match(routeSrc, /fetched_count:/, 'fetched_count');
  assert.match(routeSrc, /built_count:/, 'built_count');
  assert.match(routeSrc, /returned_count:/, 'returned_count');
  assert.match(routeSrc, /skipped_count:/, 'skipped_count');
  assert.match(routeSrc, /skip_reason_counts:/, 'skip_reason_counts');
  assert.match(routeSrc, /pipeline_stats:/, 'pipeline_stats');
  assert.match(routeSrc, /skip_by_action:/, 'skip_by_action');
  assert.match(routeSrc, /skip_by_status:/, 'skip_by_status');
  assert.match(routeSrc, /skip_by_click_id_availability:/, 'skip_by_click_id_availability');
  assert.match(routeSrc, /returned_action_counts:/, 'returned_action_counts');
  assert.match(routeSrc, /skip_by_provider_path:/, 'skip_by_provider_path');
  assert.match(routeSrc, /signal_availability_counts:/, 'signal_availability_counts');
  assert.match(routeSrc, /script_v1_supported_counts:/, 'script_v1_supported_counts');
  assert.match(routeSrc, /page_limit:\s*auth\.pageLimit/, 'page limit surfaced');

  const fetchSrc = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'),
    'utf8'
  );
  assert.match(fetchSrc, /\bstatus\b/, 'fetch selects status for skip_by_status diagnostics');

  const diagSrc = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-preview-diagnostics.ts'),
    'utf8'
  );
  assert.match(diagSrc, /skip_by_click_id_availability/, 'helper builds click availability buckets');
  assert.doesNotMatch(
    diagSrc,
    /console\.(log|info)\([^)]*gclid/i,
    'diagnostics helper must not log raw click ids'
  );
});
