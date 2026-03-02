#!/usr/bin/env node
/**
 * Enable ingest_strict_mode for a site (Ghost Geo + Traffic Debloat + 10s session reuse).
 * Usage:
 *   node scripts/db/enable-ingest-strict-mode.mjs Muratcan
 *   node scripts/db/enable-ingest-strict-mode.mjs 28cf0aefaa074f5bb29e818a9d53b488
 *   node scripts/db/enable-ingest-strict-mode.mjs <site-uuid>
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
const query = process.argv[2];
if (!query) {
  console.error('Kullanim: node scripts/db/enable-ingest-strict-mode.mjs <Muratcan|public_id|uuid>');
  process.exit(1);
}

async function resolveSite(q) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(q.trim())) {
    const { data, error } = await supabase.from('sites').select('id, public_id, name, config').eq('id', q.trim()).maybeSingle();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('sites')
    .select('id, public_id, name, config')
    .or(`public_id.eq.${q.trim()},name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function run() {
  const site = await resolveSite(query);
  if (!site) {
    console.error('Site bulunamadi:', query);
    process.exit(1);
  }
  const siteId = site.id;
  const mergedConfig = { ...(site.config || {}), ingest_strict_mode: true };
  const { error } = await supabase.from('sites').update({ config: mergedConfig }).eq('id', siteId);
  if (error) {
    console.error('UPDATE hatasi:', error.message);
    process.exit(1);
  }
  console.log('OK — ingest_strict_mode acildi.');
  console.log('  site_id (UUID):', siteId);
  console.log('  public_id:', site.public_id || '(yok)');
  console.log('  name:', site.name || '(yok)');
  console.log('  config.ingest_strict_mode:', true);
}

run();
