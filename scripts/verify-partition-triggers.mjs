#!/usr/bin/env node
/**
 * CI guard: Verify partition drift triggers exist
 * Calls verify_partition_triggers_exist() RPC
 *
 * Usage:
 *   node scripts/verify-partition-triggers.mjs
 *
 * Exit 0 if triggers exist, 1 otherwise.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.rpc('verify_partition_triggers_exist');

if (error) {
  console.error('verify_partition_triggers_exist failed:', error.message);
  process.exit(1);
}

if (data === true) {
  console.log('Partition triggers OK (sessions_set_created_month, events_set_session_month_from_session)');
  process.exit(0);
}

console.error('Partition triggers MISSING - drift guards may have been dropped');
process.exit(1);
