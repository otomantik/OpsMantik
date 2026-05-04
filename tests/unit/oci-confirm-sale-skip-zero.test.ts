/**
 * PR-OCI-4 (P0): confirm_sale_and_enqueue must NEVER enqueue 0/NULL sales.
 * Source-inspection: canonical function lives in schema_utf8.sql (full DB snapshot);
 * incremental migrations may omit a standalone replace file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_UTF8 = join(process.cwd(), 'schema_utf8.sql');

function readConfirmSaleAndEnqueueSource(): string {
  const full = readFileSync(SCHEMA_UTF8, 'utf8');
  const start = full.indexOf('CREATE OR REPLACE FUNCTION "public"."confirm_sale_and_enqueue"');
  const end = full.indexOf('CREATE OR REPLACE FUNCTION "public"."conversation_links_entity_site_check"', start);
  if (start === -1 || end === -1) {
    throw new Error('confirm_sale_and_enqueue block not found in schema_utf8.sql');
  }
  return full.slice(start, end);
}

test('PR-OCI-4: confirm_sale_and_enqueue guards amount_cents NULL/<=0 and avoids INSERT', () => {
  const src = readConfirmSaleAndEnqueueSource();

  assert.ok(
    src.includes('CREATE OR REPLACE FUNCTION "public"."confirm_sale_and_enqueue"'),
    'Expected schema snapshot to define confirm_sale_and_enqueue'
  );

  assert.ok(/amount_cents/i.test(src), 'Expected function to reference amount_cents');
  assert.ok(
    /v_sale\.amount_cents\s+is\s+null/i.test(src) || /amount_cents\s+is\s+null/i.test(src),
    'Expected NULL guard for amount_cents'
  );
  assert.ok(
    /v_sale\.amount_cents\s*<=\s*0/i.test(src) || /amount_cents\s*<=\s*0/i.test(src),
    'Expected <= 0 guard for amount_cents'
  );

  assert.ok(
    src.includes('RETURN QUERY') && (src.includes('false') || src.includes('enqueued')),
    'Expected RETURN QUERY for enqueued=false on zero-value sales'
  );
  assert.ok(
    src.includes('INSERT INTO public.offline_conversion_queue'),
    'Expected offline_conversion_queue insert path (for valid sales)'
  );
});
