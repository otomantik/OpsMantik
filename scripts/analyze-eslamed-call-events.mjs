#!/usr/bin/env node
/**
 * Eslamed Call Event & OCI Queue — Teşhis Scripti
 *
 * 2 giriş yaptı ama script dönüşüm bulamadı → Bu script nedenini analiz eder.
 *
 * Akış:
 *   call-event → calls tablosu → seal → enqueueSealConversion()
 *     → no_click_id (session'da gclid yok) veya
 *     → marketing_consent_required (consent_scopes'ta marketing yok) veya
 *     → star_below_threshold → kuyruğa GİRMEZ
 *   offline_conversion_queue (QUEUED/RETRY) → Google Ads Script export
 *
 * Çalıştır: node scripts/analyze-eslamed-call-events.mjs
 * Gerekli: .env.local → NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key);

// ---------------------------------------------------------------------------
// 1) Eslamed site bul
// ---------------------------------------------------------------------------
const { data: sites, error: siteErr } = await admin
  .from('sites')
  .select('id, public_id, name, domain, oci_sync_method')
  .or('name.ilike.%Eslamed%,domain.ilike.%eslamed%');

if (siteErr || !sites?.length) {
  console.error('Eslamed site not found:', siteErr?.message || '');
  process.exit(1);
}

const site = sites[0];
const siteId = site.id;
console.log('\n========================================');
console.log('Eslamed Site:', site.name || site.domain, '| id:', siteId, '| public_id:', site.public_id);
console.log('oci_sync_method:', site.oci_sync_method || '(script)');
console.log('========================================\n');

// ---------------------------------------------------------------------------
// 2) Son 7 gün: sealed call'lar
// ---------------------------------------------------------------------------
const { data: sealedCalls, error: callsErr } = await admin
  .from('calls')
  .select('id, matched_session_id, status, oci_status, confirmed_at, lead_score, sale_amount, created_at')
  .eq('site_id', siteId)
  .eq('status', 'confirmed')
  .eq('oci_status', 'sealed')
  .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
  .order('confirmed_at', { ascending: false });

if (callsErr) {
  console.error('Calls query error:', callsErr.message);
  process.exit(1);
}

console.log('--- 1) Mühürlenmiş Call\'lar (son 7 gün) ---');
console.log('Toplam:', sealedCalls?.length ?? 0);
if (sealedCalls?.length) {
  for (const c of sealedCalls) {
    console.log(`  - call_id: ${c.id}, matched_session: ${c.matched_session_id || '(yok)'}, confirmed: ${c.confirmed_at}`);
  }
} else {
  console.log('  (Hiç mühürlenmiş call yok — henüz seal yapılmamış veya farklı tarih aralığı)');
}

// ---------------------------------------------------------------------------
// 3) Session'larda gclid ve consent kontrolü (sealed call'lar için)
// ---------------------------------------------------------------------------
const sessionIds = [...new Set((sealedCalls ?? []).map((c) => c.matched_session_id).filter(Boolean))];
let sessionsMap = {};
if (sessionIds.length > 0) {
  const { data: sessions } = await admin
    .from('sessions')
    .select('id, gclid, wbraid, gbraid, consent_scopes, created_at')
    .eq('site_id', siteId)
    .in('id', sessionIds);
  sessionsMap = Object.fromEntries((sessions ?? []).map((s) => [s.id, s]));
}

console.log('\n--- 2) Session Analizi (gclid + consent) ---');
for (const c of sealedCalls ?? []) {
  const sid = c.matched_session_id;
  const s = sid ? sessionsMap[sid] : null;
  const gclid = s?.gclid?.trim() || null;
  const wbraid = s?.wbraid?.trim() || null;
  const gbraid = s?.gbraid?.trim() || null;
  const hasClickId = !!(gclid || wbraid || gbraid);
  const scopes = Array.isArray(s?.consent_scopes) ? s.consent_scopes : [];
  const hasMarketing = scopes.some((x) => String(x).toLowerCase() === 'marketing');

  let reason = 'OK';
  if (!sid) reason = 'matched_session_id yok → no_click_id';
  else if (!hasClickId) reason = 'gclid/wbraid/gbraid hepsi NULL → no_click_id';
  else if (!hasMarketing) reason = "consent_scopes'ta marketing yok → marketing_consent_required";
  else reason = 'Kuyruğa girmeli (queue kontrol et)';

  console.log(`  call ${c.id}:`);
  console.log(`    session: ${sid || '(yok)'}`);
  console.log(`    gclid: ${gclid || '(boş)'}, wbraid: ${wbraid || '(boş)'}, gbraid: ${gbraid || '(boş)'}`);
  console.log(`    consent_scopes: ${JSON.stringify(scopes)} | marketing: ${hasMarketing}`);
  console.log(`    → ${reason}`);
}

// ---------------------------------------------------------------------------
// 4) offline_conversion_queue
// ---------------------------------------------------------------------------
const { data: queueRows, error: queueErr } = await admin
  .from('offline_conversion_queue')
  .select('id, call_id, status, provider_key, gclid, wbraid, gbraid, value_cents, created_at, last_error')
  .eq('site_id', siteId)
  .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false });

if (queueErr) {
  console.error('Queue query error:', queueErr.message);
} else {
  const byStatus = {};
  for (const r of queueRows ?? []) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  console.log('\n--- 3) offline_conversion_queue (son 7 gün) ---');
  console.log('Status dağılımı:', JSON.stringify(byStatus, null, 2));
  console.log('Script export sadece QUEUED ve RETRY alır.');
  if (queueRows?.length) {
    for (const r of queueRows.slice(0, 10)) {
      console.log(`  - queue_id: ${r.id}, call_id: ${r.call_id}, status: ${r.status}, gclid: ${r.gclid || '(boş)'}, created: ${r.created_at}`);
      if (r.last_error) console.log(`    last_error: ${r.last_error}`);
    }
    if (queueRows.length > 10) console.log(`  ... ve ${queueRows.length - 10} satır daha`);
  } else {
    console.log('  (Queue\'da kayıt yok)');
  }
}

// ---------------------------------------------------------------------------
// 5) Son 7 gün tüm call'lar (sadece 2 giriş = belki henüz seal değil)
// ---------------------------------------------------------------------------
const { data: allCalls } = await admin
  .from('calls')
  .select('id, matched_session_id, status, oci_status, created_at')
  .eq('site_id', siteId)
  .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })
  .limit(20);

console.log('\n--- 4) Son Call\'lar (tüm status) ---');
const sealedCount = (allCalls ?? []).filter((c) => c.oci_status === 'sealed').length;
const confirmedCount = (allCalls ?? []).filter((c) => c.status === 'confirmed').length;
console.log(`Toplam ${allCalls?.length ?? 0} call (son 20), sealed: ${sealedCount}, confirmed: ${confirmedCount}`);
if (allCalls?.length) {
  for (const c of allCalls.slice(0, 8)) {
    console.log(`  - ${c.id} | status: ${c.status} | oci: ${c.oci_status} | session: ${c.matched_session_id || '(yok)'} | ${c.created_at}`);
  }
}

// ---------------------------------------------------------------------------
// 6) Özet ve öneriler
// ---------------------------------------------------------------------------
const queuedCount = (queueRows ?? []).filter((r) => r.status === 'QUEUED' || r.status === 'RETRY').length;
console.log('\n========================================');
console.log('ÖZET');
console.log('========================================');
console.log(`Sealed call: ${sealedCalls?.length ?? 0}`);
console.log(`Queue (QUEUED+RETRY, script\'in alacağı): ${queuedCount}`);
if (queuedCount === 0 && (sealedCalls?.length ?? 0) > 0) {
  console.log('\n⚠️  Script 0 döndürüyor çünkü QUEUED/RETRY satır yok.');
  console.log('   Muhtemel nedenler:');
  console.log('   - no_click_id: Session\'da gclid/wbraid/gbraid yok (tracker/sync doğru site_id ile gclid yazıyor mu?)');
  console.log('   - marketing_consent_required: consent_scopes içinde marketing yok');
  console.log('   - star_below_threshold: lead_score düşük, oci_config.min_star karşılanmıyor');
} else if (queuedCount > 0) {
  console.log('\n✓ Queue\'da export edilebilir kayıt var. Script doğru site_id ve api_key ile mi çağrılıyor?');
  console.log('  Export URL: GET /api/oci/google-ads-export?siteId=' + (site.public_id || siteId) + '&markAsExported=true');
}
console.log('========================================\n');
