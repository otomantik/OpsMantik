import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { inferIntentAction, normalizePhoneTarget } from '@/lib/api/call-event/shared';
import { getSchemaUtf8 } from '@/tests/helpers/schema-utf8-contract';

const ROOT = process.cwd();
const TRACKER = join(ROOT, 'lib', 'tracker', 'tracker.js');
const CALL_EVENT_V1 = join(ROOT, 'app', 'api', 'call-event', 'route.ts');
const CALL_EVENT_V2 = join(ROOT, 'app', 'api', 'call-event', 'v2', 'route.ts');
const INTENT_SERVICE = join(ROOT, 'lib', 'services', 'intent-service.ts');
const RESTORE_INTENT_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260428143000_restore_intent_idempotency_contracts.sql');

test('normalizePhoneTarget canonicalizes tel targets to stable dial strings', () => {
  assert.equal(normalizePhoneTarget('tel:+90 (555) 111-22-33'), '+905551112233');
  assert.equal(normalizePhoneTarget('+90 (555) 111-22-33'), '+905551112233');
});

test('normalizePhoneTarget canonicalizes WhatsApp phone links across URL variants', () => {
  assert.equal(normalizePhoneTarget('https://wa.me/905551112233'), 'whatsapp:905551112233');
  assert.equal(normalizePhoneTarget('https://api.whatsapp.com/send?phone=%2B905551112233&text=Merhaba'), 'whatsapp:+905551112233');
  assert.equal(normalizePhoneTarget('whatsapp://send?phone=905551112233'), 'whatsapp:905551112233');
  assert.equal(normalizePhoneTarget('https://chat.whatsapp.com/AbCdEfGhIjK'), 'whatsapp:joinchat/AbCdEfGhIjK');
  assert.equal(normalizePhoneTarget('https://api.whatsapp.com/joinchat/AbCdEfGhIjK'), 'whatsapp:joinchat/AbCdEfGhIjK');
});

test('inferIntentAction recognizes canonical WhatsApp targets', () => {
  assert.equal(inferIntentAction('https://wa.me/905551112233'), 'whatsapp');
  assert.equal(inferIntentAction('whatsapp:+905551112233'), 'whatsapp');
  assert.equal(inferIntentAction('tel:+905551112233'), 'phone');
});

test('tracker sends explicit canonical intent contract for call events', () => {
  const src = readFileSync(TRACKER, 'utf8');
  assert.ok(src.includes('intent_action: resolvedIntent.intentAction'), 'tracker must send explicit intent_action');
  assert.ok(src.includes('intent_target: resolvedIntent.intentTarget'), 'tracker must send explicit intent_target');
  assert.ok(src.includes('intent_stamp: resolvedIntent.intentStamp'), 'tracker must send explicit intent_stamp');
  assert.ok(src.includes('intent_page_url: resolvedIntent.intentPageUrl'), 'tracker must send explicit intent_page_url');
  assert.ok(src.includes('phone_number: resolvedIntent.intentTarget'), 'tracker must canonicalize stored phone_number target');
  assert.ok(
    src.includes("emitTrackedIntent(anchorHref, 'phone_call', anchorHref, 'phone', anchor)") ||
      src.includes("emitTrackedIntent(rawHref, 'phone_call', rawHref, 'phone', anchor)"),
    'tel/sms click path must use emitTrackedIntent with phone_call + phone source'
  );
  assert.ok(src.includes("emitTrackedIntent(href, 'whatsapp', href, inferWidgetSource(href, dataWa), dataWa);"), 'data-om-whatsapp path must use the shared tracked-intent helper');
  assert.ok(src.includes("emitTrackedIntent(wa.href, 'whatsapp', wa.href, inferWidgetSource(wa.href, wa), wa);"), 'anchor WhatsApp path must use the shared tracked-intent helper');
});

