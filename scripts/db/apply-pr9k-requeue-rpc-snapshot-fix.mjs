#!/usr/bin/env node
/**
 * One-off: reload `requeue_unconfirmed_script_completed_rows_v1` body from the canonical
 * PR-9K migration file (fixes clear_fields vs last_error snapshot assert).
 *
 * Requires SUPABASE_DB_URL or SUPABASE_DB_POOLER_URL in .env.local (not committed).
 */
import { config } from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const url = (process.env.SUPABASE_DB_POOLER_URL || process.env.SUPABASE_DB_URL || '').trim();
if (!url) {
  console.error('Missing SUPABASE_DB_URL or SUPABASE_DB_POOLER_URL');
  process.exit(1);
}

const migPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261228141500_pr9k_operator_requeue_unconfirmed_google_script_completed.sql'
);
const all = readFileSync(migPath, 'utf8');
const fnStart = all.indexOf('CREATE OR REPLACE FUNCTION public.requeue_unconfirmed_script_completed_rows_v1');
if (fnStart < 0) throw new Error('function not found in migration');
const grantNeedle = 'GRANT EXECUTE ON FUNCTION public.requeue_unconfirmed_script_completed_rows_v1';
const g = all.indexOf(grantNeedle, fnStart);
if (g < 0) throw new Error('GRANT line not found');
const lineEnd = all.indexOf('\n', g);
const sql = all.slice(fnStart, lineEnd + 1);

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(JSON.stringify({ ok: true, applied: 'requeue_unconfirmed_script_completed_rows_v1' }));
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
