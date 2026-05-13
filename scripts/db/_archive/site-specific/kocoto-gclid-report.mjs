#!/usr/bin/env node
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const SITE_ID = process.argv[2] || '3276893e-0433-4e35-95f2-4e80cf863f4c';
const supabase = createClient(url, key, { auth: { persistSession: false } });

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const isWonLike = (row) => row.queueActions.includes('OpsMantik_Won') || Number(row.sale_amount || 0) > 0;

async function main() {
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id,name,domain')
    .eq('id', SITE_ID)
    .single();
  if (siteErr) throw siteErr;

  const { data: calls, error: callsErr } = await supabase
    .from('calls')
    .select(
      'id,status,created_at,confirmed_at,source,gclid,wbraid,gbraid,caller_phone_e164,caller_phone_hash_sha256,sale_amount,oci_status'
    )
    .eq('site_id', SITE_ID)
    .not('gclid', 'is', null)
    .order('created_at', { ascending: true });
  if (callsErr) throw callsErr;

  const { data: queue, error: queueErr } = await supabase
    .from('offline_conversion_queue')
    .select(
      'id,call_id,status,action,value_cents,currency,conversion_time,occurred_at,occurred_at_source,gclid,wbraid,gbraid,provider_error_code,provider_error_category,last_error'
    )
    .eq('site_id', SITE_ID)
    .not('gclid', 'is', null)
    .order('conversion_time', { ascending: true });
  if (queueErr) throw queueErr;

  const queueByCall = new Map();
  for (const row of queue ?? []) {
    if (!row.call_id) continue;
    const arr = queueByCall.get(row.call_id) || [];
    arr.push(row);
    queueByCall.set(row.call_id, arr);
  }

  const details = [];
  let missing = 0;
  let withPhone = 0;
  let wonLike = 0;
  let contactedLike = 0;
  let conversionTimeMismatch = 0;

  for (const call of calls ?? []) {
    const qRows = queueByCall.get(call.id) || [];
    const queueActions = [...new Set(qRows.map((r) => r.action))];
    const queueStatuses = [...new Set(qRows.map((r) => r.status))];
    const queueValues = [...new Set(qRows.map((r) => r.value_cents))];
    const conversionTimes = [...new Set(qRows.map((r) => r.conversion_time).filter(Boolean))].sort();
    const firstQueueTime = conversionTimes[0] || null;
    const hasPhone = Boolean(call.caller_phone_e164 || call.caller_phone_hash_sha256);
    if (hasPhone) withPhone += 1;
    if (qRows.length === 0) missing += 1;

    const row = {
      call_id: call.id,
      gclid: call.gclid,
      status: call.status,
      source: call.source,
      intent_time: call.created_at,
      confirmed_at: call.confirmed_at,
      sale_amount: call.sale_amount,
      has_phone: hasPhone,
      phone: call.caller_phone_e164 || null,
      queue_count: qRows.length,
      queueActions,
      queueStatuses,
      queueValues,
      first_queue_conversion_time: firstQueueTime,
      occurred_at_source: [...new Set(qRows.map((r) => r.occurred_at_source).filter(Boolean))].join('|'),
    };
    if (isWonLike(row)) wonLike += 1;
    else contactedLike += 1;

    if (row.first_queue_conversion_time && row.intent_time) {
      if (new Date(row.first_queue_conversion_time).getTime() !== new Date(row.intent_time).getTime()) {
        conversionTimeMismatch += 1;
      }
    }
    details.push(row);
  }

  const queueByAction = {};
  const queueByStatus = {};
  for (const row of queue ?? []) {
    queueByAction[row.action] = (queueByAction[row.action] || 0) + 1;
    queueByStatus[row.status] = (queueByStatus[row.status] || 0) + 1;
  }

  const report = {
    generated_at: new Date().toISOString(),
    site,
    totals: {
      gclid_intents: (calls ?? []).length,
      gclid_queue_rows: (queue ?? []).length,
      gclid_intents_missing_queue: missing,
      gclid_intents_with_phone: withPhone,
      won_like: wonLike,
      contacted_like: contactedLike,
      conversion_time_not_equal_first_intent_rows: conversionTimeMismatch,
    },
    queue_by_action: queueByAction,
    queue_by_status: queueByStatus,
    missing_call_ids: details.filter((d) => d.queue_count === 0).map((d) => d.call_id),
    details,
  };

  const outDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'kocoto-gclid-intent-queue-report.json');
  const csvPath = path.join(outDir, 'kocoto-gclid-intent-queue-report.csv');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const cols = [
    'call_id',
    'gclid',
    'status',
    'source',
    'intent_time',
    'confirmed_at',
    'sale_amount',
    'has_phone',
    'phone',
    'queue_count',
    'queue_actions',
    'queue_statuses',
    'queue_values',
    'first_queue_conversion_time',
    'occurred_at_source',
  ];
  const lines = [cols.join(',')];
  for (const row of details) {
    lines.push(
      cols
        .map((col) => {
          if (col === 'queue_actions') return esc((row.queueActions || []).join('|'));
          if (col === 'queue_statuses') return esc((row.queueStatuses || []).join('|'));
          if (col === 'queue_values') return esc((row.queueValues || []).join('|'));
          return esc(row[col]);
        })
        .join(',')
    );
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  console.log(
    JSON.stringify(
      {
        jsonPath,
        csvPath,
        summary: report.totals,
        queue_by_action: report.queue_by_action,
        queue_by_status: report.queue_by_status,
        missing_call_ids: report.missing_call_ids,
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

