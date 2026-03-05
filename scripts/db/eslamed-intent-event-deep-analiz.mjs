#!/usr/bin/env node
/**
 * Eslamed — Intent vs Event derin analiz (23:00–00:00 İstanbul)
 * 30 call intent, 0 call_intent event çıktığında: Tracker phone_call/whatsapp gönderir;
 * tüm intent action'larıyla event sayısı karşılaştırılır. Session tekrarları ve saldırı/bug ayrımı.
 *
 * Kullanım: node scripts/db/eslamed-intent-event-deep-analiz.mjs [--start ISO] [--end ISO]
 * Varsayılan: dün gece 23:00–00:00 Europe/Istanbul
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const ESLAMED_SITE_ID = 'b1264552-c859-40cb-a3fb-0ba057afd070';

const INTENT_EVENT_ACTIONS = [
  'call_intent',
  'phone_call',
  'phone_click',
  'call_click',
  'tel_click',
  'whatsapp',
  'whatsapp_click',
  'wa_click',
  'joinchat',
];

function getWindowIstanbulYesterday2300() {
  const now = new Date();
  const yesterdayMs = now.getTime() - 24 * 60 * 60 * 1000;
  const yesterdayIstanbul = new Date(yesterdayMs).toLocaleDateString('en-CA', {
    timeZone: 'Europe/Istanbul',
  });
  const [y, m, day] = yesterdayIstanbul.split('-').map(Number);
  // 23:00 Istanbul = 20:00 UTC (TR sabit UTC+3), 00:00 ertesi gün = 21:00 UTC aynı gün
  const windowStart = new Date(Date.UTC(y, m - 1, day, 20, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(y, m - 1, day, 21, 0, 0, 0));
  return { windowStart, windowEnd };
}

async function run() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  let windowStart, windowEnd;
  const startArg = process.argv.find((a) => a.startsWith('--start='));
  const endArg = process.argv.find((a) => a.startsWith('--end='));
  if (startArg && endArg) {
    windowStart = new Date(startArg.split('=')[1]);
    windowEnd = new Date(endArg.split('=')[1]);
  } else {
    const w = getWindowIstanbulYesterday2300();
    windowStart = w.windowStart;
    windowEnd = w.windowEnd;
  }

  const supabase = createClient(url, key);
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Eslamed — Intent vs Event derin analiz (23:00–00:00 İstanbul)');
  console.log('  Pencere:', startIso, '→', endIso);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1) Calls (intent kayıtları: status = 'intent' veya NULL)
  const { data: calls, error: callsErr } = await supabase
    .from('calls')
    .select('id, created_at, matched_session_id, intent_action, intent_stamp, status')
    .eq('site_id', ESLAMED_SITE_ID)
    .eq('source', 'click')
    .or('status.eq.intent,status.is.null')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: true });

  if (callsErr) {
    console.error('Calls sorgu hatası:', callsErr.message);
    process.exit(1);
  }

  // 2) Events (tüm intent action'ları — tracker phone_call/whatsapp gönderir, call_intent değil)
  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, session_id, event_action, created_at')
    .eq('site_id', ESLAMED_SITE_ID)
    .in('event_action', INTENT_EVENT_ACTIONS)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: true });

  if (eventsErr) {
    console.error('Events sorgu hatası:', eventsErr.message);
    process.exit(1);
  }

  const callsList = calls || [];
  const eventsList = events || [];

  // 3) Session bazlı gruplama (calls)
  const callsBySession = new Map();
  for (const c of callsList) {
    const sid = c.matched_session_id ?? '(session_yok)';
    if (!callsBySession.has(sid)) callsBySession.set(sid, []);
    callsBySession.get(sid).push(c);
  }

  // 4) Event action dağılımı
  const eventActionCount = new Map();
  for (const e of eventsList) {
    eventActionCount.set(e.event_action, (eventActionCount.get(e.event_action) || 0) + 1);
  }

  // 5) Her call için aynı session'da o pencerede intent event var mı?
  const sessionIdsFromCalls = new Set(callsList.map((c) => c.matched_session_id).filter(Boolean));
  const sessionIdsFromEvents = new Set(eventsList.map((e) => e.session_id));
  const callsWithMatchingEvent = callsList.filter((c) => {
    if (!c.matched_session_id) return false;
    return eventsList.some(
      (e) =>
        e.session_id === c.matched_session_id &&
        Math.abs(new Date(e.created_at) - new Date(c.created_at)) < 120_000
    );
  });
  const callsWithoutEvent = callsList.filter((c) => !callsWithMatchingEvent.some((x) => x.id === c.id));

  // ---- Rapor ----
  console.log('--- 1) ÖZET ---');
  console.log('  calls (intent) sayısı:', callsList.length);
  console.log('  events (intent action) sayısı:', eventsList.length);
  console.log('  unique session (calls):', callsBySession.size);
  console.log('  unique session (events):', sessionIdsFromEvents.size);
  console.log('  call ile eşleşen event (≈2 dk içinde):', callsWithMatchingEvent.length);
  console.log('  event\'i olmayan call:', callsWithoutEvent.length);
  console.log('');

  console.log('--- 2) EVENT ACTION DAĞILIMI (neden call_intent=0 çıktı?) ---');
  console.log('  Tracker tel için "phone_call", WhatsApp için "whatsapp" gönderir (call_intent değil).');
  if (eventActionCount.size === 0) {
    console.log('  Bu pencerede hiç intent event YOK. Call\'lar başka kaynaktan (API/manuel) veya event kaydı eksik.');
  } else {
    for (const [action, count] of [...eventActionCount.entries()].sort((a, b) => b[1] - a[1])) {
      console.log('   ', action + ':', count);
    }
  }
  console.log('');

  console.log('--- 3) SESSION BAZLI CALL TEKRARLARI (aynı session = tek kullanıcı, çoklu tıklama/saldırı?) ---');
  const multiIntentSessions = [...callsBySession.entries()].filter(([, arr]) => arr.length > 1);
  if (multiIntentSessions.length === 0) {
    console.log('  Her session\'da en fazla 1 intent call. Tekrarlı session yok.');
  } else {
    for (const [sessionId, arr] of multiIntentSessions.sort((a, b) => b[1].length - a[1].length)) {
      console.log('   session', String(sessionId).slice(0, 8) + '...', '→', arr.length, 'intent');
    }
  }
  console.log('');

  console.log('--- 4) SONUÇ (neden 30 call / 0 call_intent_event?) ---');
  if (eventsList.length === 0 && callsList.length > 0) {
    console.log('  • Event 0, call 30: Call\'lar sync/event pipeline dışında oluşmuş olabilir (call-event API, manuel)');
    console.log('  • Veya events farklı partition/site_id/null yüzünden gelmiyor; Supabase SQL ile events tablosunda');
    console.log('    site_id + created_at ile bu pencereyi kontrol et.');
  } else if (eventsList.length >= callsList.length) {
    console.log('  • Event sayısı >= call: Pipeline tutarlı. Runbook\'ta "intent_event_sayisi" (tüm action\'lar)');
    console.log('    kullanıldığında calls ile uyumlu çıkmalı. call_intent=0 normal (tracker phone_call/whatsapp kullanıyor).');
  } else {
    console.log('  • Event < call: Bir kısım call event olmadan oluşmuş (gecikme, farklı kanal veya bug).');
  }
  console.log('');
  console.log('  Runbook güncellendi: blok 3 artık tüm intent action\'ları sayıyor (call_intent + phone_call + whatsapp vb.).');
  console.log('  Tekrar çalıştır: docs/runbooks/oci_eslamed_dun_11_12_intent_analiz.sql');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
