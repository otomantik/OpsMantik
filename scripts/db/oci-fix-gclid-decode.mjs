#!/usr/bin/env node
/**
 * OCI: "İçe aktarılan GCLID'nin kodu çözülemedi" — Düzeltme
 *
 * Kuyruktaki gclid/wbraid/gbraid base64url (_ -) ise standart base64 (+ /) yapıp
 * satırı QUEUED'e alır; worker tekrar gönderir.
 *
 * Kullanım:
 *   node scripts/db/oci-fix-gclid-decode.mjs              # Tüm siteler, base64url içeren satırlar
 *   node scripts/db/oci-fix-gclid-decode.mjs Muratcan     # Sadece Muratcan
 *   node scripts/db/oci-fix-gclid-decode.mjs --dry-run    # Sadece listele, güncelleme yapma
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
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const siteArg = args.find((a) => !a.startsWith('-'));

/** base64url → standart base64 (Google'ın beklediği) */
function normalizeClickId(val) {
  if (val == null || typeof val !== 'string') return val;
  return val.trim().replace(/-/g, '+').replace(/_/g, '/');
}

/** Değer base64url içeriyor mu? (_ veya -) */
function needsNormalize(val) {
  if (val == null || typeof val !== 'string') return false;
  const t = val.trim();
  return t.length > 0 && (t.includes('_') || t.includes('-'));
}

async function resolveSite(q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hex32 = /^[0-9a-f]{32}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data || null;
  }
  if (hex32.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('public_id', q).maybeSingle();
    return data || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  return data?.[0] || null;
}

async function run() {
  let siteId = null;
  if (siteArg) {
    const site = await resolveSite(siteArg);
    if (!site) {
      console.error('Site bulunamadı:', siteArg);
      process.exit(1);
    }
    siteId = site.id;
    console.log('Site:', site.name, '(' + siteId + ')');
  } else {
    console.log('Tüm siteler (base64url içeren kuyruk satırları)');
  }

  // Kuyruk satırları: google_ads, (site varsa filtre); sonra JS'te base64url içerenleri seç
  let query = supabase
    .from('offline_conversion_queue')
    .select('id, site_id, call_id, status, gclid, wbraid, gbraid, last_error, retry_count')
    .eq('provider_key', 'google_ads');

  if (siteId) query = query.eq('site_id', siteId);

  const { data: rows, error } = await query;

  if (error) {
    console.error('Kuyruk okuma hatası:', error.message);
    process.exit(1);
  }

  const toFix = (rows || []).filter((r) => {
    return needsNormalize(r.gclid) || needsNormalize(r.wbraid) || needsNormalize(r.gbraid);
  });

  if (toFix.length === 0) {
    console.log('\nDüzeltilecek satır yok. Base64url (_ veya -) içeren GCLID/wbraid/gbraid bulunamadı.');
    console.log('Bu hata başka sebepten (süre aşımı, yanlış hesap vb.) olabilir.');
    process.exit(0);
  }

  console.log('\nBulunan satırlar (base64url → düzeltilecek):', toFix.length);
  toFix.forEach((r, i) => {
    console.log(
      `  ${i + 1}. id=${r.id?.slice(0, 8)}... call_id=${r.call_id?.slice(0, 8)}... status=${r.status} gclid=${r.gclid ? (needsNormalize(r.gclid) ? 'base64url' : 'ok') : '-'} wbraid=${r.wbraid ? (needsNormalize(r.wbraid) ? 'base64url' : 'ok') : '-'} gbraid=${r.gbraid ? (needsNormalize(r.gbraid) ? 'base64url' : 'ok') : '-'}`
    );
  });

  if (dryRun) {
    console.log('\n--dry-run: Güncelleme yapılmadı. Güncellemek için --dry-run olmadan çalıştır.');
    process.exit(0);
  }

  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
  let updated = 0;

  for (const row of toFix) {
    const updates = {
      status: 'QUEUED',
      next_retry_at: oneMinAgo,
      retry_count: 0,
      last_error: null,
      provider_error_code: null,
      provider_error_category: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    };
    const normalized = [];
    if (needsNormalize(row.gclid)) {
      updates.gclid = normalizeClickId(row.gclid);
      normalized.push('gclid');
    }
    if (needsNormalize(row.wbraid)) {
      updates.wbraid = normalizeClickId(row.wbraid);
      normalized.push('wbraid');
    }
    if (needsNormalize(row.gbraid)) {
      updates.gbraid = normalizeClickId(row.gbraid);
      normalized.push('gbraid');
    }

    const { error: upErr } = await supabase
      .from('offline_conversion_queue')
      .update(updates)
      .eq('id', row.id);

    if (upErr) {
      console.error('Güncelleme hatası', row.id, upErr.message);
      continue;
    }
    updated++;
    const which = normalized.length ? normalized.join(',') + ' → standart base64' : 'QUEUED';
    console.log('  Güncellendi:', row.id.slice(0, 8) + '...', which);
  }

  console.log('\nSonuç:', updated, 'satır düzeltildi ve QUEUED yapıldı. Worker/cron bir sonraki çalışmada Google\'a tekrar gönderecek.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
