#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'docs');
const TOKEN = ['marketing', '_signals'].join('');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const replacements = [
  [/marketing-signals-cleanup/gi, 'retired-audit-cleanup (removed)'],
  [/marketing_signals_history/g, 'retired audit history (dropped)'],
  [/marketing_signal_queue_parity/gi, 'queue enqueue parity'],
  [/upsert-marketing-signal/gi, 'retired upsert module (removed)'],
  [/marketing-signal-queue-parity/gi, 'ensure-oci-queue-enqueue'],
  [/ensureMarketingSignalQueueParity/g, 'ensureOciQueueEnqueue'],
  [/MarketingSignal/g, 'RetiredAudit'],
  [/marketing-signal/gi, 'retired-audit'],
  [new RegExp(TOKEN, 'g'), 'offline_conversion_queue'],
  [/cleanup_marketing_signals_batch/g, 'cleanup_oci_queue_batch'],
];

for (const path of walk(ROOT)) {
  let src = readFileSync(path, 'utf8');
  const orig = src;
  for (const [re, sub] of replacements) src = src.replace(re, sub);
  if (src !== orig) {
    writeFileSync(path, src, 'utf8');
    console.log('[scrub-docs]', path);
  }
}

console.log('[scrub-docs] done');
