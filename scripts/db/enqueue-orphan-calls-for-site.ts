/**
 * Confirmed çağrılar: offline_conversion_queue'da yoksa enqueueSealConversion ile ekle.
 * actual_revenue bilinmiyorsa sale_amount fallback üretilmez; canonical optimization math
 * sadece stage + system_score ile çalışır.
 *
 * Usage:
 *   npx tsx scripts/db/enqueue-orphan-calls-for-site.ts "Koç" --dry-run
 *   npx tsx scripts/db/enqueue-orphan-calls-for-site.ts 0a41d14e-f3d3-4213-a87b-b62eb8a7abda
 *
 * Requires .env.local (SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL).
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';

config({ path: join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const daysArg = args.find((a) => a.startsWith('--days='));
const days = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1], 10) || 14) : 30;
const positional = args.find((a) => !a.startsWith('-'));

async function resolveSiteId(q: string | undefined): Promise<string | null> {
  if (!q) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(q)) {
    const { data } = await supabase.from('sites').select('id').eq('id', q).maybeSingle();
    return data?.id ?? null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function main() {
  const siteId = await resolveSiteId(positional);
  if (!siteId) {
    console.error('Site bulunamadı. Örnek: npx tsx scripts/db/enqueue-orphan-calls-for-site.ts "Koç"');
    process.exit(1);
  }

  const { data: siteRow } = await supabase
    .from('sites')
    .select('name, domain, currency')
    .eq('id', siteId)
    .maybeSingle();

  const currency = (siteRow?.currency || 'TRY').trim().toUpperCase();

  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: queueRows } = await supabase.from('offline_conversion_queue').select('call_id').eq('site_id', siteId);
  const queued = new Set((queueRows ?? []).map((r) => r.call_id).filter(Boolean) as string[]);

  const { data: calls, error: callsErr } = await supabase
    .from('calls')
    .select('id, site_id, status, oci_status, confirmed_at, sale_amount, currency, lead_score')
    .eq('site_id', siteId)
    .eq('status', 'confirmed')
    .not('confirmed_at', 'is', null)
    .gte('confirmed_at', since)
    .order('confirmed_at', { ascending: false });

  if (callsErr) {
    console.error(callsErr.message);
    process.exit(1);
  }

  const orphans = (calls ?? []).filter((c) => !queued.has(c.id));

  console.log(`Site: ${siteRow?.name} (${siteRow?.domain})`);
  console.log(`Lookback: ${days}d | actual_revenue fallback: disabled | currency: ${currency}`);
  console.log(`Confirmed (since): ${calls?.length ?? 0} | Zaten kuyrukta: ${queued.size} | Eksik: ${orphans.length}`);
  if (dryRun) console.log('[DRY-RUN] enqueue çağrılmayacak.\n');

  let enqueued = 0;
  const skipped: Record<string, number> = {};

  for (const call of orphans) {
    const confirmedAt = call.confirmed_at as string;
    const rawSale = call.sale_amount != null ? Number(call.sale_amount) : null;
    const saleAmount =
      rawSale != null && Number.isFinite(rawSale) && rawSale > 0 ? rawSale : null;

    if (dryRun) {
      console.log('would enqueue', call.id, 'oci', call.oci_status, 'sale_in', rawSale, '->', saleAmount);
      continue;
    }

    const result = await enqueueSealConversion({
      callId: call.id,
      siteId: call.site_id,
      confirmedAt,
      saleAmount,
      currency: (call.currency?.trim() || currency) as string,
      leadScore: call.lead_score ?? null,
      entryReason: 'orphan_backfill_script',
    });

    if (result.enqueued) {
      enqueued++;
      queued.add(call.id);
    } else {
      const r = result.reason ?? 'error';
      skipped[r] = (skipped[r] ?? 0) + 1;
      if (r === 'error' && result.error) {
        console.warn('skip', call.id.slice(0, 8), r, result.error);
      }
    }
  }

  if (!dryRun) {
    console.log('\n--- Özet ---');
    console.log('Yeni kuyruk:', enqueued);
    console.log('Atlanan:', skipped);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
