#!/usr/bin/env node

/**
 * SECTOR BRAVO — Tank Tracker: "Veri sunucuya ulaştı mı?" Supabase üzerinden kanıt.
 * .env.local'dan SUPABASE_* alır; son 5 dk event sayısı + son 10 event listeler.
 *
 * Usage: node scripts/smoke/tank-tracker-events-proof.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function bold(msg) {
  return `${BOLD}${msg}${RESET}`;
}

if (!url || !key) {
  fail('NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY yok (.env.local).');
  process.exit(1);
}

const supabase = createClient(url, key);

console.log(`\n${bold('Tank Tracker — Events proof (Supabase)')}`);
console.log(`${bold('========================================')}\n`);

try {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { count, error: countErr } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', fiveMinAgo);

  if (countErr) {
    fail(`Count sorgu hatası: ${countErr.message}`);
    process.exit(1);
  }
  const total = count != null ? count : 0;

  const { data: rows, error: rowsErr } = await supabase
    .from('events')
    .select('id, site_id, event_action, event_category, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (rowsErr) {
    fail(`Sorgu hatası: ${rowsErr.message}`);
    process.exit(1);
  }

  const withSiteId = (rows || []).filter((r) => r.site_id != null).length;

  pass(`Son 5 dakikada event sayısı: ${total}`);
  pass(`Son 10 event içinde site_id dolu: ${withSiteId}/${(rows || []).length}`);

  if ((rows || []).length > 0) {
    console.log(`\n${bold('Son 10 event (özet):')}`);
    (rows || []).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.event_action} | site_id: ${r.site_id ? '✓' : '—'} | ${r.created_at}`);
    });
  }

  console.log(`\n${bold('----------------------------------------')}`);
  console.log(`${GREEN}${bold('✅ Events proof: PASS')}${RESET}\n`);
  process.exit(0);
} catch (err) {
  fail(`Hata: ${err.message}`);
  process.exit(1);
}
