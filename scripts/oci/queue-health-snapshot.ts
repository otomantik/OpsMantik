#!/usr/bin/env npx tsx
/**
 * Read-only: per-site queue_health_score + blocking_reasons (same inputs as GET /api/oci/queue-stats).
 * Usage: npx tsx scripts/oci/queue-health-snapshot.ts [--json]
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUEUE_STATUSES, type QueueStatus } from '../../lib/domain/oci/queue-types';
import { fetchSiteSsotFlags } from '../../lib/oci/queue-health-ssot-flags-site';
import { STUCK_PROCESSING_MAX_AGE_MINUTES, evaluateQueueHealth } from '../../lib/oci/queue-health-contract';
import { countWonMissingPipelineForSite } from '../../lib/oci/won-missing-pipeline-site';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseArgs(argv: string[]) {
  return { json: argv.includes('--json') };
}

async function loadSites() {
  const { data, error } = await supabase
    .from('sites')
    .select('id, public_id, name, domain, oci_sync_method')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function snapshotSite(siteId: string) {
  const { data: rows, error } = await supabase.from('offline_conversion_queue').select('status').eq('site_id', siteId);
  if (error) throw error;

  const totals = Object.fromEntries(QUEUE_STATUSES.map((s) => [s, 0])) as Record<QueueStatus, number>;
  for (const r of rows || []) {
    const s = (r as { status?: string }).status;
    if (s && QUEUE_STATUSES.includes(s as QueueStatus)) {
      totals[s as QueueStatus]++;
    }
  }

  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MAX_AGE_MINUTES * 60 * 1000).toISOString();
  const { count: stuckCount, error: stuckError } = await supabase
    .from('offline_conversion_queue')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('status', 'PROCESSING')
    .lt('updated_at', cutoff);
  if (stuckError) throw stuckError;
  const stuckProcessing = typeof stuckCount === 'number' ? stuckCount : 0;

  const [{ data: oldestQueuedRow }, { data: oldestRetryRow }, { data: oldestProcessingRow }, wonMissingPipelineCount, ssotFlags] =
    await Promise.all([
      supabase
        .from('offline_conversion_queue')
        .select('created_at')
        .eq('site_id', siteId)
        .eq('status', 'QUEUED')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('offline_conversion_queue')
        .select('created_at')
        .eq('site_id', siteId)
        .eq('status', 'RETRY')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('offline_conversion_queue')
        .select('updated_at')
        .eq('site_id', siteId)
        .eq('status', 'PROCESSING')
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      countWonMissingPipelineForSite(supabase, siteId),
      fetchSiteSsotFlags(supabase, siteId),
    ]);

  const minutesSince = (iso: string | undefined | null): number | null => {
    if (!iso) return null;
    return (Date.now() - new Date(iso).getTime()) / 60000;
  };

  const totalQueue = rows?.length ?? 0;
  const queueHealth = evaluateQueueHealth({
    evaluationMode: 'operational',
    targetDbEvidenceAvailable: true,
    siteId,
    stuckProcessingCount: stuckProcessing,
    wonMissingPipelineCount,
    oldestQueuedAgeMinutes: minutesSince((oldestQueuedRow as { created_at?: string } | null)?.created_at),
    oldestRetryAgeMinutes: minutesSince((oldestRetryRow as { created_at?: string } | null)?.created_at),
    oldestProcessingAgeMinutes: minutesSince((oldestProcessingRow as { updated_at?: string } | null)?.updated_at),
    totalQueue,
    retryCount: totals.RETRY,
    failedCount: totals.FAILED,
    deadLetterQuarantineCount: totals.DEAD_LETTER_QUARANTINE,
    timeSsotRed: ssotFlags.timeSsotRed,
    valueIntegrityRed: ssotFlags.valueIntegrityRed,
    identityIntegrityRed: ssotFlags.identityIntegrityRed,
  });

  return {
    site_id: siteId,
    queue_health_score: queueHealth.queue_health_score,
    queue_health_status: queueHealth.queue_health_status,
    blocking_reasons: queueHealth.blocking_reasons,
    retry_rate: queueHealth.retry_rate,
    failed_rate: queueHealth.failed_rate,
    stuck_processing: stuckProcessing,
    won_missing_pipeline: wonMissingPipelineCount,
    totals,
    ssot: {
      time_red: ssotFlags.timeSsotRed,
      value_red: ssotFlags.valueIntegrityRed,
      identity_red: ssotFlags.identityIntegrityRed,
    },
  };
}

async function main() {
  const { json } = parseArgs(process.argv.slice(2));
  const sites = await loadSites();
  type Row = Awaited<ReturnType<typeof snapshotSite>> & {
    name: string;
    domain: string | null;
    public_id: string;
    oci_sync_method: string;
  };
  const rows: Row[] = [];

  for (const s of sites) {
    const snap = await snapshotSite(s.id);
    rows.push({
      ...snap,
      name: s.name,
      domain: s.domain,
      public_id: s.public_id,
      oci_sync_method: s.oci_sync_method ?? 'script',
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    policy: 'queue_health_contract_v1',
    operational_mode: 'operational (same as queue-stats API)',
    notes: [
      'Score is 100 or 0 (v1); one blocking reason => 0.',
      'Export/retry paths use jittered backoff — not bit-for-bit deterministic wall-clock timing.',
    ],
    sites_all_green: rows.every((r) => r.queue_health_score === 100),
    sites: rows.map((r) => ({
      name: r.name,
      domain: r.domain,
      public_id: r.public_id,
      oci_sync_method: r.oci_sync_method,
      queue_health_score: r.queue_health_score,
      queue_health_status: r.queue_health_status,
      blocking_reasons: r.blocking_reasons,
      stuck_processing: r.stuck_processing,
      won_missing_pipeline: r.won_missing_pipeline,
      dlq: r.totals.DEAD_LETTER_QUARANTINE,
      failed: r.totals.FAILED,
      retry: r.totals.RETRY,
      retry_rate: r.retry_rate,
      failed_rate: r.failed_rate,
      ssot_time_red: r.ssot.time_red,
      ssot_identity_red: r.ssot.identity_red,
      ssot_value_red: r.ssot.value_red,
    })),
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\n=== Queue Health snapshot (TARGET_DB) ===\n');
  console.log(`generated_at: ${summary.generated_at}`);
  console.log(`all sites GREEN / score 100: ${summary.sites_all_green}\n`);
  console.table(
    summary.sites.map((x) => ({
      site: x.name,
      score: x.queue_health_score,
      status: x.queue_health_status,
      blocking: x.blocking_reasons.join(';') || '—',
      stuck: x.stuck_processing,
      won_miss: x.won_missing_pipeline,
      DLQ: x.dlq,
    }))
  );
  console.log('\nNot deterministik: retry delays include OCI_RETRY_JITTER_MAX_SECONDS randomness by design.');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