test('call-event routes normalize explicit target before persisting worker payload', () => {
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  for (const src of [v1, v2]) {
    assert.ok(src.includes('const rawIntentTarget ='), 'route must derive a single raw intent target');
    assert.ok(src.includes('const intent_target = normalizePhoneTarget(rawIntentTarget);'), 'route must canonicalize intent_target');
    assert.ok(src.includes("intent_target.toLowerCase().startsWith('whatsapp:')"), 'route must let canonical target force whatsapp action');
  }
});

test('tracker installs window.open hook for widget-driven WhatsApp opens', () => {
  const src = readFileSync(TRACKER, 'utf8');
  assert.ok(src.includes('installOutboundIntentHooks();'), 'tracker must install outbound hooks during init');
  assert.ok(src.includes('window.open = function (...args)'), 'tracker must wrap window.open for widget-driven WhatsApp opens');
  assert.ok(src.includes("if (raw.includes('jivo') || raw.includes('jivosite')) return 'jivo';"), 'tracker must classify jivo widget sources');
  assert.ok(src.includes("if (raw.includes('joinchat')) return 'joinchat';"), 'tracker must classify joinchat widget sources');
});

test('tracker emits explicit canonical form intent contract', () => {
  const src = readFileSync(TRACKER, 'utf8');
  assert.ok(src.includes('function buildFormIntentMeta(form)'), 'tracker must build canonical form intent metadata');
  assert.ok(src.includes("intentAction: 'form'"), 'form helper must emit form action');
  assert.ok(src.includes('intentTarget: `form:${String(formIdentity).trim() || \'unknown\'}`'), 'form helper must emit canonical form target');
  assert.ok(src.includes("emitFormLifecycle(form, 'form_start'"), 'tracker must emit form_start lifecycle');
  assert.ok(src.includes("emitFormLifecycle(form, 'form_submit_attempt'"), 'tracker must emit form submit attempts');
  assert.ok(src.includes("emitFormLifecycle(form, 'form_submit_validation_failed'"), 'tracker must emit validation failures');
  assert.ok(src.includes("'form_submit_success'"), 'tracker must emit success events');
  assert.ok(src.includes("'form_submit_network_failed'"), 'tracker must emit network failure events');
  assert.ok(src.includes('form_summary: intentMeta.formSummary'), 'form lifecycle payload must include pii-safe summary');
});

test('backend intent bridge and DB kernel treat form as first-class without downgrading phone or whatsapp', () => {
  const serviceSrc = readFileSync(INTENT_SERVICE, 'utf8');
  const migrationSrc = readFileSync(RESTORE_INTENT_MIGRATION, 'utf8');
  const schemaSrc = getSchemaUtf8();
  assert.ok(serviceSrc.includes("const FORM_ACTIONS = new Set(["), 'intent service must recognize form actions');
  assert.ok(serviceSrc.includes("'form_submit_success'"), 'intent service must include form success lifecycle');
  assert.ok(serviceSrc.includes("private static normalizeFormTarget"), 'intent service must canonicalize form targets');
  assert.ok(serviceSrc.includes("private static normalizeFormState"), 'intent service must normalize lifecycle state');
  assert.ok(serviceSrc.includes("p_form_state: formState"), 'intent service must forward form state to the DB kernel');
  assert.ok(serviceSrc.includes("p_form_summary: formSummary"), 'intent service must forward form summary to the DB kernel');
  assert.ok(migrationSrc.includes("v_action NOT IN ('phone', 'whatsapp', 'form')"), 'ensure_session_intent_v1 must allow form');
  assert.ok(migrationSrc.includes('form_state') && migrationSrc.includes('form_summary'), 'restore migration wires form columns on calls');
  assert.ok(
    schemaSrc.includes('Form updates never downgrade phone or whatsapp heads'),
    'schema snapshot documents form vs phone/whatsapp head invariants'
  );
  assert.ok(schemaSrc.includes("'form_state', c.form_state"), 'lite RPC exposes form_state');
  assert.ok(schemaSrc.includes('c.form_summary AS form_summary'), 'lite RPC exposes form_summary');
});
