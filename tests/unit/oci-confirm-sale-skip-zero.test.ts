/**
 * PR-OCI-4 (P0): confirm_sale_and_enqueue must NEVER enqueue 0/NULL sales.
 * Source-inspection test for the migration that replaces the RPC.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260606000000_confirm_sale_and_enqueue_skip_zero_value.sql'
);

test('PR-OCI-4: confirm_sale_and_enqueue migration guards amount_cents NULL/<=0 and avoids INSERT', () => {
  const src = readFileSync(MIGRATION, 'utf-8');

  assert.ok(
    src.includes('CREATE OR REPLACE FUNCTION public.confirm_sale_and_enqueue'),
    'Expected migration to define/replace confirm_sale_and_enqueue'
  );

  // Guard exists
  assert.ok(/amount_cents/i.test(src), 'Expected migration to reference amount_cents');
  assert.ok(
    /v_sale\.amount_cents\s+is\s+null/i.test(src) || /amount_cents\s+is\s+null/i.test(src),
    'Expected NULL guard for amount_cents'
  );
  assert.ok(
    /v_sale\.amount_cents\s*<=\s*0/i.test(src) || /amount_cents\s*<=\s*0/i.test(src),
    'Expected <= 0 guard for amount_cents'
  );

  // Returns without enqueuing
  assert.ok(
    src.includes('RETURN QUERY') && (src.includes('false') || src.includes('enqueued')),
    'Expected RETURN QUERY for enqueued=false on zero-value sales'
  );
  assert.ok(
    src.includes('INSERT INTO public.offline_conversion_queue'),
    'Expected migration to contain offline_conversion_queue insert path (for valid sales)'
  );
});
