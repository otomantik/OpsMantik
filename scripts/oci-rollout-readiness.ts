#!/usr/bin/env npx tsx
/**
 * OCI Google rollout readiness report (read-only).
 * Stuck window + profile defaults: lib/oci/queue-health-contract.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateQueueFailureTaxonomy, computeTaxonomyRates } from '../lib/oci/queue-failure-taxonomy';
import {
  QUEUE_HEALTH_POLICY_VERSION,
  ROLLOUT_RECOVERED_RETRY_GRACE_MINUTES,
  ROLLOUT_PROFILE_DEFAULTS,
  STUCK_PROCESSING_MAX_AGE_MINUTES,
  evaluateRolloutGate,
  type RolloutProfile,
} from '../lib/oci/queue-health-contract';
import { collectWonPipelineSiteStats } from '../lib/oci/won-missing-pipeline-site';
import {
  buildFleetGateSiteTriage,
  countPipelineClassifiedRetryRows,
  derivePrimaryStrictFleetClass,
} from '../lib/oci/rollout-readiness-triage';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseArgs(argv: string[]) {
  const out: {
    site: string | null;
    json: boolean;
    strict: boolean;
    profile: RolloutProfile;
    stuckMax: number;
    retryRateMax: number;
    failedRateMax: number;
  } = { site: null, json: false, strict: false, profile: 'prod', stuckMax: 20, retryRateMax: 0.3, failedRateMax: 0.2 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--site') out.site = argv[i + 1] || null;
    if (a === '--json') out.json = true;
    if (a === '--strict') out.strict = true;
    if (a === '--profile') {
      const p = argv[i + 1] || 'prod';
      out.profile = p === 'dev' || p === 'stage' || p === 'prod' ? p : 'prod';
    }
    if (a === '--stuck-max') out.stuckMax = Number(argv[i + 1] || out.stuckMax);
    if (a === '--retry-rate-max') out.retryRateMax = Number(argv[i + 1] || out.retryRateMax);
    if (a === '--failed-rate-max') out.failedRateMax = Number(argv[i + 1] || out.failedRateMax);
  }
  const selected = ROLLOUT_PROFILE_DEFAULTS[out.profile];
  if (!argv.includes('--stuck-max')) out.stuckMax = selected.stuckMax;
  if (!argv.includes('--retry-rate-max')) out.retryRateMax = selected.retryRateMax;
  if (!argv.includes('--failed-rate-max')) out.failedRateMax = selected.failedRateMax;
  return out;
}

async function loadSites(siteQuery: string | null) {
  const query = supabase
    .from('sites')
    .select('id, public_id, name, domain, oci_sync_method, oci_api_key, created_at')
    .order('created_at', { ascending: false });
  if (siteQuery) {
    query.or(`id.eq.${siteQuery},public_id.eq.${siteQuery},name.ilike.%${siteQuery}%,domain.ilike.%${siteQuery}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadEntitlement(siteId: string) {
  const { data, error } = await supabase.rpc('get_entitlements_for_site', { p_site_id: siteId });
  if (error) {
    const entitlementRpcMissing = Boolean(
      error.message?.includes('Could not find the function public.get_entitlements_for_site')
    );
    return {
      ok: false,
      tier: null,
      googleAdsSync: false,
      error: error.message,
      entitlementRpcMissing,
    };
  }
  return { ok: true, tier: data?.tier ?? null, googleAdsSync: data?.capabilities?.google_ads_sync === true, error: null };
}

async function loadQueueAndOutbox(siteId: string) {
  const [{ data: queueRows, error: queueErr }, { data: outboxRows, error: outboxErr }] = await Promise.all([
    supabase
      .from('offline_conversion_queue')
      .select('status, updated_at, provider_error_category, provider_error_code, last_error')
      .eq('site_id', siteId),
    supabase.from('outbox_events').select('status, updated_at').eq('site_id', siteId),
  ]);
  const queueTableMissing = Boolean(queueErr?.message?.includes("Could not find the table 'public.offline_conversion_queue'"));
  const outboxTableMissing = Boolean(outboxErr?.message?.includes("Could not find the table 'public.outbox_events'"));
  if (queueErr && !queueTableMissing) throw queueErr;
  if (outboxErr && !outboxTableMissing) throw outboxErr;

  const queue = { QUEUED: 0, PROCESSING: 0, COMPLETED: 0, UPLOADED: 0, FAILED: 0, RETRY: 0, DLQ: 0 };
  for (const row of queueRows || []) {
    const s = String(row.status || '');
    if (s in queue) (queue as Record<string, number>)[s] += 1;
    if (s === 'DEAD_LETTER_QUARANTINE') queue.DLQ += 1;
  }
  const outbox = { PENDING: 0, PROCESSING: 0, PROCESSED: 0, FAILED: 0 };
  for (const row of outboxRows || []) {
    const s = String(row.status || '');
    if (s in outbox) (outbox as Record<string, number>)[s] += 1;
  }

  const totalQueue = (queueRows || []).length;
  const retryRate = totalQueue > 0 ? queue.RETRY / totalQueue : 0;
  const recoveredRetryCutoff = Date.now() - ROLLOUT_RECOVERED_RETRY_GRACE_MINUTES * 60 * 1000;
  const recoveredRetryGraceCount = (queueRows || []).filter(
    (r) =>
      r.status === 'RETRY' &&
      r.last_error === 'PROCESSING_STALE_RECOVERY' &&
      new Date(String(r.updated_at || 0)).getTime() >= recoveredRetryCutoff
  ).length;
  const pipelineRetryGraceCount = countPipelineClassifiedRetryRows(queueRows || []);
  const retryRateExempt = totalQueue > 0 ? recoveredRetryGraceCount / totalQueue : 0;
  const retryRateExemptPipeline = totalQueue > 0 ? pipelineRetryGraceCount / totalQueue : 0;
  const gateRetryRate = Math.max(0, retryRate - retryRateExempt - retryRateExemptPipeline);
  const failedRate = totalQueue > 0 ? (queue.FAILED + queue.DLQ) / totalQueue : 0;
  const stuckCutoff = Date.now() - STUCK_PROCESSING_MAX_AGE_MINUTES * 60 * 1000;
  const stuckProcessing = (queueRows || []).filter(
    (r) => r.status === 'PROCESSING' && new Date(String(r.updated_at || 0)).getTime() < stuckCutoff
  ).length;

  const failureTaxonomy = aggregateQueueFailureTaxonomy(
    (queueRows || []).map((r) => ({
      status: (r as { status?: string }).status,
      provider_error_category: (r as { provider_error_category?: string | null }).provider_error_category,
      provider_error_code: (r as { provider_error_code?: string | null }).provider_error_code,
    }))
  );
  const taxRates =
    totalQueue > 0
      ? computeTaxonomyRates({
          totalQueue,
          taxonomy: failureTaxonomy,
          deadLetterQuarantineCount: queue.DLQ,
        })
      : {
          total_failed_rate: 0,
          actionable_failed_rate: 0,
          provider_failed_rate: 0,
          deterministic_skip_rate: 0,
        };

  const wonPipeline = queueTableMissing
    ? {
        wonTotal: 0,
        wonInQueue: 0,
        wonCompleted: 0,
        wonRepresentedFailedTerminal: 0,
        wonPipelineRepresentedTotal: 0,
        wonMissingPipeline: 0,
        oldestMissingAgeSeconds: null,
      }
    : await collectWonPipelineSiteStats(supabase, siteId);

  return {
    queue,
    outbox,
    totalQueue,
    retryRate,
    retryRateExempt,
    gateRetryRate,
    recoveredRetryGraceCount,
    pipelineRetryGraceCount,
    retryRateExemptPipeline,
    recoveredRetryGraceMinutes: ROLLOUT_RECOVERED_RETRY_GRACE_MINUTES,
    failedRate,
    totalFailedRate: taxRates.total_failed_rate,
    actionableFailedRate: taxRates.actionable_failed_rate,
    providerFailedRate: taxRates.provider_failed_rate,
    deterministicSkipRate: taxRates.deterministic_skip_rate,
    failureTaxonomy,
    wonMissingPipelineCount: wonPipeline.wonMissingPipeline,
    wonRepresentedFailedTerminalCount: wonPipeline.wonRepresentedFailedTerminal,
    wonPipelineRepresentedTotalCount: wonPipeline.wonPipelineRepresentedTotal,
    wonPipeline,
    stuckProcessing,
    queueTableMissing,
    outboxTableMissing,
  };
}

export type Report = {
  site: { id: string; public_id: string | null; name: string | null; domain: string | null; mode: string };
  auth: {
    hasApiKey: boolean;
    googleAdsSync: boolean;
    tier: string | null;
    entitlementOk: boolean;
    entitlementError: string | null;
  };
  metrics: Awaited<ReturnType<typeof loadQueueAndOutbox>>;
  gate: { pass: boolean; failures: string[] };
};

function recommendCanary(sites: Report[]) {
  const eligible = sites
    .filter((s) => s.auth.hasApiKey && s.auth.googleAdsSync)
    .sort((a, b) => (a.metrics.totalQueue || 0) - (b.metrics.totalQueue || 0));
  return eligible[0] || null;
}

async function buildReports(args: ReturnType<typeof parseArgs>): Promise<Report[]> {
  const siteRows = await loadSites(args.site);
  const reports: Report[] = [];
  for (const site of siteRows) {
    const [authEnt, metrics] = await Promise.all([loadEntitlement(site.id), loadQueueAndOutbox(site.id)]);
    const gate = evaluateRolloutGate({
      stuckProcessing: metrics.stuckProcessing,
      retryRate: metrics.retryRate,
      retryRateExempt: metrics.retryRateExempt + metrics.retryRateExemptPipeline,
      failedRate: metrics.failedRate,
      actionableFailedRate: metrics.queueTableMissing ? metrics.failedRate : metrics.actionableFailedRate,
      providerFailedRate: metrics.queueTableMissing ? 0 : metrics.providerFailedRate,
      unknownFailedCount: metrics.queueTableMissing ? 0 : metrics.failureTaxonomy.unknown_failed_count,
      wonMissingPipelineCount: metrics.queueTableMissing ? 0 : metrics.wonMissingPipelineCount,
      deadLetterQuarantineCount: metrics.queue.DLQ,
      profile: args.profile,
      overrides: {
        stuckMax: args.stuckMax,
        retryRateMax: args.retryRateMax,
        failedRateMax: args.failedRateMax,
      },
    });
    reports.push({
      site: {
        id: site.id,
        public_id: site.public_id,
        name: site.name,
        domain: site.domain,
        mode: site.oci_sync_method || 'script',
      },
      auth: {
        hasApiKey: Boolean(site.oci_api_key),
        googleAdsSync: authEnt.googleAdsSync,
        tier: authEnt.tier,
        entitlementOk: authEnt.ok,
        entitlementError: authEnt.error,
      },
      metrics,
      gate,
    });
  }
  return reports;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const reports = await buildReports(args);

  const summary = {
    totalSites: reports.length,
    modeCounts: reports.reduce(
      (acc, r) => {
        const mode = r.site.mode || 'script';
        acc[mode] = (acc[mode] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    authReadySites: reports.filter((r) => r.auth.hasApiKey && r.auth.googleAdsSync).length,
    gatePassSites: reports.filter((r) => r.gate.pass).length,
    tableSchemaWarnings: reports.filter((r) => r.metrics.queueTableMissing || r.metrics.outboxTableMissing).length,
  };

  const schemaDriftSites = reports
    .filter((r) => r.metrics.queueTableMissing || r.metrics.outboxTableMissing)
    .map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id,
      missing: [
        ...(r.metrics.queueTableMissing ? ['offline_conversion_queue'] : []),
        ...(r.metrics.outboxTableMissing ? ['outbox_events'] : []),
      ],
    }));
  const missingApiKeySites = reports.filter((r) => !r.auth.hasApiKey).map((r) => r.site.name || r.site.public_id || r.site.id);
  const missingEntitlementSites = reports
    .filter((r) => !r.auth.googleAdsSync)
    .map((r) => r.site.name || r.site.public_id || r.site.id);
  const missingEntitlementRpcSites = reports
    .filter((r) => r.auth.entitlementOk === false && r.auth.entitlementError?.includes('get_entitlements_for_site'))
    .map((r) => r.site.name || r.site.public_id || r.site.id);
  const canary = recommendCanary(reports);
  const strictFailures: string[] = [];
  if (summary.totalSites === 0) strictFailures.push('no_sites_found');
  if (summary.authReadySites === 0) strictFailures.push('no_auth_ready_sites');
  if (summary.gatePassSites < summary.totalSites) strictFailures.push('observability_gate_failures_present');
  if (summary.tableSchemaWarnings > 0) strictFailures.push('schema_drift_detected');
  if (missingApiKeySites.length > 0) strictFailures.push('missing_api_key_sites');
  if (missingEntitlementSites.length > 0) strictFailures.push('missing_google_ads_sync_capability');
  if (missingEntitlementRpcSites.length > 0) strictFailures.push('missing_entitlement_rpc');
  if (!canary) strictFailures.push('no_canary_candidate');

  const strictPrimaryClass = derivePrimaryStrictFleetClass(strictFailures, reports);
  const fleetGateSiteTriage = buildFleetGateSiteTriage(reports);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          profile: args.profile,
          queue_health_policy_version: QUEUE_HEALTH_POLICY_VERSION,
          thresholds: {
            stuckMax: args.stuckMax,
            retryRateMax: args.retryRateMax,
            failedRateMax: args.failedRateMax,
            recoveredRetryGraceMinutes: ROLLOUT_RECOVERED_RETRY_GRACE_MINUTES,
            stuck_age_minutes: STUCK_PROCESSING_MAX_AGE_MINUTES,
          },
          canary: canary?.site || null,
          actionable: {
            missingApiKeySites,
            missingEntitlementSites,
            missingEntitlementRpcSites,
            schemaDriftSites,
          },
          strict: {
            enabled: args.strict,
            pass: strictFailures.length === 0,
            failures: strictFailures,
            triage: {
              primary_red_metric_class: strictPrimaryClass,
              fleet_gate_site_triage: fleetGateSiteTriage,
              pr_1c_note:
                'Gate uses actionable_failed_rate and provider_failed_rate; total_failed_rate is visible per site. PR-9J.CI-AUDIT-P1.1: TRANSIENT/RATE_LIMIT/AUTH RETRY rows are exempt from retry-rate gate (pipeline backlog), not from FAILED taxonomy.',
            },
          },
          reports,
        },
        null,
        2
      )
    );
    if (args.strict && strictFailures.length > 0) process.exit(1);
    return;
  }

  console.log('\n=== OCI MODE INVENTORY ===');
  console.log(summary);
  console.table(
    reports.map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      mode: r.site.mode,
      apiKey: r.auth.hasApiKey ? 'yes' : 'no',
      googleAdsSync: r.auth.googleAdsSync ? 'yes' : 'no',
    }))
  );

  console.log('\n=== QUEUE / OUTBOX FLOW ===');
  console.table(
    reports.map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      outboxPending: r.metrics.outbox.PENDING,
      queued: r.metrics.queue.QUEUED,
      processing: r.metrics.queue.PROCESSING,
      retry: r.metrics.queue.RETRY,
      failedTotal: r.metrics.queue.FAILED + r.metrics.queue.DLQ,
      actionableFailRate: r.metrics.queueTableMissing ? 'n/a' : r.metrics.actionableFailedRate.toFixed(2),
      detSkipRate: r.metrics.queueTableMissing ? 'n/a' : r.metrics.deterministicSkipRate.toFixed(2),
      wonMiss: r.metrics.queueTableMissing ? 'n/a' : r.metrics.wonMissingPipelineCount,
      schemaWarning: r.metrics.queueTableMissing || r.metrics.outboxTableMissing ? 'yes' : 'no',
    }))
  );

  console.log('\n=== OBSERVABILITY GATES ===');
  console.table(
    reports.map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      pass: r.gate.pass ? 'PASS' : 'FAIL',
      stuckProcessing: r.metrics.stuckProcessing,
      retryRate: r.metrics.retryRate.toFixed(2),
      gateRetryRate: r.metrics.gateRetryRate.toFixed(2),
      recoveredRetryGrace: r.metrics.recoveredRetryGraceCount,
      pipelineRetryGrace: r.metrics.pipelineRetryGraceCount,
      totalFailedRate: r.metrics.failedRate.toFixed(2),
      actionableRate: r.metrics.queueTableMissing ? 'n/a' : r.metrics.actionableFailedRate.toFixed(2),
      providerRate: r.metrics.queueTableMissing ? 'n/a' : r.metrics.providerFailedRate.toFixed(2),
      reasons: r.gate.failures.join(', ') || '-',
    }))
  );

  console.log('\n=== CANARY RECOMMENDATION ===');
  if (!canary) {
    console.log('No eligible site found (requires apiKey + google_ads_sync).');
  } else {
    console.log({
      siteId: canary.site.id,
      publicId: canary.site.public_id,
      name: canary.site.name,
      mode: canary.site.mode,
      totalQueue: canary.metrics.totalQueue,
    });
  }

  if (args.strict) {
    if (strictFailures.length > 0) {
      console.error('\n=== STRICT GATE: FAIL ===');
      console.error(strictFailures.join(', '));
      process.exit(1);
    }
    console.log('\n=== STRICT GATE: PASS ===');
  }
}

run().catch((err: Error) => {
  console.error('oci-rollout-readiness failed:', err?.message || err);
  process.exit(1);
});
