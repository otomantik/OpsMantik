import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STAGE_ROUTE = join(ROOT, 'app', 'api', 'intents', '[id]', 'stage', 'route.ts');
const PANEL_FEED = join(ROOT, 'components', 'dashboard', 'panel-feed.tsx');
const LEAD_ACTION_OVERLAY = join(ROOT, 'components', 'dashboard', 'lead-action-overlay.tsx');
const INVALIDATE_HELPER = join(ROOT, 'lib', 'oci', 'invalidate-pending-artifacts.ts');

test('stage route checks RPC persistence before downstream side-effects', () => {
  const src = readFileSync(STAGE_ROUTE, 'utf8');
  const rpcIndex = src.indexOf("adminClient.rpc('apply_call_action_v1'");
  const errorGuardIndex = src.indexOf('if (updateError) {', rpcIndex);
  // Queue enqueue is now via the enqueueSealConversion helper (the only seal-side
  // enqueue path). Secondary writes to marketing_signals happen for non-won stages
  // through the upsertMarketingSignal SSOT helper (direct .from('marketing_signals')
  // no longer appears in this route — it's owned by lib/domain/mizan-mantik/
  // upsert-marketing-signal.ts).
  const sealEnqueueIndex = src.indexOf('enqueueSealConversion(');
  const upsertSignalIndex = src.indexOf('upsertMarketingSignal(');

  assert.ok(rpcIndex >= 0, 'stage route must persist via apply_call_action_v1');
  assert.ok(errorGuardIndex > rpcIndex, 'stage route must guard RPC failures');
  assert.ok(sealEnqueueIndex > errorGuardIndex, 'seal enqueue must happen after RPC success guard');
  assert.ok(upsertSignalIndex > errorGuardIndex, 'marketing_signals SSOT upsert must happen after RPC success guard');
});

test('stage route treats junk as a real junk transition and invalidates pending OCI artifacts', () => {
  const src = readFileSync(STAGE_ROUTE, 'utf8');
  const helperSrc = readFileSync(INVALIDATE_HELPER, 'utf8');

  assert.ok(src.includes("actionType === 'junk'"), 'stage route must recognize explicit junk action_type');
  assert.ok(src.includes("p_action_type: 'junk'"), 'junk branch must call apply_call_action_v1(junk)');
  assert.ok(src.includes('queued: false'), 'junk response must explicitly report queued=false');
  assert.ok(src.includes('invalidatePendingOciArtifactsForCall(callId, siteId, \'CALL_STATUS_REVERSED:JUNK\''), 'junk branch must invalidate pending artifacts');
  assert.ok(helperSrc.includes(".from('offline_conversion_queue')"), 'invalidator must touch offline_conversion_queue');
  assert.ok(helperSrc.includes("provider_error_code: 'CALL_NOT_SENDABLE_FOR_OCI'"), 'invalidator must terminalize queue rows with deterministic skip provenance');
});

test('panel feed waits for real server success before removing a card', () => {
  const src = readFileSync(PANEL_FEED, 'utf8');

  assert.ok(src.includes('body: JSON.stringify({ phone, score, action_type: actionType'), 'panel feed must send action_type to the stage route');
  assert.ok(src.includes("if (!res.ok || !result?.success)"), 'panel feed must gate completion on server success');
  assert.ok(src.includes('setCalls(prev => prev.filter(c => c.id !== intent.id));'), 'panel feed must still remove cards after success');
  assert.ok(src.indexOf("if (!res.ok || !result?.success)") < src.indexOf('setCalls(prev => prev.filter(c => c.id !== intent.id));'), 'card removal must happen after server success check');
});

test('lead action overlay shows success only when parent completion succeeds', () => {
  const src = readFileSync(LEAD_ACTION_OVERLAY, 'utf8');

  assert.ok(src.includes('const result = await onComplete(actionType, phone, finalScore'), 'overlay must await the parent completion result');
  assert.ok(src.includes('if (!result.success) {'), 'overlay must keep the user in-flow on failure');
  assert.ok(src.includes("setSubmitError(result.error ?? t('toast.failedUpdate'));"), 'overlay must surface the server failure to the user');
  assert.ok(src.indexOf('if (!result.success) {') < src.indexOf("setStep('success');"), 'success screen must only happen after a positive result');
});
