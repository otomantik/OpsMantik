#!/usr/bin/env node
/**
 * Muratcan — Export önizleme: Script'e gidecek satır sayısı ve dönüşüm adları.
 * Gerçek export API'yi çağırır (markAsExported=false, kuyruk claim edilmez).
 *
 * Kullanım: node scripts/db/oci-muratcan-export-onizleme.mjs
 *
 * Gereksinim: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, Muratcan oci_api_key (DB'den okunur).
 *             Canlı export için BASE_URL (varsayılan https://console.opsmantik.com).
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.OCI_EXPORT_BASE_URL || 'https://console.opsmantik.com';

if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const MURATCAN_SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Muratcan — Export önizleme (Script\'e gidecek liste)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data: siteRow, error: siteErr } = await supabase
    .from('sites')
    .select('id, public_id, oci_api_key')
    .eq('id', MURATCAN_SITE_ID)
    .maybeSingle();

  if (siteErr || !siteRow?.public_id || !siteRow?.oci_api_key) {
    console.error('Muratcan site veya oci_api_key bulunamadı.');
    process.exit(1);
  }

  const publicId = siteRow.public_id;
  const apiKey = siteRow.oci_api_key;

  // 1) Verify handshake → session_token
  let sessionToken = '';
  try {
    const verifyRes = await fetch(`${BASE_URL}/api/oci/v2/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ siteId: publicId }),
    });
    if (!verifyRes.ok) {
      const t = await verifyRes.text();
      console.error('Verify hatası:', verifyRes.status, t);
      process.exit(1);
    }
    const verifyData = await verifyRes.json();
    sessionToken = verifyData.session_token || '';
  } catch (e) {
    console.error('Verify istek hatası:', e.message);
    process.exit(1);
  }

  if (!sessionToken) {
    console.error('session_token alınamadı.');
    process.exit(1);
  }

  // 2) Export (markAsExported=false → kuyruk claim edilmez, sadece önizleme)
  let items = [];
  try {
    const exportRes = await fetch(
      `${BASE_URL}/api/oci/google-ads-export?siteId=${encodeURIComponent(publicId)}&markAsExported=false`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${sessionToken}` },
      }
    );
    if (!exportRes.ok) {
      const t = await exportRes.text();
      console.error('Export hatası:', exportRes.status, t);
      process.exit(1);
    }
    const data = await exportRes.json();
    if (Array.isArray(data)) {
      items = data;
    } else if (data?.items && Array.isArray(data.items)) {
      items = data.items;
    }
  } catch (e) {
    console.error('Export istek hatası:', e.message);
    process.exit(1);
  }

  const byName = {};
  items.forEach((it) => {
    const name = it.conversionName || '?';
    byName[name] = (byName[name] || 0) + 1;
  });

  console.log('--- Gönderilecek toplam (önizleme) ---');
  console.log('  Toplam satır:', items.length);
  console.log('  Dönüşüm adına göre:', JSON.stringify(byName, null, 2));
  console.log('');
  if (items.length > 0) {
    console.log('  İlk 5:');
    items.slice(0, 5).forEach((it, i) => {
      console.log('    ' + (i + 1) + '. ' + (it.conversionName || '?') + ' | ' + (it.conversionValue ?? '') + ' ' + (it.conversionCurrency || 'TRY') + ' | ' + (it.conversionTime || '').slice(0, 19));
    });
  }
  console.log('');
  console.log('  Not: markAsExported=false kullanıldı; kuyruk claim edilmedi. Script gerçek çalışmada markAsExported=true ile çağırır.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
