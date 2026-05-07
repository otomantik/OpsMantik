#!/usr/bin/env tsx
import { config } from 'dotenv';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function main() {
  const args = process.argv.slice(2);
  const siteId = args.includes('--site') ? args[args.indexOf('--site') + 1] : '3276893e-0433-4e35-95f2-4e80cf863f4c';
  const dryRun = !args.includes('--apply');
  const { data, error } = await supabase
    .from('offline_conversion_queue')
    .select('*')
    .eq('site_id', siteId)
    .eq('status', 'COMPLETED')
    .order('conversion_time', { ascending: true });
  if (error) throw error;

  const completed = data ?? [];
  const nowIso = new Date().toISOString();
  const inserts = completed.map((row, idx) => {
    const base = new Date((row.conversion_time as string) || (row.occurred_at as string) || (row.created_at as string));
    const shiftedIso = new Date(base.getTime() + (idx + 1) * 7).toISOString(); // 7ms step
    const extSeed = `${row.id}|clone_ms|${shiftedIso}`;
    const externalId = `oci_${crypto.createHash('sha256').update(extSeed).digest('hex').slice(0, 32)}`;
    const clone: Record<string, unknown> = { ...row };
    delete clone.id;
    clone.external_id = externalId;
    clone.status = 'QUEUED';
    clone.attempt_count = 0;
    clone.retry_count = 0;
    clone.next_retry_at = null;
    clone.claimed_at = null;
    clone.uploaded_at = null;
    clone.provider_request_id = null;
    clone.provider_ref = null;
    clone.provider_error_code = null;
    clone.provider_error_category = null;
    clone.last_error = null;
    clone.block_reason = null;
    clone.blocked_at = null;
    clone.created_at = nowIso;
    clone.updated_at = nowIso;
    clone.conversion_time = shiftedIso;
    clone.occurred_at = shiftedIso;
    clone.source_timestamp = shiftedIso;
    // Pending uniqueness guard is (site_id, session_id). Clone rows must detach
    // from original session to coexist with existing queued entries.
    clone.session_id = null;
    clone.entry_reason = `manual_clone_from_completed:${row.id}`;
    return clone;
  });

  console.log(JSON.stringify({ siteId, mode: dryRun ? 'dry-run' : 'apply', completed: completed.length, plannedClones: inserts.length }, null, 2));
  if (dryRun || inserts.length === 0) return;

  const insertRes = await supabase
    .from('offline_conversion_queue')
    .insert(inserts)
    .select('id,call_id,session_id,action,status,gclid,conversion_time,entry_reason');
  if (insertRes.error) throw insertRes.error;
  const inserted = insertRes.data ?? [];
  const byAction = inserted.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.action || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ inserted: inserted.length, byAction }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

