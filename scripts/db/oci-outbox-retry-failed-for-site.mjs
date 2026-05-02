#!/usr/bin/env node
/**
 * FAILED outbox satırlarını PENDING yapar (claim_outbox_events tekrar işlesin).
 *
 *   node scripts/db/oci-outbox-retry-failed-for-site.mjs Muratcan --dry-run
 *   node scripts/db/oci-outbox-retry-failed-for-site.mjs Muratcan --apply
 *
 * Deploy sonrası `process-outbox` düzeltmesiyle birlikte kullanın.
 * İşçi: `node scripts/trigger_outbox_processor.mjs`
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveSiteId } from './lib/resolve-site-id.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  const onlySendability = argv.includes('--only-sendability-failures');
  let siteQ = null;
  for (const a of argv) {
    if (a.startsWith('-')) continue;
    siteQ = a;
    break;
  }
  return { dryRun: dryRun || !apply, apply, onlySendability, siteQ: siteQ || 'muratcanaku' };
}

async function main() {
  const { dryRun, apply, onlySendability, siteQ } = parseArgs(process.argv.slice(2));
  const siteId = await resolveSiteId(supabase, siteQ);
  if (!siteId) {
    console.error('Site bulunamadı:', siteQ);
    process.exit(1);
  }

  const { data: site } = await supabase.from('sites').select('name, domain').eq('id', siteId).maybeSingle();
  console.log('Site:', site?.name, site?.domain, siteId);

  let q = supabase
    .from('outbox_events')
    .select('id, last_error, call_id, created_at', { count: 'exact' })
    .eq('site_id', siteId)
    .eq('status', 'FAILED');

  if (onlySendability) {
    q = q.in('last_error', ['CALL_NOT_SENDABLE_FOR_OCI', 'CALL_NOT_SENDABLE_FOR_OCI_SIGNAL']);
  }

  const { data: rows, error, count } = await q;
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.log('FAILED satır (seçilen filtre):', count ?? rows?.length ?? 0);
  if (rows?.length) {
    const sample = rows.slice(0, 15);
    for (const r of sample) {
      console.log(' ', r.id?.slice(0, 8), r.last_error, r.call_id?.slice?.(0, 8));
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: güncelleme yok. Uygulamak için --apply ekleyin.');
    return;
  }

  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) {
    console.log('Güncellenecek yok.');
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('outbox_events')
    .update({
      status: 'PENDING',
      last_error: null,
      processed_at: null,
      attempt_count: 0,
      updated_at: nowIso,
    })
    .in('id', ids);

  if (upErr) {
    console.error('Update hatası:', upErr.message);
    process.exit(1);
  }

  console.log('\nGüncellendi → PENDING:', ids.length);
  console.log('Sonraki: node scripts/trigger_outbox_processor.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
