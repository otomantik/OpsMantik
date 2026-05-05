import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Historical migration that issued GRANT ALL … TO anon, authenticated, service_role before
 * 20261226000000. Kept in chain; must not be copied forward.
 */
const LEGACY_BROAD_GRANT_FILE = '20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql';

const FORWARD_GRANT_REASSERT_FILE = '20261226022000_oci_transition_rpc_grants_service_role_only.sql';

/** Privileged OCI transition / snapshot / queue worker RPCs (must stay service_role-only). */
const PRIVILEGED_OCI_TRANSITION_RPCS = [
  'oci_transition_payload_allowed_keys',
  'oci_transition_payload_missing_required',
  'oci_transition_payload_unknown_keys',
  'queue_transition_clear_fields',
  'queue_transition_payload_has_meaningful_patch',
  'log_oci_payload_validation_event',
  'apply_snapshot_batch',
  'assert_latest_ledger_matches_snapshot',
  'apply_oci_queue_transition_snapshot',
  'append_rpc_claim_transition_batch',
  'append_script_claim_transition_batch',
  'append_script_transition_batch',
  'claim_offline_conversion_rows_for_script_export',
  'append_worker_transition_batch_v2',
  'append_manual_transition_batch',
  'update_queue_status_locked',
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineTargetsPrivilegedRpc(line: string): boolean {
  if (!/\bON\s+FUNCTION\b/i.test(line)) return false;
  return PRIVILEGED_OCI_TRANSITION_RPCS.some((rpc) =>
    new RegExp(`\\bpublic\\.${escapeRegExp(rpc)}\\s*\\(`, 'i').test(line)
  );
}

/** True when GRANT lists anon, authenticated, or PUBLIC as grantees (case-insensitive). */
function grantGrantsToWorldRoles(line: string): boolean {
  const trimmed = line.trim();
  if (!/^GRANT\s/i.test(trimmed)) return false;
  const toIdx = trimmed.search(/\bTO\b/i);
  if (toIdx < 0) return false;
  const granteePart = trimmed.slice(toIdx);
  return /\bTO\s+.*\b(anon|authenticated|PUBLIC)\b/i.test(granteePart);
}

test('migrations: privileged OCI transition RPCs must not GRANT to anon/authenticated/PUBLIC (except legacy file)', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const body = readFileSync(join(dir, name), 'utf8');
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      if (!/^GRANT\s/i.test(line)) continue;
      if (!lineTargetsPrivilegedRpc(line)) continue;
      if (!grantGrantsToWorldRoles(line)) continue;
      assert.ok(
        name === LEGACY_BROAD_GRANT_FILE,
        `Unexpected world-role GRANT for privileged OCI transition RPC in ${name}: ${line.slice(0, 220)}`
      );
    }
  }
});

test(`migration ${FORWARD_GRANT_REASSERT_FILE} re-asserts REVOKE+service_role GRANT for every privileged RPC`, () => {
  const path = join(process.cwd(), 'supabase', 'migrations', FORWARD_GRANT_REASSERT_FILE);
  const body = readFileSync(path, 'utf8');
  for (const rpc of PRIVILEGED_OCI_TRANSITION_RPCS) {
    assert.match(
      body,
      new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${escapeRegExp(rpc)}\\s*\\(`,
        'is'
      ),
      `missing REVOKE ALL for ${rpc}`
    );
    const grantLine = body.split('\n').find(
      (l) =>
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION/i.test(l) &&
        new RegExp(`public\\.${escapeRegExp(rpc)}\\s*\\(`, 'i').test(l)
    );
    assert.ok(grantLine, `missing GRANT EXECUTE ON FUNCTION … for ${rpc}`);
    assert.match(
      grantLine,
      /\bTO\s+service_role\b/i,
      `GRANT for ${rpc} must target service_role only`
    );
  }
});

test('migrations: privileged OCI transition RPCs must have at least one GRANT EXECUTE … TO service_role', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const combined = names.map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
  const flat = combined.replace(/\s+/g, ' ');
  for (const rpc of PRIVILEGED_OCI_TRANSITION_RPCS) {
    assert.match(
      flat,
      new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${escapeRegExp(rpc)}\\s*\\([^)]*\\)\\s+TO\\s+service_role`,
        'i'
      ),
      `no service_role EXECUTE grant found for ${rpc}`
    );
  }
});
