#!/usr/bin/env node
/**
 * Build-time env validation (deploy gate).
 * Production/Vercel build'ta kritik env'ler eksikse build fail.
 * Lokal dev'de (NODE_ENV !== production && !VERCEL) skip.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
if (!isProduction) {
  process.exit(0);
}

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'ALLOWED_ORIGINS',
];

const missing = REQUIRED_KEYS.filter((key) => {
  const v = process.env[key];
  return v === undefined || v === null || String(v).trim() === '';
});

if (missing.length > 0) {
  console.error('[validate-env] Missing required env for production build:');
  missing.forEach((k) => console.error('  -', k));
  console.error('[validate-env] Set these in Vercel Project → Settings → Environment Variables (Production).');
  process.exit(1);
}

process.exit(0);
