#!/usr/bin/env node
/**
 * Eslamed — Dün gece 22:40 (TRT) sonrası SALDIRI intent'leri çöpe atar (junk).
 * Aynı kriterler: ≤3sn kalış, tek etkileşim, proxy, aynı FP >3, aynı IP >5.
 * apply_call_action_v1(call_id, 'junk') ile audit log + session hidden korunur.
 *
 * Kullanım:
 *   node scripts/db/oci-eslamed-junk-saldiri-2240.mjs           # dry-run (sadece listele)
 *   node scripts/db/oci-eslamed-junk-saldiri-2240.mjs --apply   # gerçekten junk'la
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const doApply = process.argv.includes('--apply');

function getSince2240TRT() {
  const now = new Date();
  const trtDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const [y, m, d] = trtDateStr.split('-').map(Number);
  const yesterday = new Date(y, m - 1, d - 1);
  const yStr = yesterday.getFullYear();
  const mStr = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dStr = String(yesterday.getDate()).padStart(2, '0');
  const since = new Date(`${yStr}-${mStr}-${dStr}T22:40:00+03:00`);
  return since.toISOString();
}

async function main() {
  const sinceIso = getSince2240TRT();
  const siteArg = 'Eslamed';

  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name')
    .or('name.ilike.%Eslamed%,public_id.eq.81d957f3c7534f53b12ff305f9f07ae7')
    .limit(1)
    .single();
  if (!siteRow) {
    console.error('Eslamed site bulunamadı.');
    process.exit(1);
  }
  const siteId = siteRow.id;

  const { data: callsIntent, error: errIntent } = await supabase
    .from('calls')
    .select('id, created_at, matched_session_id, status')
    .eq('site_id', siteId)
    .eq('source', 'click')
    .or('status.eq.intent,status.is.null')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  if (errIntent) {
    console.error('Calls çekilemedi:', errIntent);
    process.exit(1);
  }
  const intentCalls = callsIntent || [];
  if (intentCalls.length === 0) {
    console.log('22:40 sonrası intent yok. Çöp atanacak kayıt yok.');
    return;
  }

  const sessionIds = [...new Set(intentCalls.map((c) => c.matched_session_id).filter(Boolean))];
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, fingerprint, ip_address, total_duration_sec, event_count, is_proxy_detected')
    .eq('site_id', siteId)
    .in('id', sessionIds);
  const sessionById = new Map((sessions || []).map((s) => [s.id, s]));

  const fpCount = new Map();
  const ipCount = new Map();
  for (const c of intentCalls) {
    const s = sessionById.get(c.matched_session_id);
    const fp = s?.fingerprint ?? null;
    const ip = s?.ip_address != null ? String(s.ip_address) : null;
    if (fp) fpCount.set(fp, (fpCount.get(fp) || 0) + 1);
    if (ip) ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  }

  const saldiriIds = [];
  for (const c of intentCalls) {
    const s = sessionById.get(c.matched_session_id);
    const duration = s?.total_duration_sec ?? null;
    const events = s?.event_count ?? null;
    const proxy = s?.is_proxy_detected === true;
    const fp = s?.fingerprint ?? null;
    const ip = s?.ip_address != null ? String(s.ip_address) : null;
    const nFp = fp ? fpCount.get(fp) || 0 : 0;
    const nIp = ip ? ipCount.get(ip) || 0 : 0;
    const suspekt =
      (duration != null && duration <= 3) ||
      (events != null && events <= 1) ||
      proxy ||
      nFp > 3 ||
      nIp > 5;
    if (suspekt) saldiriIds.push(c.id);
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ESLAMED — DÜNKÜ SALDIRI DATASI ÇÖPE ATMA (22:40 TRT sonrası)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Pencere:', sinceIso, '→ şimdi');
  console.log('  Saldırı (şüpheli) intent sayısı:', saldiriIds.length);
  console.log('  Mod:', doApply ? 'UYGULA (junk yapılıyor)' : 'DRY-RUN (sadece listele)');
  console.log('');

  if (saldiriIds.length === 0) {
    console.log('  Çöp atanacak call yok.');
    console.log('');
    return;
  }

  if (!doApply) {
    console.log('  Junk yapılacak call_id\'ler (ilk 20):');
    saldiriIds.slice(0, 20).forEach((id, i) => console.log('   ', i + 1, id));
    if (saldiriIds.length > 20) console.log('   ... ve', saldiriIds.length - 20, 'tane daha.');
    console.log('');
    console.log('  Gerçekten çöpe atmak için: node scripts/db/oci-eslamed-junk-saldiri-2240.mjs --apply');
    console.log('');
    return;
  }

  let ok = 0;
  let err = 0;
  for (const callId of saldiriIds) {
    const { data, error } = await supabase.rpc('apply_call_action_v1', {
      p_call_id: callId,
      p_action_type: 'junk',
      p_payload: { lead_score: 0, reason: 'oci-eslamed-junk-saldiri-2240' },
      p_actor_type: 'system',
      p_actor_id: null,
      p_metadata: { script: 'oci-eslamed-junk-saldiri-2240', since: sinceIso },
      p_version: null,
    });
    if (error) {
      console.error('  [HATA]', callId, error.message);
      err++;
    } else {
      ok++;
      if (ok <= 5) console.log('  [OK]', callId);
    }
  }
  console.log('');
  console.log('  Sonuç: junk yapıldı:', ok, '| hata:', err);
  console.log('  Kuyruk görünümü artık bu call\'ları (ve aynı session\'dakileri) göstermez.');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
