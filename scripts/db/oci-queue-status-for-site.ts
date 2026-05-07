/**
 * Bir site için OCI queue-only özet:
 * offline_conversion_queue üzerinde canonical action + status dağılımı.
 *
 * Usage:
 *   npx tsx scripts/db/oci-queue-status-for-site.ts Tecrubeli
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

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

const QUEUE_STATUSES = [
  'QUEUED',
  'RETRY',
  'PROCESSING',
  'UPLOADED',
  'COMPLETED',
  'COMPLETED_UNVERIFIED',
  'FAILED',
  'DEAD_LETTER_QUARANTINE',
  'VOIDED_BY_REVERSAL',
  'BLOCKED_PRECEDING_SIGNALS',
] as const;

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

  for (const [label, action] of names) {
    const parts: string[] = [];
    let sum = 0;
    for (const status of QUEUE_STATUSES) {
      const { count, error } = await supabase
        .from('offline_conversion_queue')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', site.id)
        .eq('action', action)
        .eq('status', status);
      if (error) throw new Error(error.message);
      const c = count ?? 0;
      if (c > 0) parts.push(`${status}=${c}`);
      sum += c;
    }
    console.log(`${label} (${action}): toplam=${sum}`, parts.length ? `| ${parts.join(' ')}` : '| (satır yok)');
  }

  console.log('\noffline_conversion_queue (genel status):');
  for (const st of QUEUE_STATUSES) {
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
  console.log('\nNot: Queue-only model aktif; Google Script GET export = offline_conversion_queue.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
