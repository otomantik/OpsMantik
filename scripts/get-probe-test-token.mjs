#!/usr/bin/env node
/**
 * Probe entegrasyon testi için access token üretir.
 * .env.local'de PROBE_TEST_EMAIL ve PROBE_TEST_PASS tanımlı olmalı.
 *
 * Kullanım: node scripts/get-probe-test-token.mjs
 * Çıktı: access_token (stdout) — Android ekibine güvenli kanal ile ilet.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.PROBE_TEST_EMAIL || process.env.PROOF_EMAIL;
const password = process.env.PROBE_TEST_PASS || process.env.PROOF_PASSWORD;

if (!url || !anon) {
  console.error('Hata: NEXT_PUBLIC_SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_ANON_KEY eksik (.env.local)');
  process.exit(1);
}

if (!email || !password) {
  console.error('Hata: .env.local\'de PROBE_TEST_EMAIL + PROBE_TEST_PASS veya PROOF_EMAIL + PROOF_PASSWORD tanımlı olmalı.');
  console.error('Örnek:');
  console.error('  PROBE_TEST_EMAIL=test@example.com');
  console.error('  PROBE_TEST_PASS=guvenli_sifre');
  process.exit(1);
}

const supabase = createClient(url, anon);
const { data, error } = await supabase.auth.signInWithPassword({ email, password });

if (error) {
  console.error('Giriş hatası:', error.message);
  process.exit(1);
}

if (!data.session?.access_token) {
  console.error('Session/token alınamadı');
  process.exit(1);
}

console.log(data.session.access_token);
