#!/usr/bin/env node
/**
 * Safe canary preview (markAsExported=false only). Cursor walk lives in `./lib/oci-canary-preview-walk.mjs`.
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCanaryJournalPreviewWalk,
  resolveCanaryPreviewMaxPages,
} from './lib/oci-canary-preview-walk.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const siteId = process.env.CANARY_SITE_ID || '7eb8f5c0-4a96-4a0e-bd89-a463127b26b8';
const expectedQueueId = process.env.CANARY_EXPECTED_QUEUE_ID || '0b298a99-673a-4cd1-a2c1-94a3b192e47c';
const baseUrl = String(process.env.APP_BASE_URL || 'https://console.opsmantik.com').replace(/\/+$/, '');
const apiKey = String(process.env.CANARY_API_KEY || '').trim();
const maxPages = resolveCanaryPreviewMaxPages();

if (!apiKey) {
  console.error(JSON.stringify({ ok: false, reason: 'CANARY_API_KEY_MISSING' }, null, 2));
  process.exit(1);
}

const headers = {
  'x-api-key': apiKey,
  'x-opsmantik-canary-mode': 'true',
  'x-opsmantik-change-ticket': process.env.CHANGE_TICKET || 'PR-9H-FRESH-CANARY-001',
  'x-opsmantik-operator-id': process.env.OPERATOR_ID || 'serkan',
  'x-opsmantik-canary-approval': 'I_APPROVE_PRODUCTION_CANARY',
  'x-opsmantik-canary-site-id': siteId,
  'x-opsmantik-canary-max-batch-size': '1',
  ...(expectedQueueId
    ? { 'x-opsmantik-canary-expected-queue-id': expectedQueueId }
    : {}),
};

const out = await runCanaryJournalPreviewWalk({
  baseUrl,
  siteId,
  expectedQueueId,
  headers,
  maxPages,
});

/** @type {typeof out.pagination} */
const pagination = out.pagination.map((row) =>
  typeof row === 'object' && row !== null
    ? { ...row, cursor_used: Boolean(row.incoming_cursor_present) }
    : row
);

const terminal = pagination[pagination.length - 1];
const foundGood = out.foundGood;

console.log(
  JSON.stringify(
    {
      ok: !!foundGood,
      code: foundGood ? 'CANARY_PREVIEW_OK' : 'CANARY_PREVIEW_INCOMPLETE',
      diagnosis: out.diagnosis,
      scope_decision: out.scopeDecision,
      max_pages: out.maxPages,
      pages_followed: pagination.length,
      expected_queue_id: expectedQueueId,
      pagination,
      last_page: pagination[pagination.length - 1],
      hint:
        pagination.length === 1 && terminal?.next_cursor_present
          ? 'First page yielded no export item; rerun with PR9H_PREVIEW_MAX_PAGES>=12 or omit expected until cursor walk.'
          : null,
      export_run_id: out.last?.body?.export_run_id ?? null,
      markAsExported: false,
    },
    null,
    2
  )
);

process.exit(foundGood ? 0 : 1);
