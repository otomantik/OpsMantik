import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const MIGRATION_FILE = join(
  MIGRATIONS_DIR,
  '20261226020000_create_append_worker_transition_batch_v2.sql'
);

function readSqlMigrations(): Array<{ name: string; source: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, source: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

test('append_worker_transition_batch_v2 is migration-authoritative with strict grants', () => {
  const migration = readFileSync(MIGRATION_FILE, 'utf8');

  assert.ok(
    migration.includes('create or replace function public.append_worker_transition_batch_v2('),
    'forward migration must define append_worker_transition_batch_v2'
  );
  assert.ok(
    migration.includes('security definer'),
    'migration must preserve SECURITY DEFINER model'
  );
  assert.ok(
    migration.includes('set search_path to public'),
    'migration must set search_path to public'
  );
  assert.ok(
    migration.includes(
      'revoke all on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) from public;'
    ),
    'migration must revoke PUBLIC execute'
  );
  assert.ok(
    migration.includes(
      'revoke all on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) from anon;'
    ),
    'migration must revoke anon execute'
  );
  assert.ok(
    migration.includes(
      'revoke all on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) from authenticated;'
    ),
    'migration must revoke authenticated execute'
  );
  assert.ok(
    migration.includes(
      'grant execute on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) to service_role;'
    ),
    'migration must grant execute only to service_role'
  );
});

test('migration sources do not broadly grant append_worker_transition_batch_v2 to anon/authenticated', () => {
  const sources = readSqlMigrations();
  const broadGrant = sources.find((entry) =>
    /grant\s+all\s+on\s+function\s+public\.append_worker_transition_batch_v2\([^)]*\)\s+to\s+.*(anon|authenticated)/i.test(
      entry.source
    ) ||
    /grant\s+execute\s+on\s+function\s+public\.append_worker_transition_batch_v2\([^)]*\)\s+to\s+.*(anon|authenticated)/i.test(
      entry.source
    )
  );
  assert.equal(
    broadGrant,
    undefined,
    `append_worker_transition_batch_v2 must not grant execute to anon/authenticated (found in ${broadGrant?.name})`
  );
});

test('runtime call sites match append_worker_transition_batch_v2 signature keys', () => {
  const callsites = [
    join(ROOT, 'lib', 'oci', 'process-single-oci-export.ts'),
    join(ROOT, 'lib', 'oci', 'runner', 'queue-bulk-update.ts'),
    join(ROOT, 'lib', 'oci', 'promote-blocked-queue.ts'),
  ];

  for (const file of callsites) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes("append_worker_transition_batch_v2"), `${file} must call worker batch v2 rpc`);
    assert.ok(src.includes('p_queue_ids'), `${file} must pass p_queue_ids`);
    assert.ok(src.includes('p_new_status'), `${file} must pass p_new_status`);
    assert.ok(src.includes('p_created_at'), `${file} must pass p_created_at`);
    assert.ok(src.includes('p_error_payload'), `${file} must pass p_error_payload`);
  }
});
