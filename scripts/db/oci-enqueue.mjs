#!/usr/bin/env node
/**
 * OCI kuyruga alma + reset (FAILED/RETRY/PROCESSING/COMPLETED-uploaded_at-null)
 * Seal: conversion_time = calls.confirmed_at. Null/gecersiz -> skip.
 *
 * OPS-ONLY: Bypasses orchestrator (enqueue-from-sales, sweep-unsent-conversions).
 * Do NOT run concurrently with cron enqueue-from-sales or sweep-unsent-conversions.
 *
 * Kullanim:
 *   node scripts/db/oci-enqueue.mjs Eslamed
 *   node scripts/db/oci-enqueue.mjs Eslamed --today     # sadece bugunun muhurleri
 *   node scripts/db/oci-enqueue.mjs Eslamed --force-reset-completed  # tum COMPLETED -> QUEUED (toparlama)
 *   node scripts/db/oci-enqueue.mjs Eslamed --dry-run
 *   node scripts/db/oci-enqueue.mjs Eslamed --skip-if-queued  # skip call_id already in queue (idempotency)
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { majorToMinor } from '../lib/currency-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const todayOnly = args.includes('--today') || args.includes('-t');
const forceResetCompleted = args.includes('--force-reset-completed') || args.includes('-f');
const skipIfQueued = args.includes('--skip-if-queued') || args.includes('-s'); // parsed for ops; we always skip-if-queued
const query = args.find((a) => !a.startsWith('-'));

async function resolveSiteId(q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data?.id || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or('name.ilike.%' + q + '%,domain.ilike.%' + q + '%')
    .limit(1);
  return data?.[0]?.id || null;
}

async function run() {
  const siteId = await resolveSiteId(query);
  if (!siteId) {
    console.error('Site bulunamadi:', query || '(bos)');
    console.error('Ornek: node scripts/db/oci-enqueue.mjs Eslamed');
    process.exit(1);
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString().slice(0, 10);
  const tomorrow = new Date(todayStart);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  let callsQuery = supabase
    .from('calls')
    .select('id, matched_session_id, confirmed_at, lead_score, sale_amount, currency')
    .eq('site_id', siteId)
    .in('status', ['confirmed', 'qualified', 'real'])
    .eq('oci_status', 'sealed');
  if (todayOnly) {
    callsQuery = callsQuery.gte('confirmed_at', todayIso).lt('confirmed_at', tomorrowIso);
  }
  const { data: calls, error: callsErr } = await callsQuery;

  if (callsErr) {
    console.error('Calls hatasi:', callsErr.message);
    process.exit(1);
  }

  if (!calls?.length) {
    console.log('Sealed call yok' + (todayOnly ? ' (bugun)' : '') + '. Reset devam edecek.');
  }

  const sessionIds = calls?.length ? [...new Set(calls.map((c) => c.matched_session_id).filter(Boolean))] : [];
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .in('id', sessionIds);

  const sessionMap = new Map((sessions || []).map((s) => [s.id, s]));

  // --skip-if-queued: before insert, query offline_conversion_queue for same call_id; if exists, skip.
  // We always do this (backward compat); flag makes intent explicit for ops.
  const { data: existingRows } = await supabase
    .from('offline_conversion_queue')
    .select('call_id')
    .eq('site_id', siteId);
  const existingCallIds = new Set((existingRows || []).map((r) => r.call_id).filter(Boolean));

  const toInsert = [];
  for (const c of calls || []) {
    if (existingCallIds.has(c.id)) continue;
    const sess = c.matched_session_id ? sessionMap.get(c.matched_session_id) : null;
    const gclid = sess?.gclid ? String(sess.gclid).trim() : '';
    const wbraid = sess?.wbraid ? String(sess.wbraid).trim() : '';
    const gbraid = sess?.gbraid ? String(sess.gbraid).trim() : '';
    if (!gclid && !wbraid && !gbraid) continue;

    // Seal: conversion_time = confirmed_at. Skip if null (deterministic error guard).
    const confirmedAt = c.confirmed_at ? String(c.confirmed_at).trim() : '';
    if (!confirmedAt) {
      console.warn('[OCI] confirmed_at null, skipping call_id:', c.id);
      continue;
    }
    const parsedDate = new Date(confirmedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      console.warn('[OCI] confirmed_at invalid, skipping call_id:', c.id);
      continue;
    }

    // V5_SEAL: value_cents = sale_amount exactly (or 0). No proxy multipliers; bypasses legacy oci_config.
    // calls.sale_amount is in major units — use majorToMinor to match War Room output (JPY/KWD-aware).
    const currency = (c.currency || 'TRY').trim().toUpperCase().replace(/[^A-Z]/g, '') || 'TRY';
    const valueCents = c.sale_amount != null && c.sale_amount > 0
      ? majorToMinor(c.sale_amount, currency)
      : 0;

    toInsert.push({
      site_id: siteId,
      call_id: c.id,
      sale_id: null,
      provider_key: 'google_ads',
      conversion_time: confirmedAt,
      value_cents: valueCents,
      currency,
      gclid: gclid || null,
      wbraid: wbraid || null,
      gbraid: gbraid || null,
      status: 'QUEUED',
    });
  }

  console.log('Sealed call:', calls?.length ?? 0);
  console.log('Tabloda zaten:', existingCallIds.size);
  if (skipIfQueued) console.log('(--skip-if-queued: idempotency aktif)');
  console.log('Eklenecek:', toInsert.length);

  if (dryRun) {
    console.log('[DRY-RUN] INSERT yapilmadi.');
    return;
  }

  if (toInsert.length) {
    const { error: insErr } = await supabase
      .from('offline_conversion_queue')
      .insert(toInsert);
    if (insErr) {
      console.error('INSERT hatasi:', insErr.message);
      process.exit(1);
    }
    console.log('Eklenen:', toInsert.length);
  }

  const { data: resetFR } = await supabase
    .from('offline_conversion_queue')
    .update({ status: 'QUEUED', claimed_at: null })
    .eq('site_id', siteId)
    .in('status', ['FAILED', 'RETRY'])
    .select('id');
  if (resetFR?.length) console.log('FAILED/RETRY -> QUEUED:', resetFR.length);

  const { data: resetP } = await supabase
    .from('offline_conversion_queue')
    .update({ status: 'QUEUED', claimed_at: null })
    .eq('site_id', siteId)
    .eq('status', 'PROCESSING')
    .select('id');
  if (resetP?.length) console.log('PROCESSING -> QUEUED:', resetP.length);

  let resetQuery = supabase
    .from('offline_conversion_queue')
    .update({ status: 'QUEUED', claimed_at: null, uploaded_at: null })
    .eq('site_id', siteId);
  if (forceResetCompleted) {
    resetQuery = resetQuery.in('status', ['COMPLETED', 'UPLOADED']);
  } else {
    resetQuery = resetQuery.eq('status', 'COMPLETED').is('uploaded_at', null);
  }
  const { data: resetC } = await resetQuery.select('id');
  if (resetC?.length) console.log('COMPLETED' + (forceResetCompleted ? ' (tumu)' : ' (uploaded_at null)') + ' -> QUEUED:', resetC.length);

  if (todayOnly) console.log('(--today: sadece bugunun muhurleri)');
  console.log('Bitti. Google Ads script calistir.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
