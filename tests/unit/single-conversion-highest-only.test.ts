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

test('single conversion gear ranks keep sales above lower stages', () => {
  assert.equal(getSingleConversionGearRank('junk'), 0);
  assert.equal(getSingleConversionGearRank('contacted'), 1);
  assert.equal(getSingleConversionGearRank('offered'), 2);
  assert.equal(getSingleConversionGearRank('won'), 3);
  assert.equal(pickHighestPriorityGear(['contacted', 'offered', 'won']), 'won');
  assert.equal(pickHighestPriorityGear(['junk', 'contacted', 'offered']), 'offered');
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
    { id: 'contacted', groupKey: 'session:a', gear: 'contacted', sortKey: '2026-04-10T10:00:00Z', value: 'contacted' },
    { id: 'offered', groupKey: 'session:a', gear: 'offered', sortKey: '2026-04-10T10:01:00Z', value: 'offered' },
    { id: 'won', groupKey: 'session:a', gear: 'won', sortKey: '2026-04-10T10:02:00Z', value: 'won' },
    { id: 'offered-b', groupKey: 'session:b', gear: 'offered', sortKey: '2026-04-10T10:03:00Z', value: 'offered-b' },
    { id: 'contacted-b', groupKey: 'session:b', gear: 'contacted', sortKey: '2026-04-10T10:02:00Z', value: 'contacted-b' },
  ]);

  assert.deepEqual(
    kept.map((item) => item.id).sort(),
    ['offered-b', 'won']
  );
  assert.deepEqual(
    suppressed.map((item) => item.id).sort(),
    ['contacted', 'contacted-b', 'offered']
  );
});

test('google-ads export applies highest-only suppression before combining items', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'), 'utf8');
  assert.ok(src.includes('selectHighestPriorityCandidates'), 'export must use shared highest-only selector');
  const markSrc = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'), 'utf8');
  assert.ok(markSrc.includes('SUPPRESSED_BY_HIGHER_GEAR'), 'suppressed lower gears must be terminalized with explicit provenance');
  assert.ok(src.includes('suppressedSignalIds'), 'export must track suppressed signals separately from exported signals');
});

test('outbox worker skips lower gears when a higher conversion already exists', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'outbox', 'process-outbox.ts'), 'utf8');
  assert.ok(src.includes('pickHighestPriorityGear'), 'outbox must compute highest observed gear');
  assert.ok(src.includes('outbox_signal_skip_higher_gear_exists'), 'outbox must log and skip lower gears when a higher one exists');
  const cronRoute = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'oci', 'process-outbox-events', 'route.ts'),
    'utf8'
  );
  assert.ok(cronRoute.includes('runProcessOutbox'), 'cron route must delegate to shared outbox runner');
  assert.ok(!cronRoute.includes('Sequential Injection'), 'V5 path should stop backfilling lower gears in single-conversion mode');
});
