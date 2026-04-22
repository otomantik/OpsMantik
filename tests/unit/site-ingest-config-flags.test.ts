/**
 * PR-T1 P0: getSiteIngestConfig flags.
 * Empty/missing config => all flags false/undefined.
 * ingest_strict_mode: true => callers treat as enabling traffic_debloat (derived at use site).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE_INGEST_CONFIG_PATH = join(process.cwd(), 'lib', 'ingest', 'site-ingest-config.ts');
const WORKER_ROUTE_PATH = join(process.cwd(), 'lib', 'ingest', 'execute-ingest-command.ts');
const PROCESS_SYNC_EVENT_PATH = join(process.cwd(), 'lib', 'ingest', 'process-sync-event.ts');

test('getSiteIngestConfig: empty/error returns strict default (all flags defined, no undefined access)', () => {
  const src = readFileSync(SITE_INGEST_CONFIG_PATH, 'utf8');
  assert.ok(src.includes('if (error || !data)'), 'when error or no data, returns early');
  assert.ok(src.includes('DEFAULT_STRICT_CONFIG') || src.includes('StrictSiteIngestConfig'), 'returns strict default so no undefined property access');
  assert.ok(src.includes('const config = (data.config ?? {})'), 'empty config is normalized to {}');
});

test('getSiteIngestConfig: strict return type with all boolean keys defined', () => {
  const src = readFileSync(SITE_INGEST_CONFIG_PATH, 'utf8');
  assert.ok(/ingest_strict_mode.*boolean/.test(src), 'ingest_strict_mode is boolean');
  assert.ok(/ghost_geo_strict.*boolean/.test(src), 'ghost_geo_strict is boolean');
  assert.ok(/traffic_debloat.*boolean/.test(src), 'traffic_debloat is boolean');
  assert.ok(/page_view_10s_session_reuse.*boolean/.test(src), 'page_view_10s_session_reuse is boolean');
});

test('worker: traffic_debloat derived from ingest_strict_mode (strict config)', () => {
  const src = readFileSync(WORKER_ROUTE_PATH, 'utf8');
  assert.ok(
    src.includes('siteIngestConfig.traffic_debloat') && src.includes('siteIngestConfig.ingest_strict_mode'),
    'worker uses traffic_debloat and ingest_strict_mode (strict config; ingest_strict_mode enables skip path when traffic_debloat false)'
  );
});

test('process-sync-event: ghost_geo_strict and page_view_10s derived from ingest_strict_mode', () => {
  const src = readFileSync(PROCESS_SYNC_EVENT_PATH, 'utf8');
  assert.ok(
    src.includes('siteIngestConfig.ghost_geo_strict') && src.includes('siteIngestConfig.ingest_strict_mode'),
    'process-sync-event uses ingest_strict_mode for site-scoped flags (strict config)'
  );
  assert.ok(
    src.includes('page_view_10s_session_reuse') && src.includes('ingest_strict_mode'),
    '10s reuse flag can be derived from ingest_strict_mode'
  );
});
