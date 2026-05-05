import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  INTENT_STATUS_ROUTE_EXECUTABLE,
  INTENT_STATUS_ROUTE_RECOGNIZED,
  INTENT_STATUS_ROUTE_UNSUPPORTED,
} from '@/lib/api/intent-status-route-contract';
import { TERMINAL_STATUSES as SESSION_REUSE_TERMINAL_STATUSES } from '@/lib/intents/session-reuse-v1';
import {
  CANONICAL_CALL_STATUSES,
  CANONICAL_CALL_STATUS_SET,
  CANONICAL_DB_CALL_STATUSES,
  CANONICAL_DB_CALL_STATUS_SET,
  DOCUMENTED_CALL_STATUS_INVENTORY_SORTED,
  INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED,
  LEGACY_CALL_STATUSES,
  LEGACY_CALL_STATUS_SET,
  MIGRATION_AND_APP_SURFACE_STATUSES,
  OCI_EXPORTABLE_CALL_STATUSES,
  OCI_EXPORTABLE_STAGE_STATUSES,
  OCI_GOOGLE_CONVERSION_WON_TIER_CALL_STATUSES,
  STATUS_ROUTE_EXECUTABLE_STATUSES,
  STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES,
  TERMINAL_CALL_STATUSES,
  TERMINAL_CALL_STATUS_SET,
} from '@/lib/domain/intents/status-taxonomy';

const PARITY_MATRIX = join(
  process.cwd(),
  'docs',
  'OPS',
  'INTENT_RUNTIME_PARITY_MATRIX.md'
);

test('TERMINAL_CALL_STATUSES mirrors session-reuse TERMINAL_STATUSES (won is a reuse blocker)', () => {
  assert.deepEqual([...TERMINAL_CALL_STATUSES], [...SESSION_REUSE_TERMINAL_STATUSES]);
});

test('merged is migration/surface token only — not POST /status recognized body; not DB CHECK', () => {
  assert.ok(!CANONICAL_DB_CALL_STATUS_SET.has('merged'));
  assert.ok(!(INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED as readonly string[]).includes('merged'));
});

test('enqueue-panel-stage-outbox skips merged rows via merged_into_call_id (not calls.status)', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'oci', 'enqueue-panel-stage-outbox.ts'),
    'utf8'
  );
  assert.ok(
    src.includes('merged_into_call_id') && src.includes('panel_stage_outbox_skip_merged_call_total'),
    'OCI producer must key archive skip off merged_into_call_id'
  );
});

test('intent status route contract literals match taxonomy SSOT tuples', () => {
  assert.deepEqual([...INTENT_STATUS_ROUTE_RECOGNIZED], [...INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED]);
  assert.deepEqual([...INTENT_STATUS_ROUTE_EXECUTABLE], [...STATUS_ROUTE_EXECUTABLE_STATUSES]);
  assert.deepEqual([...INTENT_STATUS_ROUTE_UNSUPPORTED], [...STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES]);
});

test('intent POST recognized order partitions into executable ∪ unsupported exactly once each', () => {
  const order = [...INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED];
  const execSet = new Set(STATUS_ROUTE_EXECUTABLE_STATUSES);
  const unsupSet = new Set(STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES);
  assert.equal(execSet.size, STATUS_ROUTE_EXECUTABLE_STATUSES.length);
  assert.equal(unsupSet.size, STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES.length);
  for (const s of STATUS_ROUTE_EXECUTABLE_STATUSES) assert.ok(unsupSet.has(s) === false);
  for (const s of STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES) assert.ok(execSet.has(s) === false);
  assert.equal(order.length, execSet.size + unsupSet.size);
  for (const x of order) assert.ok(execSet.has(x) || unsupSet.has(x));
});

test('no duplicates across canonical vs legacy taxonomy buckets', () => {
  for (const s of LEGACY_CALL_STATUSES) {
    assert.ok(!CANONICAL_CALL_STATUS_SET.has(s), `${s} must not be both canonical+funnel-primary and legacy bucket`);
  }
  for (const s of CANONICAL_CALL_STATUSES) {
    assert.ok(!LEGACY_CALL_STATUS_SET.has(s));
  }
  for (const s of MIGRATION_AND_APP_SURFACE_STATUSES) {
    assert.ok(!CANONICAL_DB_CALL_STATUS_SET.has(s), `merged lifecycle is not DB CHECK enumerated`);
    assert.ok(!LEGACY_CALL_STATUS_SET.has(s));
  }
});

test('terminal statuses are status-route executable only where explicitly modeled (junk + cancelled)', () => {
  let terminalMarkedExecutable = 0;
  for (const s of TERMINAL_CALL_STATUSES) {
    if ((STATUS_ROUTE_EXECUTABLE_STATUSES as readonly string[]).includes(s)) terminalMarkedExecutable += 1;
  }
  assert.equal(
    terminalMarkedExecutable,
    2,
    'only junk and cancelled intersect terminal ∪ status-route executable'
  );
  assert.ok((STATUS_ROUTE_EXECUTABLE_STATUSES as readonly string[]).includes('intent'));
  assert.ok(!TERMINAL_CALL_STATUS_SET.has('intent'));
});

test('OCI export inventory matches resolveOciStageFromCallStatus non-null mapping (frozen list)', () => {
  /** Mirror of `enqueue-panel-stage-outbox.resolveOciStageFromCallStatus` non-null statuses. */
  const expected = new Set(['contacted', 'offered', 'junk', 'won', 'confirmed', 'qualified', 'real']);
  assert.deepEqual(new Set(OCI_EXPORTABLE_CALL_STATUSES), expected);
  assert.strictEqual(OCI_EXPORTABLE_STAGE_STATUSES, OCI_EXPORTABLE_CALL_STATUSES);

  assert.deepEqual(
    new Set(OCI_GOOGLE_CONVERSION_WON_TIER_CALL_STATUSES),
    new Set(['won', 'confirmed', 'qualified', 'real'])
  );
});

test('DOCUMENTED_CALL_STATUS_INVENTORY_SORTED aligns with taxonomy exports / DB ∪ drift bucket', () => {
  assert.deepEqual(
    DOCUMENTED_CALL_STATUS_INVENTORY_SORTED,
    [...new Set([...CANONICAL_DB_CALL_STATUSES, ...MIGRATION_AND_APP_SURFACE_STATUSES])].sort((a, b) =>
      a.localeCompare(b)
    )
  );
});

test('INTENT_RUNTIME_PARITY_MATRIX taxonomy table mentions every DOCUMENTED_CALL_STATUS row', () => {
  const body = readFileSync(PARITY_MATRIX, 'utf8');

  /** Section starts below this heading; naive parse all backtick statuses in first column of taxonomy table. */


  const start = body.indexOf('<!-- intent-status-taxonomy-ssot-begin -->');
  const end = body.indexOf('<!-- intent-status-taxonomy-ssot-end -->');
  assert.ok(start >= 0 && end > start, 'markers must bracket taxonomy table');
  const slice = body.slice(start, end);
  /** Rows like | `intent` | */
  const rowMatches = [...slice.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gim)].map((m) => m[1]);
  const tableSet = new Set(rowMatches);

  assert.equal(tableSet.size, DOCUMENTED_CALL_STATUS_INVENTORY_SORTED.length);
  for (const status of DOCUMENTED_CALL_STATUS_INVENTORY_SORTED) {
    assert.ok(tableSet.has(status), `taxonomy doc row missing: ${status}`);
  }
});
