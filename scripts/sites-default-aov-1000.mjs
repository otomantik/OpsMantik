#!/usr/bin/env node
/**
 * Tüm sitelerde default_aov = 1000 yap.
 * V2/V3/V4 (marketing_signals) hesaplaması için kullanılır.
 *
 * Usage:
 *   node scripts/sites-default-aov-1000.mjs           # Önce mevcut durum, sonra güncelle
 *   DRY_RUN=1 node scripts/sites-default-aov-1000.mjs # Sadece rapor, güncelleme yok
 *
 * Env: .env.local → NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Eksik: NEXT_PUBLIC_SUPABASE_URL ve/veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('📋 sites.default_aov mevcut durum\n');

  const { data: sites, error: selErr } = await supabase
    .from('sites')
    .select('id, public_id, name, default_aov, oci_config');

  if (selErr) {
    console.error('❌ sites okuma hatası:', selErr.message);
    process.exit(1);
  }

  if (!sites?.length) {
    console.log('Hiç site yok.');
    return;
  }

  const MURATCAN_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

  for (const s of sites) {
    const aov = s.default_aov != null ? Number(s.default_aov) : null;
    const ociBase = s.oci_config && typeof s.oci_config === 'object' && s.oci_config.base_value != null
      ? Number(s.oci_config.base_value) : null;
    const mark = s.id === MURATCAN_ID ? ' ← Muratcan Akü' : '';
    console.log(
      `  ${s.public_id || s.id} | default_aov: ${aov ?? 'null'} | oci base: ${ociBase ?? 'null'}${mark}`
    );
  }

  const toUpdate = sites.filter((s) => {
    const aov = s.default_aov != null ? Number(s.default_aov) : null;
    return aov !== 1000;
  });

  if (toUpdate.length === 0) {
    console.log('\n✅ Tüm siteler zaten default_aov = 1000.');
    return;
  }

  console.log(`\n🔄 Güncellenecek: ${toUpdate.length} site (default_aov → 1000)`);

  if (DRY_RUN) {
    console.log('   [DRY_RUN] Güncelleme yapılmadı.');
    return;
  }

  const { error: updErr } = await supabase
    .from('sites')
    .update({ default_aov: 1000 })
    .in('id', toUpdate.map((s) => s.id));

  if (updErr) {
    console.error('❌ Güncelleme hatası:', updErr.message);
    process.exit(1);
  }

  console.log('✅ Tamamlandı.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
