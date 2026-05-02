#!/usr/bin/env node
/**
 * OCI / outbox yazma yolu için kritik PostgREST tablolarına erişilebilirliği doğrular.
 * Shadow/audit tabloları eksikse uyarı (exit 0); çekirdek eksikse exit 1.
 *
 *   node scripts/db/verify-oci-write-schema.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const CORE_TABLES = [
  'sites',
  'sessions',
  'calls',
  'outbox_events',
  'marketing_signals',
  'offline_conversion_queue',
];

const OPTIONAL_TABLES = ['call_funnel_ledger', 'truth_canonical_ledger', 'truth_evidence_ledger'];

async function probe(table) {
  const { error } = await supabase.from(table).select('id').limit(1).maybeSingle();
  if (!error) return { ok: true };
  const m = error.message || String(error);
  if (/does not exist|schema cache|not find the table|PGRST205/i.test(m)) {
    return { ok: false, message: m };
  }
  return { ok: true, warning: m };
}

async function main() {
  console.log('OCI yazma şeması (PostgREST) — probe\n');
  let coreFail = 0;

  for (const t of CORE_TABLES) {
    const r = await probe(t);
    if (r.ok && !r.warning) {
      console.log('OK   (çekirdek)', t);
    } else if (r.ok && r.warning) {
      console.log('WARN (çekirdek erişildi ama hata)', t, '-', r.warning);
    } else {
      console.log('MISS (çekirdek)', t, '-', r.message);
      coreFail++;
    }
  }

  for (const t of OPTIONAL_TABLES) {
    const r = await probe(t);
    if (r.ok && !r.warning) {
      console.log('OK   (opsiyonel)', t);
    } else if (r.ok && r.warning) {
      console.log('WARN', t, '-', r.warning);
    } else {
      console.log('SKIP (opsiyonel — kod no-op/path-atlama yapar)', t);
    }
  }

  console.log('');
  if (coreFail > 0) {
    console.error(`Hata: ${coreFail} çekirdek tablo PostgREST’te görünmüyor. Migration/API şemayı kontrol edin.`);
    process.exit(1);
  }
  console.log(
    'Özet: Çekirdek tablolar erişilebilir. Canonical ledger shadow için TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED=true kullanın.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
