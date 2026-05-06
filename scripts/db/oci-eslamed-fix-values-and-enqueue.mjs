#!/usr/bin/env node
/**
 * Eslamed — GCLID kontrolü, matematik değer düzeltmesi (V2/V3/V4), hepsini kuyruğa al.
 * V3 1000 TL hatası: floor yüzünden; doğru matematik AOV × ratio × decay (örn. 1000×0.2×0.5 = 100 TRY).
 *
 * Kullanım: node scripts/db/oci-eslamed-fix-values-and-enqueue.mjs
 *           node scripts/db/oci-eslamed-fix-values-and-enqueue.mjs --dry-run
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

const NAME_TO_RATIO = {
  OpsMantik_V2_Ilk_Temas: 0.02,
  OpsMantik_V3_Nitelikli_Gorusme: 0.2,
  OpsMantik_V4_Sicak_Teklif: 0.3,
};

function getDecay(days) {
  if (days <= 3) return 0.5;
  if (days <= 10) return 0.25;
  return 0.1;
}

async function resolveSiteId(q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data?.id || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or('name.ilike.%' + q + '%,domain.ilike.%' + q + '%')
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const allowUnsafeWrite = process.env.ALLOW_UNSAFE_OCI_VALUE_WRITE === '1';

  if (!dryRun && !allowUnsafeWrite) {
    console.error('[SAFE-GUARD] Ad-hoc signal deger yazimi varsayilan olarak kapali.');
    console.error('[SAFE-GUARD] SSOT policy disina cikmamak icin once --dry-run ile aday satirlari inceleyin.');
    console.error('Gecici override gerekiyorsa ALLOW_UNSAFE_OCI_VALUE_WRITE=1 ile bilincli calistirin.');
    process.exit(2);
  }

  const siteId = await resolveSiteId('Eslamed');
  if (!siteId) {
    console.error('Site bulunamadi: Eslamed');
    process.exit(1);
  }

  const { data: siteRow, error: siteErr } = await supabase
    .from('sites')
    .select('id, name, default_aov, intent_weights, min_conversion_value_cents')
    .eq('id', siteId)
    .maybeSingle();

  if (siteErr || !siteRow) {
    console.error('Site okuma hatası:', siteErr?.message || 'bulunamadı');
    process.exit(1);
  }

  const aov = Number(siteRow.default_aov) > 0 ? Number(siteRow.default_aov) : 1000;
  const iw = siteRow.intent_weights || {};
  const ratioV2 = iw.pending != null ? Number(iw.pending) : 0.02;
  const ratioV3 = iw.qualified != null ? Number(iw.qualified) : 0.2;
  const ratioV4 = iw.proposal != null ? Number(iw.proposal) : 0.3;

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const dayAfterTomorrow = new Date(todayStart);
  dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 2);
  const fromIso = yesterdayStart.toISOString();
  const toIso = dayAfterTomorrow.toISOString();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Eslamed — GCLID kontrolü, değer düzeltmesi, kuyruğa al');
  console.log('  Site:', siteRow.name, '| AOV:', aov, 'TRY');
  console.log('  Matematik: V2=' + ratioV2 + ' V3=' + ratioV3 + ' V4=' + ratioV4 + ', decay(gün≤3)=0.5');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // --- 1) Queue: bugün+dün, GCLID var mı
  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, value_cents, currency, conversion_time, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .gte('conversion_time', fromIso)
    .lt('conversion_time', toIso)
    .order('conversion_time', { ascending: true });

  if (qErr) {
    console.error('Kuyruk hatası:', qErr.message);
    process.exit(1);
  }

  console.log('--- 1) KUYRUK (V5 Demir Mühür) — GCLID kontrolü ---');
  const queueList = (queueRows || []).map((r) => {
    const hasGclid = !!(r.gclid || r.wbraid || r.gbraid);
    return { ...r, hasGclid };
  });
  queueList.forEach((r, i) => {
    console.log('  ' + (i + 1) + '. status=' + r.status + ' value=' + (r.value_cents / 100) + ' TRY GCLID=' + (r.hasGclid ? 'VAR' : 'YOK') + ' time=' + (r.conversion_time || '').slice(0, 19));
  });
  const queueNoGclid = queueList.filter((r) => !r.hasGclid);
  if (queueNoGclid.length) console.log('  UYARI: GCLID olmayan kuyruk satırı: ' + queueNoGclid.length);
  console.log('');

  // --- 2) Sinyaller: bugün+dün, GCLID + matematik değer
  const { data: signalRows, error: sErr } = await supabase
    .from('marketing_signals')
    .select('id, google_conversion_name, google_conversion_time, conversion_value, expected_value_cents, dispatch_status, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .gte('google_conversion_time', fromIso)
    .lt('google_conversion_time', toIso)
    .order('google_conversion_time', { ascending: true });

  if (sErr) {
    console.error('Sinyal hatası:', sErr.message);
    process.exit(1);
  }

  console.log('--- 2) SİNYALLER (V2/V3/V4) — GCLID + mevcut/değer düzeltmesi ---');
  const toUpdate = [];
  const ratios = {
    OpsMantik_V2_Ilk_Temas: ratioV2,
    OpsMantik_V3_Nitelikli_Gorusme: ratioV3,
    OpsMantik_V4_Sicak_Teklif: ratioV4,
  };
  (signalRows || []).forEach((r, i) => {
    const hasGclid = !!(r.gclid || r.wbraid || r.gbraid);
    const name = r.google_conversion_name || '';
    const ratio = ratios[name];
    const days = 0; // bugün/dün → decay 0.5
    const decay = ratio != null ? getDecay(days) : 0;
    const calculatedTry = ratio != null ? Math.round(aov * ratio * decay) : 0;
    const currentTry = r.conversion_value != null ? Number(r.conversion_value) : 0;
    const needsFix = calculatedTry > 0 && currentTry !== calculatedTry;
    if (needsFix) toUpdate.push({ id: r.id, name, currentTry, calculatedTry });
    console.log('  ' + (i + 1) + '. ' + name + ' | mevcut=' + currentTry + ' TRY → hesaplanan=' + calculatedTry + ' TRY' + (needsFix ? ' [DÜZELTİLECEK]' : '') + ' | GCLID=' + (hasGclid ? 'VAR' : 'YOK') + ' status=' + r.dispatch_status);
  });
  const signalNoGclid = (signalRows || []).filter((r) => !(r.gclid || r.wbraid || r.gbraid));
  if (signalNoGclid.length) console.log('  UYARI: GCLID olmayan sinyal: ' + signalNoGclid.length);
  console.log('');

  // --- 3) Değer güncellemesi (matematiğe göre)
  if (toUpdate.length > 0) {
    console.log('--- 3) Sinyal değerleri güncelleniyor (matematiğe göre) ---');
    for (const u of toUpdate) {
      const calculatedCents = u.calculatedTry * 100;
      if (!dryRun) {
        const { error: upErr } = await supabase
          .from('marketing_signals')
          .update({
            conversion_value: u.calculatedTry,
            expected_value_cents: calculatedCents,
          })
          .eq('id', u.id)
          .eq('site_id', siteId);
        if (upErr) {
          console.error('  UPDATE hatası', u.id, upErr.message);
        } else {
          console.log('  id=' + u.id.slice(0, 8) + '... ' + u.name + ' ' + u.currentTry + ' → ' + u.calculatedTry + ' TRY');
        }
      } else {
        console.log('  [--dry-run] id=' + u.id.slice(0, 8) + '... ' + u.name + ' ' + u.currentTry + ' → ' + u.calculatedTry + ' TRY');
      }
    }
    console.log('');
  }

  // --- 4) Kuyruğa al: V5 için enqueue (sealed call'lar); sinyaller zaten marketing_signals'da, export ile gider
  console.log('--- 4) Kuyruğa alma ---');
  console.log('  V5 (Demir Mühür): node scripts/db/oci-enqueue.mjs Eslamed --days 2');
  console.log('  V2/V3/V4: marketing_signals PENDING — Script export ile Google\'a gider (değerler yukarıda düzeltildi).');
  if (!dryRun) {
    const { execSync } = await import('child_process');
    try {
      execSync('node scripts/db/oci-enqueue.mjs Eslamed --days 2', {
        cwd: join(__dirname, '..', '..'),
        stdio: 'inherit',
      });
    } catch (e) {
      console.error('Enqueue çalıştırılamadı:', e.message);
    }
  } else {
    console.log('  [--dry-run] Enqueue çalıştırılmadı.');
  }
  console.log('\nBitti.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
