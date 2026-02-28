/**
 * Iron Seal — Ledger Immutability (Integration)
 *
 * Verifies PostgreSQL triggers on revenue_snapshots: UPDATE and DELETE must fail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env: ${key}`);
  return val;
}

test('Ledger: revenue_snapshots UPDATE must fail', async (t) => {
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Get a site_id for FK
  const { data: site, error: siteErr } = await admin
    .from('sites')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (siteErr || !site?.id) {
    console.warn('Skipping ledger test: no site found');
    return;
  }

  const siteId = site.id;

  // Insert a revenue_snapshots record
  const { data: row, error: insertErr } = await admin
    .from('revenue_snapshots')
    .insert({
      site_id: siteId,
      value_cents: 1000,
      currency: 'TRY',
    })
    .select('id')
    .single();

  if (insertErr) {
    console.warn('Skipping ledger test: revenue_snapshots insert failed:', insertErr.message);
    return;
  }

  t.after(async () => {
    // We cannot DELETE due to trigger — test verifies that
    // Leave row; it's append-only. Or use a dedicated test cleanup.
  });

  // Attempt UPDATE — must fail (trigger: _revenue_snapshots_immutable)
  const { error: updateErr } = await admin
    .from('revenue_snapshots')
    .update({ value_cents: 2000 })
    .eq('id', row.id);

  assert.ok(updateErr, 'UPDATE on revenue_snapshots must fail');
  assert.ok(
    updateErr.message?.toLowerCase().includes('immutable') ||
      updateErr.message?.toLowerCase().includes('updates not allowed'),
    `Expected immutable/updates error, got: ${updateErr.message}`
  );
});

test('Ledger: revenue_snapshots DELETE must fail', async (t) => {
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: site } = await admin.from('sites').select('id').limit(1).maybeSingle();
  if (!site?.id) {
    console.warn('Skipping ledger test: no site found');
    return;
  }

  const { data: row, error: insertErr } = await admin
    .from('revenue_snapshots')
    .insert({
      site_id: site.id,
      value_cents: 999,
      currency: 'TRY',
    })
    .select('id')
    .single();

  if (insertErr) {
    console.warn('Skipping ledger test: revenue_snapshots insert failed:', insertErr.message);
    return;
  }

  // Attempt DELETE — must fail
  const { error: deleteErr } = await admin.from('revenue_snapshots').delete().eq('id', row.id);

  assert.ok(deleteErr, 'DELETE on revenue_snapshots must fail');
  assert.ok(
    deleteErr.message?.toLowerCase().includes('immutable') ||
      deleteErr.message?.toLowerCase().includes('deletes not allowed'),
    `Expected immutable/deletes error, got: ${deleteErr.message}`
  );
});
