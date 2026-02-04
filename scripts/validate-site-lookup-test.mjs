#!/usr/bin/env node
/**
 * Test that 32-char hex site_id resolves (id without hyphens → find by id then public_id).
 * Run: node scripts/validate-site-lookup-test.mjs
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey);

function normalizeToUuid(stripped) {
  return (
    stripped.substring(0, 8) + '-' +
    stripped.substring(8, 12) + '-' +
    stripped.substring(12, 16) + '-' +
    stripped.substring(16, 20) + '-' +
    stripped.substring(20, 32)
  );
}

async function validateSite(siteId) {
  const trimmed = String(siteId).trim();
  const stripped = trimmed.replace(/-/g, '');
  const is32Hex = /^[0-9a-f]{32}$/i.test(stripped);

  if (is32Hex) {
    const normalizedUuid = normalizeToUuid(stripped);
    const byId = await admin.from('sites').select('id').eq('id', normalizedUuid).maybeSingle();
    if (byId.error) return { valid: false, error: byId.error.message };
    if (byId.data) return { valid: true, site: byId.data };
    const byPublicId = await admin.from('sites').select('id').eq('public_id', stripped).maybeSingle();
    if (byPublicId.error) return { valid: false, error: byPublicId.error.message };
    if (byPublicId.data) return { valid: true, site: byPublicId.data };
    return { valid: false, error: 'Site not found' };
  }

  const { data, error } = await admin.from('sites').select('id').eq('public_id', trimmed).maybeSingle();
  if (error) return { valid: false, error: error.message };
  if (!data) return { valid: false, error: 'Site not found' };
  return { valid: true, site: data };
}

async function main() {
  console.log('Fetching one site from DB...');
  const { data: sites, error: listErr } = await admin.from('sites').select('id, public_id').limit(1);
  if (listErr || !sites?.length) {
    console.error('No site in DB or error:', listErr?.message || 'empty');
    process.exit(1);
  }
  const site = sites[0];
  const uuidWithHyphens = site.id;
  const uuidNoHyphens = site.id.replace(/-/g, '');
  const publicId = site.public_id || '';

  console.log('Testing with site:', site.public_id || site.id);
  console.log('');

  let ok = 0;
  let fail = 0;

  // Test 1: UUID with hyphens (normal)
  const r1 = await validateSite(uuidWithHyphens);
  if (r1.valid) {
    console.log('  OK  validateSite(uuid with hyphens) -> found');
    ok++;
  } else {
    console.log('  FAIL validateSite(uuid with hyphens) ->', r1.error);
    fail++;
  }

  // Test 2: UUID without hyphens (32 hex) - the case that was failing in worker
  const r2 = await validateSite(uuidNoHyphens);
  if (r2.valid) {
    console.log('  OK  validateSite(uuid without hyphens / 32hex) -> found');
    ok++;
  } else {
    console.log('  FAIL validateSite(uuid without hyphens) ->', r2.error);
    fail++;
  }

  // Test 3: public_id (if it's 32 hex we already cover; if not, separate path)
  if (publicId) {
    const r3 = await validateSite(publicId);
    if (r3.valid) {
      console.log('  OK  validateSite(public_id) -> found');
      ok++;
    } else {
      console.log('  FAIL validateSite(public_id) ->', r3.error);
      fail++;
    }
  }

  // Test 4: nonexistent
  const r4 = await validateSite('00000000000000000000000000000000');
  if (!r4.valid) {
    console.log('  OK  validateSite(nonexistent 32hex) -> not found (expected)');
    ok++;
  } else {
    console.log('  FAIL validateSite(nonexistent) should not find a site');
    fail++;
  }

  console.log('');
  console.log('Result:', ok, 'passed', fail ? `, ${fail} failed` : '');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
