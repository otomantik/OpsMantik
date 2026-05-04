/**
 * Bir site için OCI “kuyruk” özeti: marketing_signals (Contacted/Offered/Junk/Won)
 * dispatch_status dağılımı + offline_conversion_queue sayıları.
 *
 * Usage:
 *   npx tsx scripts/db/oci-queue-status-for-site.ts Tecrubeli
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';

config({ path: join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik env');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const positional = args.find((a) => !a.startsWith('-'));

function safeIlikeToken(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/%/g, '').replace(/_/g, '').trim();
}

async function resolveSite(q: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!q) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data ? { id: data.id, name: data.name } : null;
  }
  const token = safeIlikeToken(q);
  if (!token) return null;
  const { data: rows } = await supabase
    .from('sites')
    .select('id, name')
    .or(`name.ilike.%${token}%,domain.ilike.%${token}%`)
    .limit(25);
  if (!rows?.length) return null;
  if (rows.length === 1) return { id: rows[0].id, name: rows[0].name };
  const tecBak = rows.filter((r) => {
    const n = (r.name ?? '').toLowerCase();
    return n.includes('tecr') && n.includes('bak');
  });
  if (tecBak.length === 1) return { id: tecBak[0].id, name: tecBak[0].name };
  console.error(rows.map((r) => `${r.id} ${r.name}`).join('\n'));
  process.exit(1);
}

/** DB check constraint ile uyumlu (ek migrasyonlar varsa buraya eklenir). */
const DISPATCH = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'JUNK_ABORTED',
  'DEAD_LETTER_QUARANTINE',
  'SKIPPED_NO_CLICK_ID',
  'STALLED_FOR_HUMAN_AUDIT',
] as const;

async function countMs(siteId: string, conversionName: string, dispatch: string): Promise<number> {
  const { count, error } = await supabase
    .from('marketing_signals')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('google_conversion_name', conversionName)
    .eq('dispatch_status', dispatch);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function main() {
  const site = await resolveSite(positional);
  if (!site) {
    console.error('Site yok:', positional);
    process.exit(1);
  }
  console.log('Site:', site.name, site.id, '\n');

  const names = [
    ['Contacted', OPSMANTIK_CONVERSION_NAMES.contacted],
    ['Offered', OPSMANTIK_CONVERSION_NAMES.offered],
    ['Junk', OPSMANTIK_CONVERSION_NAMES.junk],
    ['Won', OPSMANTIK_CONVERSION_NAMES.won],
  ] as const;

  for (const [label, conv] of names) {
    const parts: string[] = [];
    let sum = 0;
    for (const d of DISPATCH) {
      const c = await countMs(site.id, conv, d);
      if (c > 0) parts.push(`${d}=${c}`);
      sum += c;
    }
    console.log(`${label} (${conv}): toplam=${sum}`, parts.length ? `| ${parts.join(' ')}` : '| (satır yok)');
  }

  const queueStatuses = ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'FAILED'] as const;
  console.log('\noffline_conversion_queue (Won hattı):');
  for (const st of queueStatuses) {
    const { count } = await supabase
      .from('offline_conversion_queue')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .eq('status', st);
    if ((count ?? 0) > 0) console.log(`  ${st}: ${count}`);
  }
  const { count: qtot } = await supabase
    .from('offline_conversion_queue')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site.id);
  console.log('  TOPLAM satır:', qtot ?? 0);

  const { count: obPend } = await supabase
    .from('outbox_events')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site.id)
    .eq('status', 'PENDING');
  console.log('\noutbox_events PENDING (panel→OCI işlenmemiş):', obPend ?? 0);
  console.log(
    '\nNot: Contacted/Offered/Junk için “kuyruk” = marketing_signals (çoğunlukla PENDING→SENT); Won = offline_conversion_queue.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
