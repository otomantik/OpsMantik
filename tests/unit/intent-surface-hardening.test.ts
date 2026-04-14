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
const QUEUE_DECK = join(ROOT, 'components', 'dashboard', 'qualification-queue', 'queue-deck.tsx');
const OCI_CONTROL_PAGE = join(ROOT, 'app', 'dashboard', 'site', '[siteId]', 'oci-control', 'page.tsx');
const OCI_CONTROL_PANEL = join(ROOT, 'components', 'dashboard', 'oci-control', 'oci-control-panel.tsx');
const SITE_CONFIG_ROUTE = join(ROOT, 'app', 'api', 'sites', '[siteId]', 'config', 'route.ts');
const PANEL_PAGE = join(ROOT, 'app', 'panel', 'page.tsx');

test('click-origin ingestion stays inside canonical call ontology', () => {
  const src = readFileSync(PROCESS_CALL_EVENT, 'utf8');
  assert.ok(src.includes("const initialStatus = 'intent'"), 'process-call-event must insert canonical intent status');
  assert.ok(!src.includes("const initialStatus = 'pending_score'"), 'process-call-event must not invent pending_score state');
  assert.ok(
    src.includes('shadow_session_quality_v1_1') && src.includes('shadowSessionQualityV1_1'),
    'process-call-event must pass shadow V1.1 scoring context to calc-brain-score for parity telemetry'
  );
});

test('calc-brain-score keeps non-fast-track calls in intent state', () => {
  const src = readFileSync(CALC_BRAIN_SCORE, 'utf8');
  assert.ok(src.includes("const finalStatus = isFastTrack ? 'qualified' : 'intent'"), 'worker must downgrade to intent, not pending');
  assert.ok(!src.includes(": 'pending'"), 'worker must not write pending status');
  assert.ok(
    src.includes('shadow_session_quality_v1_1') && src.includes('recordScoringLineageParityTelemetry'),
    'calc-brain-score must consume shadow V1.1 context and run scoring-lineage parity telemetry'
  );
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

test('junk mutations wait for server confirmation and OCI panel exposes honest read-only state', () => {
  const deckSrc = readFileSync(QUEUE_DECK, 'utf8');
  const ociPageSrc = readFileSync(OCI_CONTROL_PAGE, 'utf8');
  const ociPanelSrc = readFileSync(OCI_CONTROL_PANEL, 'utf8');
  assert.ok(deckSrc.includes("void qualify({ score: 0, status: 'junk' })"), 'junk action must wait for server mutation');
  assert.ok(!deckSrc.includes("const handleJunk = ({ id }: { id: string }) => {\n    onOptimisticRemove(id);"), 'junk action must not optimistically remove before success');
  assert.ok(ociPageSrc.includes("canOperate={Boolean(access.role && hasCapability(access.role, 'queue:operate'))}"), 'OCI control page must derive canOperate from RBAC');
  assert.ok(ociPanelSrc.includes('disabled={!canOperate || actionBusy}'), 'OCI panel action buttons must respect read-only state');
});

test('panel onboarding respects site write capability and avoids operator deadlock', () => {
  const configSrc = readFileSync(SITE_CONFIG_ROUTE, 'utf8');
  const panelSrc = readFileSync(PANEL_PAGE, 'utf8');
  assert.ok(configSrc.includes("hasCapability(access.role, 'site:write')"), 'site config route must enforce site:write capability');
  assert.ok(panelSrc.includes("hasCapability(access.role, 'site:write')"), 'panel onboarding gate must compute site:write permission');
  assert.ok(panelSrc.includes('Kurulum Bekleniyor'), 'panel must show a non-editable setup-waiting state for non-writers');
});
