import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSignalManifest } from '@/lib/types/signal-manifest';

const ROOT = process.cwd();
const PROCESS_CALL_EVENT = join(ROOT, 'lib', 'ingest', 'process-call-event.ts');
const CALC_BRAIN_SCORE = join(ROOT, 'app', 'api', 'workers', 'calc-brain-score', 'route.ts');
const AUTO_JUNK = join(ROOT, 'app', 'api', 'cron', 'auto-junk', 'route.ts');
const TRACKER_CONFIG = join(ROOT, 'lib', 'tracker', 'config.js');
const TRACKER_TRANSPORT = join(ROOT, 'lib', 'tracker', 'transport.js');
const SYNC_ROUTE = join(ROOT, 'app', 'api', 'sync', 'route.ts');
const USE_INTENTS = join(ROOT, 'lib', 'hooks', 'use-intents.ts');
const INTENT_STATUS_BADGE = join(ROOT, 'components', 'dashboard', 'intent-status-badge.tsx');

test('click-origin ingestion stays inside canonical call ontology', () => {
  const src = readFileSync(PROCESS_CALL_EVENT, 'utf8');
  assert.ok(src.includes("const initialStatus = 'intent'"), 'process-call-event must insert canonical intent status');
  assert.ok(!src.includes("const initialStatus = 'pending_score'"), 'process-call-event must not invent pending_score state');
});

test('calc-brain-score keeps non-fast-track calls in intent state', () => {
  const src = readFileSync(CALC_BRAIN_SCORE, 'utf8');
  assert.ok(src.includes("const finalStatus = isFastTrack ? 'qualified' : 'intent'"), 'worker must downgrade to intent, not pending');
  assert.ok(!src.includes(": 'pending'"), 'worker must not write pending status');
});

test('auto-junk targets stale intent rows', () => {
  const src = readFileSync(AUTO_JUNK, 'utf8');
  assert.ok(src.includes(".eq('status', 'intent')"), 'auto-junk must target canonical intent rows');
});

test('tracker config supports first-party sync proxy', () => {
  const src = readFileSync(TRACKER_CONFIG, 'utf8');
  assert.ok(src.includes('data-ops-sync-proxy-url'), 'tracker config must accept explicit sync proxy attribute');
  assert.ok(src.includes('opsSyncProxyUrl'), 'tracker config must accept runtime sync proxy config');
  assert.ok(src.includes("'/sync'"), 'tracker config must be able to derive sibling /sync proxy route');
});

test('last-gasp flush batches prioritized payloads instead of only first envelope', () => {
  const src = readFileSync(TRACKER_TRANSPORT, 'utf8');
  assert.ok(src.includes('buildUnloadBeaconBody'), 'transport must build prioritized unload payload');
  assert.ok(src.includes("selected.length === 1 ? selected[0] : { events: selected }"), 'transport must send canonical events batch when possible');
  assert.ok(!src.includes('JSON.stringify(queue[0].payload)'), 'transport must not send only the first queued envelope');
});

test('signal manifest parser accepts legacy unload batch alias for compatibility', () => {
  const parsed = parseSignalManifest({
    batch: [{ s: 'site-1', url: 'https://example.com' }],
  });
  assert.equal(parsed.ok, true, 'legacy batch alias must remain readable during rollout');
  if (parsed.ok) {
    assert.equal(parsed.data.events.length, 1);
    assert.equal(parsed.data.events[0].s, 'site-1');
  }
});

test('tracker sync payload keeps consent scopes readable by strict signal manifest', () => {
  const trackerSrc = readFileSync(join(ROOT, 'lib', 'tracker', 'tracker.js'), 'utf8');
  assert.ok(trackerSrc.includes('consent_scopes: trackerConsentScopes'), 'tracker payload must include consent_scopes');

  const parsed = parseSignalManifest({
    s: 'site-1',
    url: 'https://example.com',
    consent_scopes: ['analytics', 'marketing'],
  });
  assert.equal(parsed.ok, true, 'strict signal manifest must accept consent_scopes');
  if (parsed.ok) {
    assert.deepEqual(parsed.data.events[0].consent_scopes, ['analytics', 'marketing']);
  }
});

test('tracker shadow mode stamps payload version and backend logs stale trackers without blocking ingest', () => {
  const trackerSrc = readFileSync(join(ROOT, 'lib', 'tracker', 'tracker.js'), 'utf8');
  const configSrc = readFileSync(TRACKER_CONFIG, 'utf8');
  const syncSrc = readFileSync(SYNC_ROUTE, 'utf8');
  assert.ok(configSrc.includes('trackerVersion'), 'tracker config must expose a version stamp');
  assert.ok(trackerSrc.includes('om_tracker_version: CONFIG.trackerVersion'), 'tracker payload meta must include om_tracker_version');
  assert.ok(syncSrc.includes('OPSMANTIK_TRACKER_SHADOW_MODE'), 'sync route must guard stale tracker logging behind env flag');
  assert.ok(syncSrc.includes('STALE_TRACKER_DETECTED'), 'sync route must emit stale tracker alert');
});

test('cancelled intents stay visible in dashboard status model', () => {
  const hookSrc = readFileSync(USE_INTENTS, 'utf8');
  const badgeSrc = readFileSync(INTENT_STATUS_BADGE, 'utf8');
  assert.ok(hookSrc.includes("'cancelled'"), 'use-intents status union must include cancelled');
  assert.ok(badgeSrc.includes("if (status === 'cancelled')"), 'status badge must render cancelled explicitly');
  assert.ok(badgeSrc.includes("t('activity.statusCancelled')"), 'cancelled badge must use dedicated label');
});
