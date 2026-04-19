/**
 * Phase 4 guard: ingest_fallback_buffer surface has been fully retired.
 *
 * This test pins the 20260419180000 drop migration and fails loudly if any
 * runtime code path or cron reintroduces the table, its RPCs, its helper, or
 * the /api/cron/recover endpoint. The single surviving references are:
 *   - supabase/migrations/** (historical migrations describing the old state)
 *   - the drop migration itself (20260419180000)
 *   - schema.sql (snapshot regenerated after every migration run)
 *   - docs/**            (narrative/architecture notes about the cutover)
 *   - this test file
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const DROP_MIGRATION = '20260419180000_drop_ingest_fallback_buffer.sql';

const ALLOWED_RUNTIME_PREFIXES = [
  'supabase/migrations/',
  'schema.sql',
  'docs/',
  'tests/architecture/phase4-ingest-fallback-drop.test.ts',
  // This test intentionally references the drop-migration filename in its
  // reset-kernel allowlist. No runtime fallback surface here.
  'tests/unit/call-event-consent-hardening.test.ts',
];

const FORBIDDEN_PATTERNS = [
  /ingest_fallback_buffer/i,
  /recover_stuck_ingest_fallback/i,
  /get_and_claim_fallback_batch/i,
  /update_fallback_on_publish_failure/i,
  /\/api\/cron\/recover/i,
  /@\/lib\/sync-fallback/i,
  /buildFallbackRow/,
];

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'dist',
  'build',
  '.turbo',
  '.vercel',
  'out',
]);

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const hits: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP_DIRS.has(entry)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      hits.push(...walk(full));
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot >= 0 ? entry.slice(dot) : '';
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    if (ALLOWED_RUNTIME_PREFIXES.some((p) => rel.startsWith(p))) continue;
    hits.push(full);
  }
  return hits;
}

test('Phase 4: drop migration 20260419180000 exists', () => {
  const path = join(MIGRATIONS_DIR, DROP_MIGRATION);
  assert.ok(existsSync(path), `${DROP_MIGRATION} must exist`);
  const src = readFileSync(path, 'utf8');

  assert.match(src, /DROP TABLE IF EXISTS public\.ingest_fallback_buffer CASCADE;/);
  assert.match(src, /DROP FUNCTION IF EXISTS public\.recover_stuck_ingest_fallback\(int\);/);
  assert.match(src, /DROP FUNCTION IF EXISTS public\.get_and_claim_fallback_batch\(int\);/);
  assert.match(src, /DROP FUNCTION IF EXISTS public\.update_fallback_on_publish_failure\(jsonb\);/);

  assert.match(
    src,
    /CREATE OR REPLACE FUNCTION public\.erase_pii_for_identifier\b/,
    'erase_pii_for_identifier must be rewritten to remove fallback references'
  );
  assert.match(
    src,
    /CREATE OR REPLACE FUNCTION public\.reset_business_data_before_cutoff_v1\b/,
    'reset_business_data_before_cutoff_v1 must be rewritten to drop the fallback line'
  );

  // Extract just the function body (between AS $$ ... $$). We verify no live
  // SQL inside the function references the dropped table. Comments and the
  // trailing COMMENT ON clause are ignored.
  const bodyMatch = src.match(/reset_business_data_before_cutoff_v1[^$]*?AS \$\$([\s\S]*?)\$\$;/);
  assert.ok(bodyMatch, 'must find reset_business_data_before_cutoff_v1 body');
  const body = bodyMatch[1];
  const codeOnly = body
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(
    /ingest_fallback_buffer/.test(codeOnly),
    false,
    'reset kernel body (non-comment SQL) must not reference ingest_fallback_buffer'
  );
});

test('Phase 4: /api/cron/recover route has been deleted', () => {
  const routePath = join(ROOT, 'app', 'api', 'cron', 'recover', 'route.ts');
  assert.equal(existsSync(routePath), false, '/api/cron/recover/route.ts must not exist');
});

test('Phase 4: lib/sync-fallback.ts has been deleted', () => {
  const helperPath = join(ROOT, 'lib', 'sync-fallback.ts');
  assert.equal(existsSync(helperPath), false, 'lib/sync-fallback.ts must not exist');
});

test('Phase 4: vercel.json no longer schedules /api/cron/recover', () => {
  const vercel = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
  assert.equal(
    /\/api\/cron\/recover(?!-|\w)/.test(vercel),
    false,
    'vercel.json must not schedule /api/cron/recover'
  );
});

test('Phase 4: runtime code has no dangling fallback buffer references', () => {
  const files = walk(ROOT);
  const violations: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(src)) {
        violations.push(`${relative(ROOT, file).replace(/\\/g, '/')}  matches  ${pattern}`);
        break;
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `Found ${violations.length} runtime file(s) still referencing the retired fallback buffer surface:\n${violations.join('\n')}`
  );
});
