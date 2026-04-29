import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasAnyClickId } from '@/lib/oci/enqueue-seal-conversion';

test('click-id gate: hasAnyClickId accepts gclid/wbraid/gbraid', () => {
  assert.equal(hasAnyClickId({ gclid: 'abc', wbraid: null, gbraid: null }), true);
  assert.equal(hasAnyClickId({ gclid: null, wbraid: 'wb', gbraid: null }), true);
  assert.equal(hasAnyClickId({ gclid: null, wbraid: null, gbraid: 'gb' }), true);
});

test('click-id gate: rejects empty attribution tuple', () => {
  assert.equal(hasAnyClickId({ gclid: null, wbraid: null, gbraid: null }), false);
  assert.equal(hasAnyClickId({ gclid: '  ', wbraid: '', gbraid: '   ' }), false);
});

test('outbox bridge keeps click-id gate in path', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'oci', 'outbox', 'process-outbox.ts'),
    'utf8'
  );
  assert.ok(src.includes('safeValidateOciPayload'), 'outbox must validate click-id payload');
  assert.ok(src.includes('enqueueSealConversion'), 'won stage must route through enqueue gate');
});

