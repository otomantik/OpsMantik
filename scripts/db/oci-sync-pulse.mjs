/**
 * OCI Sync Pulse (Phase 19 Reliability Tool)
 * 
 * Manually triggers the OCI pipeline to:
 * 1. Sweep pending outbox events into marketing_signals.
 * 2. Trigger the Google Ads export sync for all active sites.
 * 
 * Usage: node scripts/db/oci-sync-pulse.mjs
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || 'dev_secret';

async function pulse() {
    console.log('--- OCI Sync Pulse Start ---');

    // Step 1: Process Outbox Events (Internal Queue)
    console.log('1. Pulsing Outbox Processor...');
    const outboxRes = await fetch(`${APP_URL}/api/cron/oci/process-outbox-events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${CRON_SECRET}` }
    });
    const outboxData = await outboxRes.json();
    console.log('Result:', outboxData);

    // Step 2: Trigger Export (Mocking Google Ads Script)
    // In production, we loop through known site IDs or use the unified export.
    console.log('2. Pulsing Google Ads Export...');
    const exportRes = await fetch(`${APP_URL}/api/oci/google-ads-export?all=true`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${CRON_SECRET}` }
    });
    if (exportRes.status === 200) {
        console.log('Export Triggered Successfully.');
    } else {
        console.log('Export Failed:', exportRes.status, await exportRes.text());
    }

    console.log('--- OCI Sync Pulse Complete ---');
}

pulse().catch(console.error);
