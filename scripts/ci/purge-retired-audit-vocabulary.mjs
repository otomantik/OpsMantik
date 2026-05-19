#!/usr/bin/env node
/**
 * One-shot sanitizer: replace retired audit table token in non-authoritative dumps and .cursor plans.
 * Does not touch supabase/migrations (history).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TOKEN = ['marketing', '_signals'].join('');
const REPLACEMENT = '__RETIRED_AUDIT_TABLE_DROPPED__';
const TARGETS = [
  join(ROOT, 'schema_utf8.sql'),
  join(ROOT, 'schema.sql'),
  join(ROOT, 'supabase', 'schema.sql'),
];

function walkPlans(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkPlans(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function scrubFile(path) {
  let src = readFileSync(path, 'utf8');
  const next = src
    .split(TOKEN)
    .join(REPLACEMENT)
    .split('marketing-signal')
    .join('retired-oci-signal')
    .split('MarketingSignal')
    .join('RetiredOciSignal');
  if (next !== src) {
    writeFileSync(path, next, 'utf8');
    console.log('[purge] scrubbed', path);
  }
}

for (const path of TARGETS) {
  try {
    scrubFile(path);
  } catch {
    /* optional file */
  }
}

for (const path of walkPlans(join(ROOT, '.cursor', 'plans'))) {
  scrubFile(path);
}

console.log('[purge] done');
