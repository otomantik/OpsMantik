import test from 'node:test';
import assert from 'node:assert/strict';

import { extractMissingColumnName, stripColumnFromInsertPayload } from '@/lib/api/call-event/schema-drift';

test('extractMissingColumnName: postgres undefined_column format', () => {
  const col = extractMissingColumnName({
    code: '42703',
    message: 'column "click_id" of relation "calls" does not exist',
  });
  assert.equal(col, 'click_id');
});

test('extractMissingColumnName: postgrest schema cache format', () => {
  const col = extractMissingColumnName({
    code: 'PGRST204',
    message: "Could not find the 'intent_page_url' column of 'calls' in the schema cache",
  });
  assert.equal(col, 'intent_page_url');
});

test('stripColumnFromInsertPayload: strips optional columns but never site_id', () => {
  const payload = { site_id: 'site-1', click_id: 'x', intent_page_url: 'y' };
  const r1 = stripColumnFromInsertPayload(payload, 'click_id');
  assert.equal(r1.stripped, true);
  assert.equal((r1.next as any).click_id, undefined);
  assert.equal((r1.next as any).site_id, 'site-1');

  const r2 = stripColumnFromInsertPayload(r1.next, 'site_id');
  assert.equal(r2.stripped, false);
  assert.equal((r2.next as any).site_id, 'site-1');
});

