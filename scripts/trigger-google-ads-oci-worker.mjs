#!/usr/bin/env node
/**
 * Trigger google-ads-oci worker. Loads CRON_SECRET from .env.local so terminal env is not needed.
 * Usage: node scripts/trigger-google-ads-oci-worker.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const baseUrl = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error('CRON_SECRET not found. Set it in .env.local');
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, '')}/api/workers/google-ads-oci`;
console.log('POST', url);

const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await res.text();
console.log('Status:', res.status);
console.log('Body:', body);
process.exit(res.ok ? 0 : 1);
