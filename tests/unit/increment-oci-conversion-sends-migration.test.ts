import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261230140000_increment_oci_conversion_sends_v1.sql'
);

test('increment_oci_conversion_sends_v1 migration defines ledger + atomic RPC', () => {
  const sql = readFileSync(MIG, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.oci_conversion_send_billing_ledger/i);
  assert.match(sql, /increment_oci_conversion_sends_v1/i);
  assert.match(sql, /FOR UPDATE/i, 'must lock usage_counters before billing');
  assert.match(sql, /ON CONFLICT \(queue_id\) DO NOTHING/i);
  assert.match(sql, /conversion_sends_count/i);
  assert.match(sql, /QUEUE_SITE_MISMATCH/i);
  assert.match(sql, /'LIMIT'/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.increment_oci_conversion_sends_v1/i);
});
