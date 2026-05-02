/**
 * PR3: funnel kernel appends canonical shadow rows after successful call_funnel_ledger insert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('appendFunnelEvent: wires appendCanonicalTruthLedgerFailClosed after funnel insert', () => {
  const p = join(ROOT, 'lib', 'domain', 'funnel-kernel', 'ledger-writer.ts');
  const src = readFileSync(p, 'utf8');
  assert.ok(
    src.includes('appendCanonicalTruthLedgerFailClosed'),
    'funnel ledger writer must shadow-write canonical substrate (failClosed → appendCanonicalTruthLedger handles missing table)'
  );
  assert.ok(
    src.includes('`canonical:funnel:${idempotencyKey}`'),
    'idempotency key must be canonical:funnel: + existing funnel idempotency key'
  );
  assert.ok(src.includes("streamKind: 'FUNNEL_LEDGER'"), 'stream kind must be FUNNEL_LEDGER');
});
