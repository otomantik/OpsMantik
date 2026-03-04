#!/usr/bin/env node
/**
 * Kuyrukta value_cents <= 0 olan QUEUED/RETRY/PROCESSING satırlarını site default_aov ile güncelle.
 * Export API value_cents <= 0 satırları göndermediği için Script "işlenecek dönüşüm bulunamadı" diyor.
 *
 * Kullanım: node scripts/db/oci-fix-zero-value-queue.mjs
 *           node scripts/db/oci-fix-zero-value-queue.mjs --dry-run
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { majorToMinor } from '../lib/currency-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const dryRun = process.argv.includes('--dry-run');

async function run() {
  const { data: rows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, site_id, value_cents, currency')
    .in('status', ['QUEUED', 'RETRY', 'PROCESSING', 'FAILED'])
    .or('value_cents.lte.0,value_cents.is.null');

  if (error) {
    console.error('Kuyruk hatası:', error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log('value_cents <= 0 veya null olan QUEUED/RETRY/PROCESSING satır yok.');
    process.exit(0);
  }

  const siteIds = [...new Set(rows.map((r) => r.site_id).filter(Boolean))];
  const { data: sites } = await supabase.from('sites').select('id, default_aov, currency').in('id', siteIds);
  const siteMap = new Map((sites || []).map((s) => [s.id, { default_aov: s.default_aov, currency: s.currency || 'TRY' }]));

  const updates = [];
  for (const r of rows) {
    const site = siteMap.get(r.site_id);
    const defaultAov = site?.default_aov != null && Number(site.default_aov) > 0 ? Number(site.default_aov) : 500;
    const currency = (site?.currency || r.currency || 'TRY').trim().toUpperCase().replace(/[^A-Z]/g, '') || 'TRY';
    const valueCents = majorToMinor(defaultAov, currency);
    updates.push({ id: r.id, value_cents: valueCents });
  }

  console.log('value_cents <= 0 veya null satır:', rows.length);
  console.log('Güncellenecek value_cents: site default_aov (veya 500) -> cents');
  if (dryRun) {
    console.log('[DRY-RUN] UPDATE yapılmadı.');
    return;
  }

  let done = 0;
  for (const u of updates) {
    const { error: upErr } = await supabase
      .from('offline_conversion_queue')
      .update({ value_cents: u.value_cents, updated_at: new Date().toISOString() })
      .eq('id', u.id);
    if (!upErr) done++;
  }
  console.log('Güncellenen:', done);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
