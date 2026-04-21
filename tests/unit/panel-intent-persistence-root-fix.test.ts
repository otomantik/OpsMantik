import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STAGE_ROUTE = join(ROOT, 'app', 'api', 'intents', '[id]', 'stage', 'route.ts');
const PANEL_FEED = join(ROOT, 'components', 'dashboard', 'panel-feed.tsx');
const LEAD_ACTION_OVERLAY = join(ROOT, 'components', 'dashboard', 'lead-action-overlay.tsx');
const INVALIDATE_HELPER = join(ROOT, 'lib', 'oci', 'invalidate-pending-artifacts.ts');

test('stage route delegates mutation and side-effects to apply_call_action_v2', () => {
  const src = readFileSync(STAGE_ROUTE, 'utf8');
  const rpcIndex = src.indexOf("adminClient.rpc('apply_call_action_v2'");
  const errorGuardIndex = src.indexOf('if (updateError) {', rpcIndex);
  
  // Side-effects (enqueues, signals) are now handled via the outbox processor
  // triggered by the notifyOutboxPending helper at the end of the route.
  const outboxNotifyIndex = src.indexOf('notifyOutboxPending(');

  assert.ok(rpcIndex >= 0, 'stage route must persist via apply_call_action_v2');
  assert.ok(errorGuardIndex > rpcIndex, 'stage route must guard RPC failures');
  assert.ok(outboxNotifyIndex > errorGuardIndex, 'outbox notification must happen after RPC success guard');
});

test('stage route treats junk as a canonical optimization_stage and invalidates pending OCI artifacts', () => {
  const src = readFileSync(STAGE_ROUTE, 'utf8');
  const helperSrc = readFileSync(INVALIDATE_HELPER, 'utf8');

  assert.ok(src.includes("optimizationStage === 'junk'"), 'stage route must handle junk stage');
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
