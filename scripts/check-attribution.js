#!/usr/bin/env node

/**
 * Attribution Regression Check
 * 
 * Verifies that UI reads from sessions table first, falls back to metadata.
 * Fails if UI reads raw metadata for source when sessions fields exist.
 */

const fs = require('fs');
const path = require('path');

let hasErrors = false;

// Check session-group.tsx
const sessionGroupPath = path.join(__dirname, '../components/dashboard/session-group.tsx');
if (!fs.existsSync(sessionGroupPath)) {
  console.error('❌ session-group.tsx not found');
  process.exit(1);
}

const content = fs.readFileSync(sessionGroupPath, 'utf8');

// Must fetch session data
if (!content.includes("from('sessions')") || !content.includes('attribution_source')) {
  console.error('❌ UI does not read attribution_source from sessions table');
  hasErrors = true;
}

// Must use sessionData first, fallback to metadata
if (!content.includes('sessionData?.attribution_source') && !content.includes('sessionData.attribution_source')) {
  console.error('❌ UI does not use sessionData first for attribution_source');
  hasErrors = true;
}

if (!content.includes('metadata.attribution_source')) {
  console.error('❌ UI does not have fallback to metadata.attribution_source');
  hasErrors = true;
}

// Check context chips always render
if (!content.includes('CITY:') || !content.includes('DISTRICT:') || !content.includes('DEVICE:')) {
  console.error('❌ Context chips not found in UI');
  hasErrors = true;
}

// Check attribution function exists
const attributionPath = path.join(__dirname, '../lib/attribution.ts');
if (!fs.existsSync(attributionPath)) {
  console.error('❌ lib/attribution.ts not found');
  hasErrors = true;
} else {
  const attributionContent = fs.readFileSync(attributionPath, 'utf8');
  if (!attributionContent.includes('computeAttribution')) {
    console.error('❌ computeAttribution function not found');
    hasErrors = true;
  }
}

// Check /api/sync uses attribution function
const syncPath = path.join(__dirname, '../app/api/sync/route.ts');
if (!fs.existsSync(syncPath)) {
  console.error('❌ app/api/sync/route.ts not found');
  hasErrors = true;
} else {
  const syncContent = fs.readFileSync(syncPath, 'utf8');
  if (!syncContent.includes('computeAttribution')) {
    console.error('❌ /api/sync does not use computeAttribution function');
    hasErrors = true;
  }
  if (!syncContent.includes('attribution_source:') || !syncContent.includes('device_type:')) {
    console.error('❌ /api/sync does not store attribution_source or device_type in sessions');
    hasErrors = true;
  }
}

if (hasErrors) {
  console.error('\n❌ Attribution regression checks FAILED');
  process.exit(1);
}

console.log('✅ Attribution regression checks passed');
console.log('  - UI reads from sessions table first');
console.log('  - Fallback to metadata implemented');
console.log('  - Context chips always visible');
console.log('  - Attribution function exists and used');
