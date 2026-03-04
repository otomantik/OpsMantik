#!/usr/bin/env node
/**
 * Muratcan AKÜ — Dün ve bugün tüm dönüşüm durumu analizi.
 * - FAILED/RETRY nedenleri (glic/gclid uyumsuzluğu dahil)
 * - GCLID format doğrulama (base64 vs base64url, Google uyumu)
 * - Gidecek liste (kuyruğa alınmış, gönderilebilecek kayıtlar)
 * - GCLID raporu (format uygunluğu tablosu)
 *
 * Kullanım: node scripts/db/oci-muratcan-donusum-analiz.mjs
 *           node scripts/db/oci-muratcan-donusum-analiz.mjs --json              # JSON stdout
 *           node scripts/db/oci-muratcan-donusum-analiz.mjs --json --out=rapor.json  # Dosyaya yaz
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
const MURATCAN_SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

/** Google Ads conversion_time regex: yyyy-mm-dd hh:mm:ss±hhmm (kolonsuz) */
const GOOGLE_ADS_TIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{4}$/;

/** Standart base64 karakter seti (Google'ın beklediği). */
const BASE64_REGEX = /^[A-Za-z0-9+/]+=*$/;

function normalizeClickIdForGoogle(val) {
  if (val == null || typeof val !== 'string') return '';
  return val.trim().replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * GCLID/wbraid/gbraid format analizi.
 * @returns { status: 'ok'|'base64url'|'invalid'|'empty', normalized?, raw?, message }
 */
function analyzeClickId(raw, fieldName = 'click_id') {
  if (raw == null || String(raw).trim() === '') {
    return { status: 'empty', raw: '', normalized: '', message: 'Boş' };
  }
  const rawStr = String(raw).trim();
  const hasBase64Url = rawStr.includes('_') || rawStr.includes('-');
  const normalized = normalizeClickIdForGoogle(rawStr);

  if (normalized.length === 0) {
    return { status: 'empty', raw: rawStr, normalized: '', message: 'Trim sonrası boş' };
  }

  if (hasBase64Url) {
    const validAfterNorm = BASE64_REGEX.test(normalized) && normalized.length >= 10;
    return {
      status: 'base64url',
      raw: rawStr,
      normalized,
      message: validAfterNorm
        ? 'Base64url (_/-) — normalize edilince Google\'a uygun'
        : 'Base64url ama normalize sonrası geçersiz karakter/length',
    };
  }

  if (!BASE64_REGEX.test(rawStr)) {
    return {
      status: 'invalid',
      raw: rawStr,
      normalized,
      message: 'Geçersiz karakter (sadece A-Za-z0-9+/= olmalı)',
    };
  }

  if (rawStr.length < 10) {
    return {
      status: 'invalid',
      raw: rawStr,
      normalized: rawStr,
      message: 'Çok kısa (GCLID genelde ~20+ karakter)',
    };
  }

  return {
    status: 'ok',
    raw: rawStr,
    normalized,
    message: 'Format uygun (standart base64)',
  };
}

/**
 * conversion_time format kontrolü.
 * DB'de ISO veya "yyyy-mm-dd hh:mm:ss+03:00" gelebilir; Google +0300 (kolonsuz) ister.
 */
function analyzeConversionTime(convTime) {
  if (convTime == null || String(convTime).trim() === '') {
    return { status: 'empty', message: 'conversion_time boş' };
  }
  const s = String(convTime).trim();
  if (GOOGLE_ADS_TIME_REGEX.test(s)) {
    return { status: 'ok', message: 'Google formatında (+hhmm kolonsuz)' };
  }
  if (s.includes('+03:00') || s.includes('-03:00') || /[+-]\d{2}:\d{2}$/.test(s)) {
    return { status: 'colon', message: 'Offset kolonlu (+03:00) — CSV/script için +0300 olmalı' };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    return { status: 'iso', message: 'ISO format — export sırasında site timezone ile +0300\'e çevrilir' };
  }
  return { status: 'unknown', message: 'Bilinmeyen format' };
}

function getDateRanges() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  return { today: today, yesterday: yesterdayStr, since: yesterdayStr };
}

