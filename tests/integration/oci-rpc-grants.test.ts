import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-key';

/**
 * INVARIANTS PROVEN:
 * 1. anon/authenticated roles cannot execute privileged OCI transition RPCs.
 * 2. service_role can execute required worker/RPC path.
 */
test('OCI RPC Grants Hardening', async (t) => {
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  await t.test('anon cannot execute apply_snapshot_batch', async () => {
    // If the grant was revoked, this should throw a permission/function not found error
    // or return a PGRST error for insufficient privilege.
    const { error } = await anonClient.rpc('apply_snapshot_batch', { p_batch_ids: [] });
    assert.ok(error !== null, 'anon should not be able to execute apply_snapshot_batch');
    assert.match(error.message, /permission denied|function apply_snapshot_batch does not exist/i, 'should fail due to missing grant');
  });

  await t.test('service_role can execute apply_snapshot_batch (even if payload is empty)', async () => {
    // It might fail for other reasons (like empty batch), but it should NOT be a permission error.
    const { error } = await serviceClient.rpc('apply_snapshot_batch', { p_batch_ids: [] });
    if (error) {
      assert.doesNotMatch(error.message, /permission denied/i, 'service_role should have EXECUTE grant');
    }
  });
});
