#!/usr/bin/env node
/**
 * Backfill traffic_source / traffic_medium for historical sessions.
 *
 * Usage:
 *   DRY_RUN=1 node --experimental-strip-types scripts/backfill-traffic-sources.mjs
 *   node --experimental-strip-types scripts/backfill-traffic-sources.mjs
 *
 * Requirements (.env.local or env vars):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Notes:
 * - Sessions table is partitioned; PK is (id, created_month). Updates must include created_month.
 * - We import determineTrafficSource() to keep logic consistent with runtime.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { determineTrafficSource } from '../lib/analytics/source-classifier.ts';

// Load .env.local explicitly (Next.js convention). Fallback to default dotenv behavior.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing env: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const PAGE_SIZE = Math.max(50, Math.min(2000, Number(process.env.PAGE_SIZE || 500)));
const MAX_UPDATES = Number.isFinite(Number(process.env.MAX_UPDATES))
  ? Math.max(1, Number(process.env.MAX_UPDATES))
  : Infinity;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function nowIso() {
  return new Date().toISOString();
}

function asReferrerUrlFromHost(host) {
  const h = typeof host === 'string' ? host.trim() : '';
  if (!h) return '';
  if (h.startsWith('http://') || h.startsWith('https://')) return h;
  return `https://${h}/`;
}

function pickEntryUrl(row) {
  const u = typeof row?.entry_page === 'string' ? row.entry_page.trim() : '';
  return u || '';
}

function paramsFromRow(row) {
  return {
    utm_source: row?.utm_source ?? null,
    utm_medium: row?.utm_medium ?? null,
    utm_campaign: row?.utm_campaign ?? null,
    utm_term: row?.utm_term ?? null,
    utm_content: row?.utm_content ?? null,
    gclid: row?.gclid ?? null,
    wbraid: row?.wbraid ?? null,
    gbraid: row?.gbraid ?? null,
    // These may not exist as columns; URL parsing will still catch them if present in entry_page.
    fbclid: row?.fbclid ?? null,
    ttclid: row?.ttclid ?? null,
    msclkid: row?.msclkid ?? null,
  };
}

async function fetchPage(offset) {
  return await supabase
    .from('sessions')
    .select(
      [
        'id',
        'created_month',
        'created_at',
        'entry_page',
        'referrer_host',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'gclid',
        'wbraid',
        'gbraid',
        'traffic_source',
        'traffic_medium',
      ].join(',')
    )
    // Backfill missing/legacy values
    .or('traffic_source.is.null,traffic_source.eq.Other,traffic_source.eq.Unknown')
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
}

async function updateOne(row, classification) {
  const payload = {
    traffic_source: classification.traffic_source,
    traffic_medium: classification.traffic_medium,
  };
  if (DRY_RUN) return { ok: true, dry: true, payload };

  const { error } = await supabase
    .from('sessions')
    .update(payload)
    .eq('id', row.id)
    .eq('created_month', row.created_month);

  if (error) return { ok: false, error };
  return { ok: true };
}

async function main() {
  console.log(`[backfill-traffic-sources] start ${nowIso()}`);
  console.log(`  DRY_RUN=${DRY_RUN ? '1' : '0'} PAGE_SIZE=${PAGE_SIZE} MAX_UPDATES=${MAX_UPDATES === Infinity ? '∞' : MAX_UPDATES}`);

  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let failed = 0;

  while (updated < MAX_UPDATES) {
    const { data: rows, error } = await fetchPage(offset);
    if (error) {
      console.error('❌ Fetch failed:', error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    scanned += rows.length;

    for (const row of rows) {
      if (updated >= MAX_UPDATES) break;

      const url = pickEntryUrl(row);
      const ref = asReferrerUrlFromHost(row.referrer_host);
      const params = paramsFromRow(row);
      const classification = determineTrafficSource(url, ref, params);

      // Skip if nothing would change (defensive)
      const prevSrc = row.traffic_source ?? null;
      const prevMed = row.traffic_medium ?? null;
      if (prevSrc === classification.traffic_source && prevMed === classification.traffic_medium) {
        continue;
      }

      const res = await updateOne(row, classification);
      if (!res.ok) {
        failed += 1;
        console.error(`❌ Update failed for session ${row.id} (${row.created_month}):`, res.error?.message || res.error);
        continue;
      }

      updated += 1;
      if (updated % 50 === 0 || updated === 1) {
        console.log(
          `✅ Updated Session ${row.id}: ${prevSrc || 'NULL'} → ${classification.traffic_source} (${classification.traffic_medium})`
        );
      }
    }

    offset += PAGE_SIZE;
    console.log(`[progress] scanned=${scanned} updated=${updated} failed=${failed} offset=${offset}`);

    // If this page produced no updates, still continue scanning until rows exhausted.
    // Avoid tight loops on large tables (small pause).
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`[backfill-traffic-sources] done ${nowIso()} scanned=${scanned} updated=${updated} failed=${failed}`);
  if (DRY_RUN) {
    console.log('ℹ️ DRY_RUN enabled: no database updates were performed.');
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

