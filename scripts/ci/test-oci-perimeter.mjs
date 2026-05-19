#!/usr/bin/env node
/**
 * Static OCI perimeter checks (fast): strict Zod surfaces, FSM migration text,
 * ledger close_stale migration, and CRITICAL_MIGRATIONS alignment.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readRel(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

function fail(msg) {
  console.error(`test:oci-perimeter: ${msg}`);
  process.exit(1);
}

const exportQueryZod = readRel('lib', 'oci', 'schemas', 'google-ads-export-query.zod.ts');
if (!exportQueryZod.includes('.strict()')) fail('google-ads-export-query.zod.ts must use .strict()');

const heartbeatZod = readRel('lib', 'oci', 'schemas', 'script-heartbeat-body.zod.ts');
if (!heartbeatZod.includes('.strict()')) fail('script-heartbeat-body.zod.ts must use .strict()');

const defcon = readRel('supabase', 'migrations', '20261231000000_defcon1_absolute_fsm_dictatorship.sql');
if (!defcon.includes('DEFCON_1_ILLEGAL_STATE_TRANSITION')) fail('DEFCON-1 migration must raise DEFCON_1_ILLEGAL_STATE_TRANSITION');

const closeStale = readRel('supabase', 'migrations', '20261231130000_close_stale_uploaded_conversions_ledger_v1.sql');
if (!closeStale.includes('append_worker_transition_batch_v2')) {
  fail('close_stale_uploaded ledger migration must call append_worker_transition_batch_v2');
}

const evidence = readRel('scripts', 'release', 'collect-gate-evidence.mjs');
if (!evidence.includes('20261231130000_close_stale_uploaded_conversions_ledger_v1.sql')) {
  fail('collect-gate-evidence.mjs CRITICAL_MIGRATIONS must list close_stale_uploaded_conversions_ledger_v1');
}

console.log('test:oci-perimeter OK');
