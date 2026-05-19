/**
 * Repair marketing_signals → offline_conversion_queue parity gaps (audit lane only).
 * Google export reads journal queue only; this does not create a second upload path.
 *
 * Usage:
 *   npm run oci:repair-marketing-signal-parity -- --dry-run
 *   npm run oci:repair-marketing-signal-parity -- --site=<uuid> --limit=200
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { ensureOciQueueEnqueue } from '@/lib/oci/ensure-oci-queue-enqueue';

config({ path: join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const siteIdArg = args.find((a) => a.startsWith('--site='))?.slice('--site='.length) ?? null;
const limitArg = Number(args.find((a) => a.startsWith('--limit='))?.slice('--limit='.length) ?? '500');
const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(5000, Math.trunc(limitArg))) : 500;

type Stage = 'contacted' | 'offered' | 'junk';

function actionToStage(action: string): Stage | null {
  if (action === 'OpsMantik_Contacted') return 'contacted';
  if (action === 'OpsMantik_Offered') return 'offered';
  if (action === 'OpsMantik_Junk_Exclusion') return 'junk';
  return null;
}

async function main() {
  let query = supabase
    .from('marketing_signals')
    .select(
      'id,site_id,call_id,google_conversion_name,google_conversion_time,created_at,gclid,wbraid,gbraid,conversion_value'
    )
    .in('dispatch_status', ['PENDING', 'RETRY', 'PROCESSING'])
    .or('gclid.not.is.null,wbraid.not.is.null,gbraid.not.is.null')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (siteIdArg) query = query.eq('site_id', siteIdArg);

  const { data, error } = await query;
  if (error) {
    console.error('marketing_signals query failed:', error.message);
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : [];
  let examined = 0;
  let gaps = 0;
  let enqueued = 0;
  let duplicates = 0;
  let consentMissing = 0;
  let errors = 0;

  for (const row of rows) {
    examined++;
    const stage = actionToStage(String(row.google_conversion_name ?? ''));
    if (!stage || !row.site_id || !row.call_id) continue;
    const signalTime = row.google_conversion_time ?? row.created_at;
    const occurredAt = new Date(signalTime);
    if (Number.isNaN(occurredAt.getTime())) continue;

    const { data: exists } = await supabase
      .from('offline_conversion_queue')
      .select('id')
      .eq('site_id', row.site_id)
      .eq('call_id', row.call_id)
      .eq('provider_key', 'google_ads')
      .eq('action', row.google_conversion_name)
      .limit(1);

    if (Array.isArray(exists) && exists.length > 0) continue;
    gaps++;

    if (dryRun) continue;

    const parity = await ensureOciQueueEnqueue({
      siteId: row.site_id,
      callId: row.call_id,
      stage,
      occurredAt,
      leadScore: 0,
      currency: 'TRY',
      gclid: row.gclid ?? null,
      wbraid: row.wbraid ?? null,
      gbraid: row.gbraid ?? null,
      source: 'parity_repair_script',
      consentState: 'unknown',
      traceId: null,
    });

    if (parity.reasonCode === 'PARITY_QUEUE_ENQUEUED') enqueued++;
    else if (parity.reasonCode === 'PARITY_QUEUE_DUPLICATE') duplicates++;
    else if (parity.reasonCode === 'PARITY_CONSENT_MISSING') consentMissing++;
    else errors++;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        siteId: siteIdArg,
        limit,
        examined,
        parityGaps: gaps,
        repaired: { enqueued, duplicates, consentMissing, errors },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
