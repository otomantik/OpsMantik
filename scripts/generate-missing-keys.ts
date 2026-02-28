#!/usr/bin/env npx tsx
/**
 * One-time backfill: generate public_id and oci_api_key for existing sites
 * that lack them. Identity Protocol — no more manual SQL updates.
 *
 * Usage: npm run generate-missing-keys
 * Requires: .env.local with SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
import { generatePublicId, generateOciApiKey } from '../lib/site-identity';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data: sites, error: listErr } = await admin.from('sites').select('id, public_id, oci_api_key, name');

  if (listErr) {
    console.error('Failed to list sites:', listErr);
    process.exit(1);
  }

  const needsPublicId = (sites || []).filter(
    (s) => s.public_id == null || String(s.public_id).trim() === ''
  );
  const needsOciKey = (sites || []).filter(
    (s) => s.oci_api_key == null || String(s.oci_api_key).trim() === ''
  );

  const toUpdate = [...new Set([...needsPublicId, ...needsOciKey].map((s) => s.id))];
  if (toUpdate.length === 0) {
    console.log('No sites need backfill. All sites have public_id and oci_api_key.');
    return;
  }

  console.log(`Found ${toUpdate.length} site(s) needing backfill.`);

  const usedPublicIds = new Set<string>();
  const usedOciKeys = new Set<string>();

  for (const siteId of toUpdate) {
    const site = sites!.find((s) => s.id === siteId);
    if (!site) continue;

    let publicId = site.public_id && String(site.public_id).trim() ? site.public_id : null;
    let ociApiKey = site.oci_api_key && String(site.oci_api_key).trim() ? site.oci_api_key : null;

    if (!publicId) {
      for (let i = 0; i < 5; i++) {
        publicId = generatePublicId();
        if (!usedPublicIds.has(publicId)) {
          usedPublicIds.add(publicId);
          break;
        }
      }
      if (!publicId) {
        console.error(`Failed to generate unique public_id for site ${siteId}`);
        continue;
      }
    }

    if (!ociApiKey) {
      ociApiKey = generateOciApiKey();
      if (usedOciKeys.has(ociApiKey)) {
        ociApiKey = generateOciApiKey(); // retry once
      }
      usedOciKeys.add(ociApiKey);
    }

    const updates: { public_id?: string; oci_api_key?: string } = {};
    if (!site.public_id || String(site.public_id).trim() === '') updates.public_id = publicId;
    if (!site.oci_api_key || String(site.oci_api_key).trim() === '') updates.oci_api_key = ociApiKey;

    if (Object.keys(updates).length === 0) continue;

    const { error } = await admin.from('sites').update(updates).eq('id', siteId);

    if (error) {
      console.error(`Failed to update site ${siteId}:`, error.message);
      continue;
    }

    console.log(
      `Updated site ${siteId} (${site.name || 'unnamed'}): public_id=${updates.public_id ? '✓' : '-'} oci_api_key=${updates.oci_api_key ? '✓' : '-'}`
    );
  }

  console.log('Backfill complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