async function run() {
  const jsonOut = process.argv.includes('--json');
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outFile = outArg ? outArg.slice('--out='.length).trim() : null;
  const { today, yesterday, since } = getDateRanges();

  // Dün ve bugün: kuyruk satırları (created_at veya updated_at bu iki günde)
  const sinceTs = `${since}T00:00:00.000Z`;
  const { data: queueRows, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .select(
      'id, call_id, status, conversion_time, value_cents, currency, gclid, wbraid, gbraid, ' +
        'last_error, provider_error_code, provider_error_category, retry_count, next_retry_at, ' +
        'created_at, updated_at, uploaded_at'
    )
    .eq('site_id', MURATCAN_SITE_ID)
    .eq('provider_key', 'google_ads')
    .or(`created_at.gte.${sinceTs},updated_at.gte.${sinceTs}`)
    .order('updated_at', { ascending: false });

  if (qErr) {
    console.error('Kuyruk hatası:', qErr.message);
    process.exit(1);
  }

  const rows = queueRows || [];
  const callIds = [...new Set(rows.map((r) => r.call_id).filter(Boolean))];

  let callConfirmedAt = {};
  if (callIds.length > 0) {
    const { data: calls } = await supabase
      .from('calls')
      .select('id, confirmed_at, matched_at, status, oci_status')
      .in('id', callIds);
    callConfirmedAt = Object.fromEntries((calls || []).map((c) => [c.id, c.confirmed_at || c.matched_at]));
  }

  // --- Özet ---
  const byStatus = {};
  const byDayCreated = { [yesterday]: 0, [today]: 0 };
  const failedReasons = {};
  const errorCodes = {};

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const createdDay = r.created_at?.slice(0, 10);
    if (createdDay === yesterday || createdDay === today) byDayCreated[createdDay] = (byDayCreated[createdDay] || 0) + 1;
    if (r.status === 'FAILED' || r.status === 'RETRY') {
      const key = (r.last_error || '').slice(0, 120) || '(boş)';
      failedReasons[key] = (failedReasons[key] || 0) + 1;
      const code = r.provider_error_code || 'NO_CODE';
      errorCodes[code] = (errorCodes[code] || 0) + 1;
    }
  }

  // --- GCLID raporu (her satır) ---
  const gclidReport = [];
  const gidecekListe = [];
  const nowIso = new Date().toISOString();

  for (const r of rows) {
    const gclidAnalysis = analyzeClickId(r.gclid, 'gclid');
    const wbraidAnalysis = analyzeClickId(r.wbraid, 'wbraid');
    const gbraidAnalysis = analyzeClickId(r.gbraid, 'gbraid');
    const convTimeAnalysis = analyzeConversionTime(r.conversion_time);

    const hasAnyClickId = gclidAnalysis.status !== 'empty' || wbraidAnalysis.status !== 'empty' || gbraidAnalysis.status !== 'empty';
    const hasGclid = gclidAnalysis.status !== 'empty';
    const clickIdOk = gclidAnalysis.status === 'ok' || (gclidAnalysis.status === 'base64url' && gclidAnalysis.normalized.length >= 10) ||
      wbraidAnalysis.status === 'ok' || gbraidAnalysis.status === 'ok';
    const eligible = (r.status === 'QUEUED' || (r.status === 'RETRY' && (!r.next_retry_at || r.next_retry_at <= nowIso)));
    const formatOk = clickIdOk && convTimeAnalysis.status !== 'empty';
    const failedCanRetry = r.status === 'FAILED' || r.status === 'RETRY';

    gclidReport.push({
      queue_id: r.id,
      call_id: r.call_id ?? null,
      status: r.status,
      conversion_time: r.conversion_time ?? null,
      conv_time_format: convTimeAnalysis.status,
      gclid_status: gclidAnalysis.status,
      gclid_message: gclidAnalysis.message,
      wbraid_status: wbraidAnalysis.status,
      wbraid_message: wbraidAnalysis.message,
      gbraid_status: gbraidAnalysis.status,
      gbraid_message: gbraidAnalysis.message,
      has_gclid: hasGclid,
      value_cents: r.value_cents,
      last_error: r.last_error ? r.last_error.slice(0, 200) : null,
      provider_error_code: r.provider_error_code ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      gidebilir: eligible && formatOk,
      gidebilir_engel: !hasAnyClickId ? 'click_id_yok' : !clickIdOk ? 'gclid_format_uyumsuz' : !eligible ? 'kuyruk_beklemede' : convTimeAnalysis.status === 'empty' ? 'conversion_time_yok' : null,
      queued_yapilirsa_gidebilir: failedCanRetry && formatOk,
    });

    if (eligible || (failedCanRetry && formatOk)) {
      gidecekListe.push({
        queue_id: r.id,
        call_id: r.call_id ?? null,
        status: r.status,
        format_ok: formatOk,
        gclid_ok: gclidAnalysis.status === 'ok' || gclidAnalysis.status === 'base64url',
        has_gclid: hasGclid,
        conversion_time_ok: convTimeAnalysis.status === 'ok' || convTimeAnalysis.status === 'iso',
        value_cents: r.value_cents,
        last_error: r.last_error ? r.last_error.slice(0, 100) : null,
        eligible_simdi: eligible,
        queued_yapilirsa_gider: failedCanRetry && formatOk && !eligible,
      });
    }
  }

  const report = {
    site_id: MURATCAN_SITE_ID,
    site_name: 'Muratcan AKÜ',
    period: { yesterday, today, since },
    generated_at: new Date().toISOString(),
    ozet: {
      toplam_kuyruk_satiri: rows.length,
      dun_olusturulan: byDayCreated[yesterday] ?? 0,
      bugun_olusturulan: byDayCreated[today] ?? 0,
      status_dagilimi: byStatus,
      failed_retry_toplam: (byStatus.FAILED || 0) + (byStatus.RETRY || 0),
      hata_kodlari: errorCodes,
      hata_mesajlari_ozet: failedReasons,
    },
    gidecek_liste: {
      aciklama: 'Gönderilebilecek veya QUEUED yapılırsa gönderilebilecek satırlar',
      toplam: gidecekListe.length,
      simdi_eligible: gidecekListe.filter((x) => x.eligible_simdi).length,
      queued_yapilirsa_gider: gidecekListe.filter((x) => x.queued_yapilirsa_gider).length,
      format_ok_olan: gidecekListe.filter((x) => x.format_ok).length,
      format_uyumsuz_olan: gidecekListe.filter((x) => !x.format_ok).length,
      satirlar: gidecekListe,
    },
    gclid_raporu: {
      aciklama: 'Tüm kuyruk satırları için GCLID/wbraid/gbraid format durumu',
      toplam: gclidReport.length,
      gclid_dolu: gclidReport.filter((x) => x.has_gclid).length,
      gclid_bos_sadece_wbraid_gbraid: gclidReport.filter((x) => !x.has_gclid && (x.wbraid_status !== 'empty' || x.gbraid_status !== 'empty')).length,
      format_ok: gclidReport.filter((x) => x.gclid_status === 'ok' || x.wbraid_status === 'ok' || x.gbraid_status === 'ok').length,
      base64url_normalize_gerekli: gclidReport.filter((x) => x.gclid_status === 'base64url' || x.wbraid_status === 'base64url' || x.gbraid_status === 'base64url').length,
      conv_time_colon: gclidReport.filter((x) => x.conv_time_format === 'colon').length,
      gidebilir_isaretli: gclidReport.filter((x) => x.gidebilir).length,
      queued_yapilirsa_gidebilir: gclidReport.filter((x) => x.queued_yapilirsa_gidebilir).length,
      satirlar: gclidReport,
    },
  };

  if (jsonOut) {
    const str = JSON.stringify(report, null, 2);
    if (outFile) {
      const fs = await import('fs');
      fs.writeFileSync(outFile, str, 'utf8');
      console.error('Rapor yazıldı:', outFile);
    } else {
      console.log(str);
    }
    return;
  }

  // --- Konsol çıktısı ---
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan AKÜ — Dönüşüm Durumu Analizi (Dün + Bugün)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Tarih aralığı:', since, '~', today);
  console.log('Üretim zamanı:', report.generated_at);
  console.log('');

  console.log('--- ÖZET ---');
  console.log('Toplam kuyruk satırı (dün/bugün oluşturulan veya güncellenen):', report.ozet.toplam_kuyruk_satiri);
  console.log('  Dün oluşturulan:', report.ozet.dun_olusturulan, '| Bugün oluşturulan:', report.ozet.bugun_olusturulan);
  console.log('Status dağılımı:', report.ozet.status_dagilimi);
  console.log('FAILED + RETRY toplam:', report.ozet.failed_retry_toplam);
  if (Object.keys(report.ozet.hata_kodlari).length > 0) {
    console.log('Hata kodları:', report.ozet.hata_kodlari);
  }
  if (Object.keys(report.ozet.hata_mesajlari_ozet).length > 0) {
    console.log('Hata mesajları (özet):');
    for (const [msg, count] of Object.entries(report.ozet.hata_mesajlari_ozet)) {
      console.log('  ', count, '×', msg.slice(0, 80) + (msg.length > 80 ? '...' : ''));
    }
  }
  console.log('');

  console.log('--- GİDECEK LİSTE ---');
  console.log('(Şu an QUEUED/RETRY eligible veya FAILED olup QUEUED yapılırsa format uygun olanlar gidebilir)');
  console.log('Toplam listede:', report.gidecek_liste.toplam);
  console.log('Şu an eligible (hemen gidebilir):', report.gidecek_liste.simdi_eligible);
  console.log('QUEUED yapılırsa gider (format OK):', report.gidecek_liste.queued_yapilirsa_gider);
  console.log('Format uygun:', report.gidecek_liste.format_ok_olan);
  console.log('Format uyumsuz:', report.gidecek_liste.format_uyumsuz_olan);
  if (report.gidecek_liste.satirlar.length > 0) {
    console.table(
      report.gidecek_liste.satirlar.map((s) => ({
        queue_id: s.queue_id?.slice(0, 8) + '...',
        status: s.status,
        format_ok: s.format_ok ? 'evet' : 'hayır',
        eligible_simdi: s.eligible_simdi ? 'evet' : '-',
        queued_yapilirsa: s.queued_yapilirsa_gider ? 'evet' : '-',
        value_cents: s.value_cents,
      }))
    );
  }
  console.log('');

  console.log('--- GCLID RAPORU (Format Uygunluk) ---');
  console.log('Toplam satır:', report.gclid_raporu.toplam);
  console.log('GCLID dolu:', report.gclid_raporu.gclid_dolu);
  console.log('GCLID boş (sadece wbraid/gbraid):', report.gclid_raporu.gclid_bos_sadece_wbraid_gbraid, '(Google bazen sadece gclid kabul eder)');
  console.log('Format uygun (standart base64):', report.gclid_raporu.format_ok);
  console.log('Base64url (normalize gerekli):', report.gclid_raporu.base64url_normalize_gerekli);
  console.log('conversion_time kolonlu (+03:00):', report.gclid_raporu.conv_time_colon, '(Export +0300 üretmeli)');
  console.log('Gidebilir (eligible + format OK):', report.gclid_raporu.gidebilir_isaretli);
  console.log('QUEUED yapılırsa gidebilir:', report.gclid_raporu.queued_yapilirsa_gidebilir);
  console.log('');
  for (const s of report.gclid_raporu.satirlar) {
    console.log(`[${s.queue_id?.slice(0, 8)}...] status=${s.status} conv_time=${s.conv_time_format} gclid=${s.gclid_status} wbraid=${s.wbraid_status} gbraid=${s.gbraid_status} | ${s.gclid_message}`);
    if (!s.has_gclid && (s.wbraid_status !== 'empty' || s.gbraid_status !== 'empty')) console.log('  → GCLID yok, sadece wbraid/gbraid var');
    if (s.last_error) console.log('  last_error:', s.last_error.slice(0, 100));
    if (s.gidebilir_engel) console.log('  gidebilir_engel:', s.gidebilir_engel);
  }
  console.log('');

  console.log('--- ÖNERİLER ---');
  if (report.ozet.failed_retry_toplam > 0) {
    if (report.ozet.hata_kodlari['INVALID_CLICK_ID_FORMAT'] || report.ozet.hata_kodlari['UNPARSEABLE_GCLID']) {
      console.log('• GCLID format hatası var. Base64url ise: node scripts/db/oci-fix-gclid-decode.mjs Muratcan');
      console.log('• Hem gclid hem gbraid/wbraid olan satırlar: node scripts/db/oci-muratcan-only-gclid.mjs');
    }
    if (report.ozet.hata_mesajlari_ozet && Object.keys(report.ozet.hata_mesajlari_ozet).some((k) => k.includes('Conversion time') || k.includes('conversion_time') || k.includes('+03:00'))) {
      console.log('• Conversion time format (+03:00): Backend formatGoogleAdsTimeOrNull kolonsuz üretiyor; export/script tarafında +0300 kullanıldığından emin ol.');
    }
    console.log('• FAILED/RETRY satırları tekrar kuyruğa almak için: docs/runbooks/oci_muratcan_bugun_tum_durum.sql blok 8 (QUEUED yap) veya worker/cron çalıştır.');
  }
  if (report.gidecek_liste.format_uyumsuz_olan > 0) {
    console.log('• Gidecek listede format uyumsuz kayıt var; düzeltilmeden Google kabul etmeyebilir.');
  }
  if (report.gidecek_liste.toplam_eligible === 0 && report.ozet.toplam_kuyruk_satiri > 0) {
    console.log('• Tüm satırlar COMPLETED veya FAILED/RETRY (next_retry_at ileri tarih). Worker veya script ile tekrar denenecek.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
