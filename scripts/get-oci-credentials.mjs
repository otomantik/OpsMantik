#!/usr/bin/env node
/**
 * OpsMantik OCI credentials çek — Supabase'den al, script'e yaz.
 * Env/Script Properties olmadan script içine SITE_ID ve API_KEY yazılır.
 *
 * Kullanım:
 *   node scripts/get-oci-credentials.mjs Eslamed
 *   node scripts/get-oci-credentials.mjs Eslamed --write   # Eslamed-OCI-Quantum.js güncelle
 *   node scripts/get-oci-credentials.mjs Muratcan
 *   node scripts/get-oci-credentials.mjs muratcanaku.com
 *   node scripts/get-oci-credentials.mjs  # tüm siteler listesi
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const writeFlag = args.includes('--write') || args.includes('-w');
const query = args.find((a) => !a.startsWith('-'));

let data, error;
if (query) {
  const { data: rows, error: err } = await supabase
    .from('sites')
    .select('id, public_id, oci_api_key, name, domain')
    .or(`name.ilike.%${query}%,domain.ilike.%${query}%`);
  data = rows;
  error = err;
} else {
  const { data: rows, error: err } = await supabase
    .from('sites')
    .select('id, public_id, oci_api_key, name, domain')
    .order('name', { ascending: true });
  data = rows;
  error = err;
}

if (error) {
  console.error('Supabase hatasi:', error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  if (query) {
    console.error(`Site bulunamadi: "${query}"`);
    console.error('Ornek: node scripts/get-oci-credentials.mjs Eslamed');
  }
  process.exit(1);
}

const site = data[0];
const slug = (site.name || site.domain || 'site').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
const siteId = (site.public_id || '').trim();
const apiKey = (site.oci_api_key || '').trim();

if (!siteId || !apiKey) {
  console.error('Uyari: public_id veya oci_api_key bos olabilir.');
}

console.log('--- JSON ---');
console.log(JSON.stringify({ name: site.name, domain: site.domain, public_id: siteId, oci_api_key: apiKey }, null, 2));

console.log('\n--- Script\'e yapistir (SITE_ID ve API_KEY satirlari) ---');
console.log(`var ${slug.toUpperCase()}_SITE_ID = '${siteId}';   // ${site.name || site.domain}`);
console.log(`var ${slug.toUpperCase()}_API_KEY = '${apiKey}';   // OCI API key`);

if (writeFlag) {
  const scriptPath = join(__dirname, 'google-ads-oci', 'Eslamed-OCI-Quantum.js');
  try {
    let content = readFileSync(scriptPath, 'utf8');
    content = content.replace(
      /var ESLAMED_SITE_ID = '[^']*'/,
      `var ESLAMED_SITE_ID = '${siteId.replace(/'/g, "\\'")}'`
    );
    content = content.replace(
      /var ESLAMED_API_KEY = '[^']*'/,
      `var ESLAMED_API_KEY = '${apiKey.replace(/'/g, "\\'")}'`
    );
    writeFileSync(scriptPath, content);
    console.log('\n--- Guncellendi: scripts/google-ads-oci/Eslamed-OCI-Quantum.js ---');
  } catch (e) {
    console.error('Yazma hatasi:', e.message);
    process.exit(1);
  }
}
