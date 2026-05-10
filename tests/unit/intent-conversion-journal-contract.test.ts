import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENT_JOURNAL_STAGES,
  intentStageToConversionName,
  resolveQueueJournalDisposition,
  defaultProviderPathFromSyncMethod,
  evaluateSignalReadiness,
} from '@/lib/oci/intent-conversion-journal-contract';

test('PR-9H.6: four intent journal stages map to OpsMantik conversion names', () => {
  assert.deepEqual(INTENT_JOURNAL_STAGES, ['contacted', 'offered', 'won', 'junk_exclusion']);
  assert.equal(intentStageToConversionName('contacted'), 'OpsMantik_Contacted');
  assert.equal(intentStageToConversionName('offered'), 'OpsMantik_Offered');
  assert.equal(intentStageToConversionName('won'), 'OpsMantik_Won');
  assert.equal(intentStageToConversionName('junk_exclusion'), 'OpsMantik_Junk_Exclusion');
});

test('PR-9H.6: script v1 path blocks wbraid-only rows', () => {
  const now = new Date().toISOString();
  const d = resolveQueueJournalDisposition({
    providerPath: 'google_ads_script_v1',
    consentMarketing: true,
    consentUserIdentifiers: true,
    sendabilityOk: true,
    gclid: null,
    wbraid: 'wb',
    gbraid: null,
    userIdentifiers: null,
    nowIso: now,
  });
  assert.equal(d.status, 'BLOCKED_PRECEDING_SIGNALS');
  assert.equal(d.blockReason, 'PROVIDER_PATH_SCRIPT_V1_REQUIRES_GCLID');
  assert.equal(d.classification, 'WBRAID_GBRAID_AVAILABLE_BUT_SCRIPT_UNSUPPORTED');
});

test('PR-9H.6: script v1 + gclid is QUEUED', () => {
  const now = new Date().toISOString();
  const d = resolveQueueJournalDisposition({
    providerPath: 'google_ads_script_v1',
    consentMarketing: true,
    consentUserIdentifiers: true,
    sendabilityOk: true,
    gclid: 'x',
    wbraid: null,
    gbraid: null,
    userIdentifiers: null,
    nowIso: now,
  });
  assert.equal(d.status, 'QUEUED');
  assert.equal(d.classification, 'INTENT_JOURNALIZED_READY');
});

test('PR-9H.6: api sync method defaults provider path to api click conversion', () => {
  assert.equal(defaultProviderPathFromSyncMethod('api'), 'google_ads_api_click_conversion');
  assert.equal(defaultProviderPathFromSyncMethod('script'), 'google_ads_script_v1');
});

test('PR-9H.6: evaluateSignalReadiness — api click includes wbraid', () => {
  const r = evaluateSignalReadiness({ gclid: null, wbraid: 'w', gbraid: null, userIdentifiers: null });
  assert.equal(r.scriptV1GclidReady, false);
  assert.equal(r.apiClickIdReady, true);
});
