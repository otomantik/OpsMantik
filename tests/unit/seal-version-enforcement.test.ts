/**
 * PR-OCI-6 (P1): UI may omit version; server MUST enforce optimistic locking by
 * passing p_version = body.version ?? call.version to the RPC.
 * Source-inspection tests (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEAL_ROUTE = join(process.cwd(), 'app', 'api', 'calls', '[id]', 'seal', 'route.ts');

test('PR-OCI-6: seal route fetches call.version (server-side source of truth)', () => {
  const src = readFileSync(SEAL_ROUTE, 'utf-8');
  assert.ok(
    src.includes(".select('id, site_id, version") || src.includes('.select("id, site_id, version'),
    'Expected seal route to select call.version from DB'
  );
});

test('PR-OCI-6: seal route requires version and returns 400 when omitted', () => {
  const src = readFileSync(SEAL_ROUTE, 'utf-8');
  assert.ok(
    src.includes('version === null') && src.includes('status: 400'),
    'Expected seal route to return 400 when version is missing (Phase 8: require version)'
  );
});

test('PR-OCI-6: seal route passes p_version to RPC', () => {
  const src = readFileSync(SEAL_ROUTE, 'utf-8');
  assert.ok(
    /p_version\s*:/.test(src),
    'Expected seal route to pass p_version to apply_call_action_v1'
  );
});

test('PR-OCI-6: seal route maps P0002 version mismatch to HTTP 409', () => {
  const src = readFileSync(SEAL_ROUTE, 'utf-8');
  assert.ok(
    src.includes("updateError.code === 'P0002'") || src.includes('updateError.code === "P0002"'),
    'Expected P0002 handling for version mismatch'
  );
  assert.ok(
    src.includes('status: 409'),
    'Expected HTTP 409 response on version mismatch'
  );
});
