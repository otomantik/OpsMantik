/**
 * Repo-wide ban on retired OCI audit table vocabulary outside supabase/migrations history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  RETIRED_AUDIT_TABLE,
  RETIRED_CLEANUP_RPC,
  RETIRED_DROP_MIGRATION,
  RETIRED_FORBIDDEN_RE,
} from '../helpers/retired-oci-vocabulary';

const ROOT = process.cwd();
const SCAN_ROOTS = ['lib', 'app', 'components', 'scripts', 'docs', 'tests'] as const;
const SCAN_SKIP = [
  'node_modules',
  '.next',
  'supabase/migrations',
  'tests/helpers/retired-oci-vocabulary.ts',
  'tests/unit/oci-retired-vocabulary-ban.test.ts',
  'tests/architecture/phase4-bitemporal-drop.test.ts',
  'tests/architecture/oci-omniscience.test.ts',
  'tests/unit/oci-conversion-time-db-guard-migration.test.ts',
  'tests/unit/oci-time-ssot-invariants-migration.test.ts',
  'tests/unit/call-event-consent-hardening.test.ts',
  'scripts/verify-oci-spine-checklist.mjs',
  'scripts/ci/purge-retired-audit-vocabulary.mjs',
  'scripts/ci/scrub-docs-retired-vocabulary.mjs',
  'scripts/ci/scrub-tests-retired-vocabulary.mjs',
  'schema_utf8.sql',
  'schema.sql',
] as const;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...walkFiles(abs));
    } else if (/\.(ts|tsx|mjs|js|md|sql|json)$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

function shouldSkip(rel: string): boolean {
  return SCAN_SKIP.some((s) => rel.includes(s.replace(/\\/g, '/')));
}

test('active tree has no retired OCI audit vocabulary', () => {
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = join(ROOT, root);
    for (const file of walkFiles(absRoot)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (shouldSkip(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (RETIRED_FORBIDDEN_RE.test(src)) offenders.push(rel);
    }
  }
  assert.equal(offenders.length, 0, `retired vocabulary in:\n${offenders.join('\n')}`);
});

test('final drop migration removes retired audit table and RPCs (idempotent when table absent)', () => {
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', RETIRED_DROP_MIGRATION), 'utf8');
  assert.match(sql, /to_regclass\('public\.marketing_signals'\)/i, 'must guard trigger drops when table already dropped');
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS public\\.${RETIRED_AUDIT_TABLE}`, 'i'));
  assert.match(sql, new RegExp(RETIRED_CLEANUP_RPC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('night-maintenance does not call retired signal retention RPC', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'night-maintenance', 'route.ts'), 'utf8');
  assert.ok(!src.includes(RETIRED_CLEANUP_RPC));
});
