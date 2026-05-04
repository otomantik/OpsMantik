/**
 * Bir sitedeki `calls` satırlarını status’a göre listeler (varsayılan: status = intent).
 * Tecrübeli gibi yerlerde intent süresi kısaysa kayıtlar çoğunlukla `contacted` / `offered` olur — o zaman:
 *   --status=contacted --limit=200
 *
 * Usage:
 *   npx tsx scripts/db/list-intents-for-site.ts Tecrubeli
 *   npx tsx scripts/db/list-intents-for-site.ts Tecrubeli --open-only
 *   npx tsx scripts/db/list-intents-for-site.ts Tecrubeli --status=contacted --limit=100
 *
 * Requires .env.local (SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL).
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const openOnly = args.includes('--open-only');
const positional = args.find((a) => !a.startsWith('-'));
const statusArg = args.find((a) => a.startsWith('--status='));
const statusFilter = (statusArg?.split('=')[1] ?? 'intent').trim().toLowerCase() || 'intent';
const limitArg = args.find((a) => a.startsWith('--limit='));
const maxRows = Math.min(5000, Math.max(1, parseInt(limitArg?.split('=')[1] ?? '2000', 10) || 2000));

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
  console.error('Birden fazla site; UUID kullanın:\n', rows.map((r) => `${r.id} ${r.name}`).join('\n'));
  process.exit(1);
}

const PAGE = Math.min(500, maxRows);

async function main() {
  const site = await resolveSite(positional);
  if (!site) {
    console.error('Site bulunamadı:', positional);
    process.exit(1);
  }

  console.log('Site:', site.name, site.id);
  console.log(
    'Filtre: status=',
    statusFilter,
    openOnly ? '| merged_into_call_id IS NULL (açık kart)' : '| merge dahil TÜMÜ',
    '| max=',
    maxRows
  );
  console.log('---');

  const cols =
    'id,created_at,status,source,merged_into_call_id,matched_session_id,gclid,wbraid,gbraid,click_id,lead_score';

  let from = 0;
  const all: Record<string, unknown>[] = [];

  for (;;) {
    if (all.length >= maxRows) break;
    const take = Math.min(PAGE, maxRows - all.length);
    let q = supabase
      .from('calls')
      .select(cols)
      .eq('site_id', site.id)
      .eq('status', statusFilter)
      .order('created_at', { ascending: false })
      .range(from, from + take - 1);
    if (openOnly) q = q.is('merged_into_call_id', null);
    const { data, error } = await q;
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < take) break;
    from += take;
  }

  console.log(`Toplam satır (status=${statusFilter}):`, all.length);
  for (const row of all) {
    const r = row as {
      id: string;
      created_at: string;
      source: string | null;
      merged_into_call_id: string | null;
      matched_session_id: string | null;
      gclid?: string | null;
      wbraid?: string | null;
      gbraid?: string | null;
      click_id?: string | null;
      lead_score?: number | null;
    };
    const merged = r.merged_into_call_id ? `merged→${r.merged_into_call_id}` : 'open';
    const sid = r.matched_session_id ?? '-';
    const click =
      [r.gclid, r.wbraid, r.gbraid, r.click_id].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
        .length > 0
        ? 'call_row_click'
        : 'no_call_row_click';
    console.log(
      `${r.id}\t${r.created_at}\tsource=${r.source ?? ''}\t${merged}\tsession=${sid}\t${click}\tlead=${r.lead_score ?? ''}`
    );
  }

  if (all.length === 0 && statusFilter === 'intent') {
    console.log(
      '\nBu sitede şu an `status=intent` satırı yok (merge dahil arandı). Kartlar genelde hızlıca contacted/offered’a geçer.'
    );
    console.log('Örnek: npx tsx scripts/db/list-intents-for-site.ts Tecrubeli --status=contacted --limit=100');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
