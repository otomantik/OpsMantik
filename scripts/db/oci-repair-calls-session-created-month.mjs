#!/usr/bin/env node
/**
 * calls.session_created_month, get_call_session_for_oci içinde sessions ile
 * JOIN anahtarı; matched_at ayına göre yazılmış ama gerçek session başka ay
 * partition'ındaysa RPC tıklama kimliklerini NULL döndürür — OCI boşa düşer.
 *
 * Bu script matched_session_id üzerinden sessions.created_month ile hizalar.
 *
 *   node scripts/db/oci-repair-calls-session-created-month.mjs Muratcan --dry-run
 *   node scripts/db/oci-repair-calls-session-created-month.mjs Muratcan --apply
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
  let siteQ = null;
  for (const a of argv) {
    if (a.startsWith('-')) continue;
    siteQ = a;
    break;
  }
  return { dryRun: dryRun || !apply, apply, siteQ: siteQ || 'muratcanaku' };
}

/** @param {string} d */
function monthKey(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

async function main() {
  const { dryRun, siteQ } = parseArgs(process.argv.slice(2));
  const siteId = await resolveSiteId(supabase, siteQ);
  if (!siteId) {
    console.error('Site bulunamadı:', siteQ);
    process.exit(1);
  }

  const { data: calls, error: cErr } = await supabase
    .from('calls')
    .select('id, matched_session_id, session_created_month')
    .eq('site_id', siteId)
    .not('matched_session_id', 'is', null)
    .limit(5000);

  if (cErr) {
    const msg = cErr.message || '';
    if (/session_created_month/i.test(msg) && /does not exist|column/i.test(msg)) {
      console.log(
        'Atlandı: bu projede calls.session_created_month sütunu yok (RPC şeması farklı).',
        '\nOCI taraflı düzeltme zaten getPrimarySource batch/call-row fallback ile yapılıyor.'
      );
      process.exit(0);
    }
    console.error(msg);
    process.exit(1);
  }

  const sessionIds = [...new Set((calls || []).map((c) => c.matched_session_id).filter(Boolean))];
  if (sessionIds.length === 0) {
    console.log('Eşleşmiş session yok.');
    return;
  }

  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_month')
    .eq('site_id', siteId)
    .in('id', sessionIds);

  if (sErr) {
    console.error(sErr.message);
    process.exit(1);
  }

  /** @type {Map<string, string>} */
  const monthBySession = new Map();
  for (const s of sessions || []) {
    const m = monthKey(s.created_month);
    if (m) monthBySession.set(s.id, m);
  }

  const mismatches = (calls || []).filter((c) => {
    const sm = monthBySession.get(c.matched_session_id);
    if (!sm) return false;
    return monthKey(c.session_created_month) !== sm;
  });

  console.log('Site:', siteId);
  console.log('matched_session olan çağrı:', calls?.length ?? 0);
  console.log('session_created_month uyumsuz (düzelecek):', mismatches.length);

  const preview = mismatches.slice(0, 20);
  for (const c of preview) {
    const sm = monthBySession.get(c.matched_session_id);
    console.log(
      ' ',
      c.id?.slice(0, 8),
      'call_month=',
      monthKey(c.session_created_month),
      'session_month=',
      sm
    );
  }
  if (mismatches.length > 20) console.log(' ... ve', mismatches.length - 20, 'satır daha');

  if (dryRun) {
    console.log('\n--dry-run: güncelleme yok. Uygulamak için --apply');
    return;
  }

  let ok = 0;
  for (const c of mismatches) {
    const sm = monthBySession.get(c.matched_session_id);
    if (!sm) continue;
    const { error: uErr } = await supabase
      .from('calls')
      .update({ session_created_month: sm, updated_at: new Date().toISOString() })
      .eq('id', c.id)
      .eq('site_id', siteId);
    if (uErr) {
      console.error('update fail', c.id?.slice(0, 8), uErr.message);
      continue;
    }
    ok++;
  }
  console.log('\nGüncellenen çağrı:', ok, '/', mismatches.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
