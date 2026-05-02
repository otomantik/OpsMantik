#!/usr/bin/env node
/**
 * Trigger outbox processing worker.
 * Moves IntentSealed events to the OCI queue.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const baseUrl =
  process.env.BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  'http://localhost:3000';
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error('CRON_SECRET not found. Set it in .env.local');
  process.exit(1);
}

if (!/^https?:\/\//i.test(String(baseUrl))) {
  console.error('BASE_URL / NEXT_PUBLIC_APP_URL geçerli bir https origin olmalı.');
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, '')}/api/cron/oci/process-outbox-events`;
console.log('--- Outbox Processor Tetikleniyor ---');
console.log('POST', url);

const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
console.log('Durum:', res.status);
try {
  const json = JSON.parse(body);
  console.log('Sonuç:', JSON.stringify(json, null, 2));
} catch (e) {
  console.log('Yanıt:', body);
}

process.exit(res.ok ? 0 : 1);
