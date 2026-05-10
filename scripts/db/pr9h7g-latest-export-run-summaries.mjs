#!/usr/bin/env node
/**
 * PR-9H.7G — Latest persisted oci_export_run_summaries rows for a site (closure / export_run_id lookup).
 *
 * Usage:
 *   node scripts/db/pr9h7g-latest-export-run-summaries.mjs --site-id <uuid> [--limit 5]
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveTargetDbConnectionString } from '../release/resolve-target-db-url.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

function parseArgv(argv) {
  let siteId = String(process.env.TARGET_SITE_UUID || '').trim();
  let limit = 5;
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--site-id' && a[i + 1]) siteId = String(a[++i]).trim();
    else if (a[i] === '--limit' && a[i + 1]) limit = Math.min(50, Math.max(1, Number(a[++i]) || 5));
  }
  return { siteId, limit };
}

const { siteId, limit } = parseArgv(process.argv);

if (!siteId) {
  console.error(JSON.stringify({ ok: false, error: 'MISSING_SITE_ID', hint: '--site-id <uuid>' }, null, 2));
  process.exit(1);
}

const dbUrl = resolveTargetDbConnectionString();
if (!dbUrl) {
  console.error(
    JSON.stringify({ ok: false, error: 'DB_URL_MISSING', hint: 'SUPABASE_DB_POOLER_URL or SUPABASE_DB_URL in .env.local' }, null, 2)
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const res = await client.query(
    `select export_run_id, site_id, provider_key, status,
            received_at, created_at,
            fetched_count, claimed_count,
            classified_uploadable_count, classified_skipped_count, classified_failed_count,
            upload_attempted_count, upload_success_count, upload_failed_count,
            ack_success_count, ack_failed_count, ack_skipped_count,
            provider_ambiguous_pending_count,
            hashed_phone_csv_canary_active,
            mismatch_reasons,
            fuse_stopped_reason
     from public.oci_export_run_summaries
     where site_id = $1::uuid
     order by received_at desc nulls last, created_at desc
     limit $2`,
    [siteId, limit]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        code: 'OCI_EXPORT_RUN_SUMMARIES_LATEST',
        site_id: siteId,
        row_count: res.rows.length,
        rows: res.rows,
        /** First row is the usual closure target when ordering by received_at desc */
        suggested_export_run_id_for_evidence: res.rows[0]?.export_run_id ?? null,
      },
      null,
      2
    )
  );
} catch (e) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'QUERY_FAILED',
        message: e instanceof Error ? e.message : String(e),
      },
      null,
      2
    )
  );
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
