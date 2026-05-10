#!/usr/bin/env node
/**
 * Read queue row + recent oci_queue_transitions for PR-9G / canary closure.
 *
 * Usage:
 *   node scripts/db/pr9g-read-row-state.mjs --site-id <uuid> --queue-id <uuid>
 * Or env: RECOVERY_TARGET_SITE_ID, RECOVERY_TARGET_QUEUE_ID
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { classifyProcessingRecovery } from '../../lib/oci/processing-recovery-classifier.ts';
import { resolveTargetDbConnectionString } from '../release/resolve-target-db-url.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

function parseCliSiteQueue(argv) {
  let siteId = String(process.env.RECOVERY_TARGET_SITE_ID || '').trim();
  let queueId = String(process.env.RECOVERY_TARGET_QUEUE_ID || '').trim();
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--site-id' && a[i + 1]) {
      siteId = String(a[++i]).trim();
    } else if (a[i] === '--queue-id' && a[i + 1]) {
      queueId = String(a[++i]).trim();
    }
  }
  if (!siteId) siteId = '7eb8f5c0-4a96-4a0e-bd89-a463127b26b8';
  if (!queueId) queueId = '6c1537a7-98ca-47eb-8bd9-67c35965cf9d';
  return { siteId, queueId };
}

const { siteId: parsedSite, queueId: parsedQueue } = parseCliSiteQueue(process.argv);
const queueId = parsedQueue;
const siteId = parsedSite;

async function main() {
  const dbUrl = resolveTargetDbConnectionString();
  if (!dbUrl) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: 'DB_URL_MISSING',
          hint: 'Set SUPABASE_DB_POOLER_URL or SUPABASE_DB_URL (or DATABASE_URL) in .env.local',
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const rowRes = await client.query(
      `select id, site_id, status, claimed_at, updated_at, uploaded_at,
              provider_request_id, provider_error_category, provider_error_code,
              retry_count, external_id, action
       from offline_conversion_queue
       where id = $1 and site_id = $2`,
      [queueId, siteId]
    );
    const row = rowRes.rows[0] || null;
    if (!row) {
      console.log(JSON.stringify({ ok: false, error: 'ROW_NOT_FOUND' }, null, 2));
      process.exit(1);
    }

    const trRes = await client.query(
      `select *
       from oci_queue_transitions
       where queue_id = $1
       order by created_at desc
       limit 100`,
      [queueId]
    );
    const transitions = trRes.rows ?? [];
    const payloadTexts = transitions.map((t) => JSON.stringify(t.payload || t.meta || {}).toLowerCase());
    const sourceOf = (t) => t.source ?? t.actor ?? t.transition_source ?? t.reason ?? null;
    const hasScriptSummary = payloadTexts.some((s) => s.includes('script_summary'));
    const ackFound =
      payloadTexts.some((s) => s.includes('ack_success') || s.includes('ack_failed')) ||
      transitions.some((t) => String(sourceOf(t) || '').toLowerCase().includes('ack'));
    const uploadAttemptedCount = payloadTexts.filter(
      (s) => s.includes('upload_attempted') || s.includes('provider_request_id')
    ).length;
    const ackSuccessCount = payloadTexts.filter((s) => s.includes('ack_success')).length;
    const ackFailedCount = payloadTexts.filter((s) => s.includes('ack_failed')).length;

    const nowIso = new Date().toISOString();
    const claimedAtIso = row.claimed_at ? new Date(row.claimed_at).toISOString() : null;
    const updatedAtIso = row.updated_at ? new Date(row.updated_at).toISOString() : null;
    const decision = classifyProcessingRecovery({
      status: row.status,
      claimedAt: claimedAtIso,
      updatedAt: updatedAtIso,
      nowIso,
      providerRequestId: row.provider_request_id,
      providerErrorCategory: row.provider_error_category,
      providerErrorCode: row.provider_error_code,
      hasScriptSummary,
      scriptUploadAttemptedCount: uploadAttemptedCount,
      scriptAckSuccessCount: ackSuccessCount,
      scriptAckFailedCount: ackFailedCount,
      retryCount: row.retry_count,
      stuckThresholdMinutes: 15,
    });

    const refTs = claimedAtIso ?? updatedAtIso;
    const ageMinutes = refTs ? Math.max(0, (Date.parse(nowIso) - Date.parse(refTs)) / 60000) : null;

    const processingToRetryTransition = transitions.find((t) => {
          const payload = t.payload || t.meta || {};
      const fromStatus = String(payload.from_status ?? payload.previous_status ?? '').toUpperCase();
      const toStatus = String(payload.to_status ?? payload.next_status ?? '').toUpperCase();
      return fromStatus === 'PROCESSING' && toStatus === 'RETRY';
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          queue_id: row.id,
          site_id: row.site_id,
          status: row.status,
          claimed_at: row.claimed_at,
          updated_at: row.updated_at,
          age_minutes: ageMinutes,
          uploaded_at: row.uploaded_at,
          provider_request_id: row.provider_request_id,
          provider_error_category: row.provider_error_category,
          provider_error_code: row.provider_error_code,
          script_summary_found: hasScriptSummary,
          ack_found: ackFound,
          classifier_provider_outcome: decision.provider_outcome,
          classifier_recovery_bucket: decision.recovery_bucket,
          safe_to_retry: decision.safe_to_retry,
          blocking_reasons: decision.blocking_reasons,
          external_id: row.external_id,
          conversion_name: row.action,
          transition_source: processingToRetryTransition ? sourceOf(processingToRetryTransition) : null,
          transition_sample_keys:
            transitions.length > 0 ? Object.keys(transitions[0]).slice(0, 12) : [],
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: 'READ_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
