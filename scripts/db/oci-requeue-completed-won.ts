#!/usr/bin/env tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function resolveSiteId(raw: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw;
  const { data, error } = await supabase
    .from('sites')
    .select('id')
    .or(`name.ilike.%${raw}%,domain.ilike.%${raw}%`)
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) throw new Error(`Site not found: ${raw}`);
  return data.id;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const siteArg = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'koc oto';
  const siteId = await resolveSiteId(siteArg);

  const { data: completedRows, error } = await supabase
    .from('offline_conversion_queue')
    .select('id,call_id,conversion_time,actual_revenue,currency,system_score')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .eq('action', 'OpsMantik_Won')
    .eq('status', 'COMPLETED')
    .order('updated_at', { ascending: true });
  if (error) throw error;

  const rows = (completedRows ?? []).filter((row) => Boolean(row.call_id));
  console.log(
    JSON.stringify(
      {
        siteId,
        mode: dryRun ? 'dry-run' : 'apply',
        completedWonRows: completedRows?.length ?? 0,
        callableRows: rows.length,
      },
      null,
      2
    )
  );
  if (dryRun) return;

  let enqueued = 0;
  const skipped: Record<string, number> = {};
  for (const row of rows) {
    const result = await enqueueSealConversion({
      callId: String(row.call_id),
      siteId,
      confirmedAt: String(row.conversion_time),
      saleAmount:
        row.actual_revenue != null && Number.isFinite(Number(row.actual_revenue))
          ? Number(row.actual_revenue)
          : null,
      currency: String(row.currency || 'TRY'),
      leadScore:
        row.system_score != null && Number.isFinite(Number(row.system_score))
          ? Number(row.system_score)
          : null,
      entryReason: `manual_completed_requeue:${row.id}`,
    });

    if (result.enqueued) {
      enqueued += 1;
      continue;
    }
    const reason = result.reason || 'unknown';
    skipped[reason] = (skipped[reason] || 0) + 1;
  }

  console.log(JSON.stringify({ siteId, enqueued, skipped }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
