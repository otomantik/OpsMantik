import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSingleConversionGroupKey,
  getSingleConversionGearRank,
  pickHighestPriorityGear,
  selectHighestPriorityCandidates,
} from '@/lib/oci/single-conversion-highest-only';

test('single conversion gear ranks keep V5 above lower stages', () => {
  assert.equal(getSingleConversionGearRank('V2_PULSE'), 1);
  assert.equal(getSingleConversionGearRank('V3_ENGAGE'), 2);
  assert.equal(getSingleConversionGearRank('V4_INTENT'), 3);
  assert.equal(getSingleConversionGearRank('V5_SEAL'), 4);
  assert.equal(pickHighestPriorityGear(['V2_PULSE', 'V4_INTENT', 'V5_SEAL']), 'V5_SEAL');
});

test('single conversion helper groups by session first and then call', () => {
  assert.equal(
    buildSingleConversionGroupKey('session-1', 'call-1', 'fallback-1'),
    'session:session-1'
  );
  assert.equal(
    buildSingleConversionGroupKey(null, 'call-1', 'fallback-1'),
    'call:call-1'
  );
  assert.equal(
    buildSingleConversionGroupKey(null, null, 'fallback-1'),
    'fallback:fallback-1'
  );
});

test('single conversion helper keeps only the highest gear per group', () => {
  const { kept, suppressed } = selectHighestPriorityCandidates([
    { id: 'v2', groupKey: 'session:a', gear: 'V2_PULSE', sortKey: '2026-04-10T10:00:00Z', value: 'v2' },
    { id: 'v3', groupKey: 'session:a', gear: 'V3_ENGAGE', sortKey: '2026-04-10T10:01:00Z', value: 'v3' },
    { id: 'v5', groupKey: 'session:a', gear: 'V5_SEAL', sortKey: '2026-04-10T10:02:00Z', value: 'v5' },
    { id: 'v4', groupKey: 'session:b', gear: 'V4_INTENT', sortKey: '2026-04-10T10:03:00Z', value: 'v4' },
    { id: 'v3b', groupKey: 'session:b', gear: 'V3_ENGAGE', sortKey: '2026-04-10T10:02:00Z', value: 'v3b' },
  ]);

  assert.deepEqual(
    kept.map((item) => item.id).sort(),
    ['v4', 'v5']
  );
  assert.deepEqual(
    suppressed.map((item) => item.id).sort(),
    ['v2', 'v3', 'v3b']
  );
});

test('google-ads export applies highest-only suppression before combining items', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts'), 'utf8');
  assert.ok(src.includes('selectHighestPriorityCandidates'), 'export must use shared highest-only selector');
  assert.ok(src.includes('SUPPRESSED_BY_HIGHER_GEAR'), 'suppressed lower gears must be terminalized with explicit provenance');
  assert.ok(src.includes('suppressedSignalIds'), 'export must track suppressed signals separately from exported signals');
});

test('outbox worker skips lower gears when a higher conversion already exists', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'cron', 'oci', 'process-outbox-events', 'route.ts'), 'utf8');
  assert.ok(src.includes('pickHighestPriorityGear'), 'outbox must compute highest observed gear');
  assert.ok(src.includes('outbox_signal_skip_higher_gear_exists'), 'outbox must log and skip lower gears when a higher one exists');
  assert.ok(!src.includes('Sequential Injection'), 'V5 path should stop backfilling lower gears in single-conversion mode');
});
