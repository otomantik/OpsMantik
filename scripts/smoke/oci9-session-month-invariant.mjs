#!/usr/bin/env node
/**
 * OCI-9D Smoke: session_created_month invariant migration exists.
 * Source-inspection only (no DB).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const migrationsDir = join(root, 'supabase/migrations');

const files = readdirSync(migrationsDir);
const mig = files.find((f) => f.includes('session_created_month_invariant') || (f.includes('oci9') && f.includes('session')));
if (!mig) {
  console.error('✗ migration: no session_created_month_invariant found');
  process.exit(1);
}

const src = readFileSync(join(migrationsDir, mig), 'utf-8');
if (src.includes('calls_session_created_month_invariant') && src.includes('matched_session_id IS NULL OR session_created_month IS NOT NULL')) {
  console.log('✓ migration: CHECK constraint present');
  process.exit(0);
} else {
  console.error('✗ migration: missing invariant CHECK');
  process.exit(1);
}
